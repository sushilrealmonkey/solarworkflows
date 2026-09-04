-- Project-owned payment schedules start with the commercial payment terms on
-- the linked quotation, then record project-specific collection due dates.

create table public.project_payment_milestones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone text not null check (btrim(milestone) <> ''),
  percentage numeric check (percentage is null or percentage between 0 and 100),
  amount numeric check (amount is null or amount >= 0),
  due_date date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, milestone)
);

create index project_payment_milestones_project_due_idx
  on public.project_payment_milestones (project_id, due_date, sort_order);
create index project_payment_milestones_company_due_idx
  on public.project_payment_milestones (company_id, due_date);

create or replace function private.set_project_payment_milestone_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  project_record public.projects%rowtype;
begin
  select *
  into project_record
  from public.projects
  where id = new.project_id;

  if not found then
    raise exception 'Payment milestone must belong to an existing project'
      using errcode = '23503';
  end if;

  if new.organization_id is not null
    and new.organization_id <> project_record.organization_id then
    raise exception 'Payment milestone organization must match its project'
      using errcode = '23503';
  end if;

  if new.company_id is not null and new.company_id <> project_record.company_id then
    raise exception 'Payment milestone company must match its project'
      using errcode = '23503';
  end if;

  new.organization_id := project_record.organization_id;
  new.company_id := project_record.company_id;
  new.milestone := btrim(new.milestone);
  return new;
end;
$$;

create trigger set_project_payment_milestone_defaults
before insert or update of project_id, organization_id, company_id, milestone
on public.project_payment_milestones
for each row execute function private.set_project_payment_milestone_defaults();

create trigger set_project_payment_milestones_updated_at
before update on public.project_payment_milestones
for each row execute function public.set_updated_at();

alter table public.project_payment_milestones enable row level security;

create policy "Super admins can manage project payment milestones"
on public.project_payment_milestones for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Project users can view payment milestones"
on public.project_payment_milestones for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and exists (
    select 1
    from public.projects
    where projects.id = project_payment_milestones.project_id
  )
);

create policy "Project users can create payment milestones"
on public.project_payment_milestones for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('projects', 'update'))
  and exists (
    select 1
    from public.projects
    where projects.id = project_payment_milestones.project_id
  )
);

create policy "Project users can update payment milestones"
on public.project_payment_milestones for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('projects', 'update'))
  and exists (
    select 1
    from public.projects
    where projects.id = project_payment_milestones.project_id
  )
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('projects', 'update'))
  and exists (
    select 1
    from public.projects
    where projects.id = project_payment_milestones.project_id
  )
);

create policy "Project users can delete payment milestones"
on public.project_payment_milestones for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('projects', 'update'))
  and exists (
    select 1
    from public.projects
    where projects.id = project_payment_milestones.project_id
  )
);

grant select, insert, update, delete on public.project_payment_milestones to authenticated;

-- Replacing the schedule in one transaction means users never see a partially
-- saved set of payment terms. SECURITY INVOKER keeps the caller's RLS restrictions.
create or replace function public.replace_project_payment_milestones(
  target_project_id uuid,
  target_milestones jsonb
)
returns setof public.project_payment_milestones
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  project_record public.projects%rowtype;
begin
  if jsonb_typeof(target_milestones) <> 'array' then
    raise exception 'Payment milestones must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(target_milestones) > 30 then
    raise exception 'A project can have at most 30 payment milestones'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_milestones) as milestone_row(value)
    where nullif(btrim(coalesce(milestone_row.value ->> 'milestone', '')), '') is null
      or nullif(btrim(coalesce(milestone_row.value ->> 'due_date', '')), '') is null
  ) then
    raise exception 'Every payment milestone needs a name and due date'
      using errcode = '22023';
  end if;

  select *
  into project_record
  from public.projects
  where id = target_project_id
  for update;

  if not found then
    raise exception 'Project not found or not accessible'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      project_record.organization_id <> public.current_user_organization_id()
      or project_record.company_id <> public.current_user_company_id()
      or not public.user_has_permission('projects', 'update')
    ) then
    raise exception 'Missing permission to update project payment milestones'
      using errcode = '42501';
  end if;

  delete from public.project_payment_milestones
  where project_id = target_project_id;

  insert into public.project_payment_milestones (
    company_id,
    organization_id,
    project_id,
    milestone,
    percentage,
    amount,
    due_date,
    sort_order
  )
  select
    project_record.company_id,
    project_record.organization_id,
    project_record.id,
    btrim(milestone_row.value ->> 'milestone'),
    nullif(btrim(coalesce(milestone_row.value ->> 'percentage', '')), '')::numeric,
    nullif(btrim(coalesce(milestone_row.value ->> 'amount', '')), '')::numeric,
    (milestone_row.value ->> 'due_date')::date,
    milestone_row.ordinality - 1
  from jsonb_array_elements(target_milestones) with ordinality
    as milestone_row(value, ordinality);

  return query
  select *
  from public.project_payment_milestones
  where project_id = target_project_id
  order by due_date, sort_order, created_at;
end;
$$;

revoke execute on function private.set_project_payment_milestone_defaults()
from public, anon, authenticated;
revoke execute on function public.replace_project_payment_milestones(uuid, jsonb)
from public, anon;
grant execute on function public.replace_project_payment_milestones(uuid, jsonb)
to authenticated;

-- Project milestone dates supersede the legacy one-date project field. Keep
-- legacy dates visible until a schedule is first saved, so existing projects do
-- not disappear from the dashboard during rollout.
drop function public.get_payment_due_items(text, uuid, boolean, integer);

create function public.get_payment_due_items(
  target_source_type text default null,
  target_source_id uuid default null,
  overdue_only boolean default false,
  max_items integer default 100
)
returns table (
  source_type text,
  source_id uuid,
  organization_id uuid,
  source_code text,
  source_name text,
  customer_name text,
  payment_due_on date,
  total_amount numeric,
  amount_received numeric,
  balance_due numeric,
  payment_status text,
  days_overdue integer
)
language sql
stable
security invoker
set search_path = public, private
as $$
  with b2b_receipts as (
    select
      payments.b2b_sale_id,
      coalesce(sum(payments.amount), 0) as amount_received
    from public.payments
    where payments.b2b_sale_id is not null
      and payments.status = 'received'
    group by payments.b2b_sale_id
  ),
  raw_due_items as (
    select
      'project'::text as source_type,
      projects.id as source_id,
      projects.organization_id,
      projects.project_code as source_code,
      concat_ws(
        ' · ',
        coalesce(projects.project_name, projects.project_code, 'Project'),
        project_payment_milestones.milestone
      ) as source_name,
      coalesce(customers.full_name, customers.business_name, 'Customer') as customer_name,
      project_payment_milestones.due_date as payment_due_on,
      coalesce(project_payment_summary.company_receivable_amount, 0) as total_amount,
      coalesce(project_payment_summary.amount_received, 0) as amount_received,
      coalesce(project_payment_summary.balance_due, 0) as balance_due
    from public.projects
    join public.project_payment_milestones
      on project_payment_milestones.project_id = projects.id
      and project_payment_milestones.company_id = projects.company_id
      and project_payment_milestones.organization_id = projects.organization_id
    join public.project_payment_summary
      on project_payment_summary.project_id = projects.id
      and project_payment_summary.organization_id = projects.organization_id
    join public.customers on customers.id = projects.customer_id
    where projects.archived_at is null
      and coalesce(projects.project_status, '') <> 'cancelled'
      and coalesce(project_payment_summary.balance_due, 0) > 0
      and (public.is_super_admin() or public.user_has_permission('payments', 'view'))

    union all

    select
      'project'::text as source_type,
      projects.id as source_id,
      projects.organization_id,
      projects.project_code as source_code,
      coalesce(projects.project_name, projects.project_code, 'Project') as source_name,
      coalesce(customers.full_name, customers.business_name, 'Customer') as customer_name,
      projects.payment_due_on,
      coalesce(project_payment_summary.company_receivable_amount, 0) as total_amount,
      coalesce(project_payment_summary.amount_received, 0) as amount_received,
      coalesce(project_payment_summary.balance_due, 0) as balance_due
    from public.projects
    join public.project_payment_summary
      on project_payment_summary.project_id = projects.id
      and project_payment_summary.organization_id = projects.organization_id
    join public.customers on customers.id = projects.customer_id
    where projects.archived_at is null
      and coalesce(projects.project_status, '') <> 'cancelled'
      and projects.payment_due_on is not null
      and coalesce(project_payment_summary.balance_due, 0) > 0
      and not exists (
        select 1
        from public.project_payment_milestones
        where project_payment_milestones.project_id = projects.id
      )
      and (public.is_super_admin() or public.user_has_permission('payments', 'view'))

    union all

    select
      'b2b_sale'::text as source_type,
      b2b_sales.id as source_id,
      b2b_sales.organization_id,
      b2b_sales.sale_code as source_code,
      coalesce(b2b_sales.sale_code, 'Sales Order') as source_name,
      coalesce(customers.business_name, customers.full_name, 'Business customer') as customer_name,
      b2b_sales.payment_due_on,
      coalesce(b2b_sales.total_amount, 0) as total_amount,
      coalesce(b2b_receipts.amount_received, 0) as amount_received,
      greatest(
        coalesce(b2b_sales.total_amount, 0) - coalesce(b2b_receipts.amount_received, 0),
        0
      ) as balance_due
    from public.b2b_sales
    join public.customers on customers.id = b2b_sales.customer_id
    left join b2b_receipts on b2b_receipts.b2b_sale_id = b2b_sales.id
    where b2b_sales.archived_at is null
      and b2b_sales.status in ('confirmed', 'dispatched')
      and b2b_sales.payment_due_on is not null
      and greatest(
        coalesce(b2b_sales.total_amount, 0) - coalesce(b2b_receipts.amount_received, 0),
        0
      ) > 0
      and (public.is_super_admin() or public.user_has_permission('payments', 'view'))
  ),
  scored_due_items as (
    select
      raw_due_items.*,
      case
        when payment_due_on < current_date then 'overdue'
        when payment_due_on = current_date then 'due_today'
        when amount_received > 0 then 'partial'
        else 'pending'
      end as payment_status,
      case
        when payment_due_on < current_date then current_date - payment_due_on
        else 0
      end as days_overdue
    from raw_due_items
  )
  select
    source_type,
    source_id,
    organization_id,
    source_code,
    source_name,
    customer_name,
    payment_due_on,
    total_amount,
    amount_received,
    balance_due,
    payment_status,
    days_overdue
  from scored_due_items
  where (target_source_type is null or source_type = target_source_type)
    and (target_source_id is null or source_id = target_source_id)
    and (not overdue_only or payment_status = 'overdue')
  order by payment_due_on asc, source_type asc, source_id asc
  limit greatest(1, least(coalesce(max_items, 100), 1000));
$$;

revoke execute on function public.get_payment_due_items(text, uuid, boolean, integer)
from public, anon;
grant execute on function public.get_payment_due_items(text, uuid, boolean, integer)
to authenticated;

notify pgrst, 'reload schema';
