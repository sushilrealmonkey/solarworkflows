-- Step 11 payments module foundation.
-- Tracks company receivables from customer direct payments and bank loan
-- disbursements. Subsidy is not counted as received by the company because it
-- goes directly to the customer.

create table if not exists public.project_payment_summary (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade unique,
  quotation_id uuid references public.quotations(id),
  customer_id uuid not null references public.customers(id),
  total_project_amount numeric default 0,
  subsidy_amount numeric default 0,
  company_receivable_amount numeric default 0,
  amount_received numeric default 0,
  balance_due numeric default 0,
  payment_status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.project_payment_summary add column if not exists id uuid default gen_random_uuid();
alter table public.project_payment_summary add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.project_payment_summary add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.project_payment_summary add column if not exists quotation_id uuid references public.quotations(id);
alter table public.project_payment_summary add column if not exists customer_id uuid references public.customers(id);
alter table public.project_payment_summary add column if not exists total_project_amount numeric default 0;
alter table public.project_payment_summary add column if not exists subsidy_amount numeric default 0;
alter table public.project_payment_summary add column if not exists company_receivable_amount numeric default 0;
alter table public.project_payment_summary add column if not exists amount_received numeric default 0;
alter table public.project_payment_summary add column if not exists balance_due numeric default 0;
alter table public.project_payment_summary add column if not exists payment_status text default 'pending';
alter table public.project_payment_summary add column if not exists created_at timestamptz default now();
alter table public.project_payment_summary add column if not exists updated_at timestamptz default now();

alter table public.project_payment_summary alter column id set default gen_random_uuid();
alter table public.project_payment_summary alter column organization_id set not null;
alter table public.project_payment_summary alter column project_id set not null;
alter table public.project_payment_summary alter column customer_id set not null;
alter table public.project_payment_summary alter column total_project_amount set default 0;
alter table public.project_payment_summary alter column subsidy_amount set default 0;
alter table public.project_payment_summary alter column company_receivable_amount set default 0;
alter table public.project_payment_summary alter column amount_received set default 0;
alter table public.project_payment_summary alter column balance_due set default 0;
alter table public.project_payment_summary alter column payment_status set default 'pending';
alter table public.project_payment_summary alter column created_at set default now();
alter table public.project_payment_summary alter column updated_at set default now();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  quotation_id uuid references public.quotations(id),
  payment_source text not null,
  payment_mode text,
  amount numeric not null,
  payment_date date default current_date,
  reference_number text,
  bank_name text,
  loan_account_number text,
  receipt_url text,
  notes text,
  status text default 'received',
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.payments add column if not exists id uuid default gen_random_uuid();
alter table public.payments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.payments add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.payments add column if not exists customer_id uuid references public.customers(id);
alter table public.payments add column if not exists quotation_id uuid references public.quotations(id);
alter table public.payments add column if not exists payment_source text;
alter table public.payments add column if not exists payment_mode text;
alter table public.payments add column if not exists amount numeric;
alter table public.payments add column if not exists payment_date date default current_date;
alter table public.payments add column if not exists reference_number text;
alter table public.payments add column if not exists bank_name text;
alter table public.payments add column if not exists loan_account_number text;
alter table public.payments add column if not exists receipt_url text;
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists status text default 'received';
alter table public.payments add column if not exists created_by uuid references public.users_profile(id);
alter table public.payments add column if not exists created_at timestamptz default now();
alter table public.payments add column if not exists updated_at timestamptz default now();

alter table public.payments alter column id set default gen_random_uuid();
alter table public.payments alter column organization_id set not null;
alter table public.payments alter column project_id set not null;
alter table public.payments alter column customer_id set not null;
alter table public.payments alter column payment_source set not null;
alter table public.payments alter column amount set not null;
alter table public.payments alter column payment_date set default current_date;
alter table public.payments alter column status set default 'received';
alter table public.payments alter column created_at set default now();
alter table public.payments alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_payment_summary_status_check'
      and conrelid = 'public.project_payment_summary'::regclass
  ) then
    alter table public.project_payment_summary
    add constraint project_payment_summary_status_check
    check (payment_status in ('pending', 'partial', 'paid', 'overdue'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_payment_source_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_payment_source_check
    check (payment_source in ('customer_direct', 'bank_loan'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_payment_mode_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_payment_mode_check
    check (
      payment_mode is null
      or payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'loan_disbursement', 'other')
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_status_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_status_check
    check (status in ('received', 'failed', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_amount_nonnegative_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_amount_nonnegative_check
    check (amount >= 0);
  end if;
end;
$$;

create unique index if not exists project_payment_summary_project_id_unique
on public.project_payment_summary (project_id);

create index if not exists project_payment_summary_organization_id_idx
on public.project_payment_summary (organization_id);

create index if not exists project_payment_summary_customer_id_idx
on public.project_payment_summary (customer_id);

create index if not exists project_payment_summary_quotation_id_idx
on public.project_payment_summary (quotation_id);

create index if not exists project_payment_summary_payment_status_idx
on public.project_payment_summary (payment_status);

create index if not exists payments_organization_id_idx
on public.payments (organization_id);

create index if not exists payments_project_id_idx
on public.payments (project_id);

create index if not exists payments_customer_id_idx
on public.payments (customer_id);

create index if not exists payments_quotation_id_idx
on public.payments (quotation_id);

create index if not exists payments_payment_source_idx
on public.payments (payment_source);

create index if not exists payments_payment_date_idx
on public.payments (payment_date);

create index if not exists payments_status_idx
on public.payments (status);

-- Ensures payment summaries stay tied to one project/customer/quotation inside a
-- single organization.
create or replace function public.set_payment_summary_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and projects.customer_id = new.customer_id
      and (
        new.quotation_id is null
        or projects.quotation_id = new.quotation_id
      )
  ) then
    raise exception 'payment summary project, customer, and quotation must belong to the same organization'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

-- Ensures payment rows cannot link project/customer/quotation/user records across
-- organizations. This is intentionally enforced in the database, not the UI.
create or replace function public.set_payment_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and projects.customer_id = new.customer_id
      and (
        new.quotation_id is null
        or projects.quotation_id = new.quotation_id
      )
  ) then
    raise exception 'payment project, customer, and quotation must belong to the same organization'
      using errcode = '23503';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the payment'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_project_payment_summary_tenant_links on public.project_payment_summary;

create trigger set_project_payment_summary_tenant_links
before insert or update on public.project_payment_summary
for each row
execute function public.set_payment_summary_tenant_links();

drop trigger if exists set_project_payment_summary_updated_at on public.project_payment_summary;

create trigger set_project_payment_summary_updated_at
before update on public.project_payment_summary
for each row
execute function public.set_updated_at();

drop trigger if exists set_payments_tenant_links on public.payments;

create trigger set_payments_tenant_links
before insert or update on public.payments
for each row
execute function public.set_payment_tenant_links();

drop trigger if exists set_payments_updated_at on public.payments;

create trigger set_payments_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

-- Creates the receivable summary for a project. Subsidy is subtracted from the
-- quotation total because it is not money received by the company.
create or replace function public.create_project_payment_summary(target_project_id uuid)
returns public.project_payment_summary
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
  quotation_record public.quotations%rowtype;
  summary_record public.project_payment_summary%rowtype;
  calculated_total numeric := 0;
  calculated_subsidy numeric := 0;
  calculated_receivable numeric := 0;
begin
  select *
  into project_record
  from public.projects
  where projects.id = target_project_id;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if project_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot create payment summary for another organization project'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('payments', 'create') then
      raise exception 'Missing payments create permission'
        using errcode = '42501';
    end if;
  end if;

  if project_record.quotation_id is not null then
    select *
    into quotation_record
    from public.quotations
    where quotations.id = project_record.quotation_id
      and quotations.organization_id = project_record.organization_id;

    calculated_total := coalesce(quotation_record.total_amount, 0);
    calculated_subsidy := coalesce(quotation_record.subsidy_amount, 0);
  end if;

  calculated_receivable := greatest(calculated_total - calculated_subsidy, 0);

  insert into public.project_payment_summary (
    organization_id,
    project_id,
    quotation_id,
    customer_id,
    total_project_amount,
    subsidy_amount,
    company_receivable_amount,
    amount_received,
    balance_due,
    payment_status
  )
  values (
    project_record.organization_id,
    project_record.id,
    project_record.quotation_id,
    project_record.customer_id,
    calculated_total,
    calculated_subsidy,
    calculated_receivable,
    0,
    calculated_receivable,
    case when calculated_receivable <= 0 then 'paid' else 'pending' end
  )
  on conflict (project_id) do update
  set
    quotation_id = excluded.quotation_id,
    customer_id = excluded.customer_id,
    total_project_amount = excluded.total_project_amount,
    subsidy_amount = excluded.subsidy_amount,
    company_receivable_amount = excluded.company_receivable_amount,
    balance_due = greatest(excluded.company_receivable_amount - public.project_payment_summary.amount_received, 0),
    payment_status = case
      when excluded.company_receivable_amount - public.project_payment_summary.amount_received <= 0 then 'paid'
      when public.project_payment_summary.amount_received > 0 then 'partial'
      else 'pending'
    end,
    updated_at = now()
  returning * into summary_record;

  return summary_record;
end;
$$;

-- Recalculates project payment summary from received payments only. Failed and
-- cancelled payments are ignored. Subsidy is intentionally never added to
-- amount_received because subsidy goes to the customer, not the company.
create or replace function public.recalculate_project_payment_summary(target_project_id uuid)
returns public.project_payment_summary
language plpgsql
security definer
set search_path = public
as $$
declare
  summary_record public.project_payment_summary%rowtype;
  calculated_received numeric;
  calculated_balance numeric;
  project_organization_id uuid;
begin
  select *
  into summary_record
  from public.project_payment_summary
  where project_payment_summary.project_id = target_project_id
  for update;

  if not found then
    summary_record.id := null;
  end if;

  if summary_record.id is null then
    select projects.organization_id
    into project_organization_id
    from public.projects
    where projects.id = target_project_id;

    if project_organization_id is null then
      raise exception 'Project not found'
        using errcode = 'P0002';
    end if;
  else
    project_organization_id := summary_record.organization_id;
  end if;

  if summary_record.id is null then
    if not public.is_super_admin() then
      if project_organization_id <> public.current_user_organization_id() then
        raise exception 'Cannot create payment summary for another organization project'
          using errcode = '42501';
      end if;

      if not (
        public.user_has_permission('payments', 'create')
        or public.user_has_permission('payments', 'update')
        or public.user_has_permission('payments', 'delete')
      ) then
        raise exception 'Missing payments permission'
          using errcode = '42501';
      end if;
    end if;

    insert into public.project_payment_summary (
      organization_id,
      project_id,
      quotation_id,
      customer_id,
      total_project_amount,
      subsidy_amount,
      company_receivable_amount,
      amount_received,
      balance_due,
      payment_status
    )
    select
      projects.organization_id,
      projects.id,
      projects.quotation_id,
      projects.customer_id,
      coalesce(quotations.total_amount, 0),
      coalesce(quotations.subsidy_amount, 0),
      greatest(coalesce(quotations.total_amount, 0) - coalesce(quotations.subsidy_amount, 0), 0),
      0,
      greatest(coalesce(quotations.total_amount, 0) - coalesce(quotations.subsidy_amount, 0), 0),
      case
        when greatest(coalesce(quotations.total_amount, 0) - coalesce(quotations.subsidy_amount, 0), 0) <= 0
          then 'paid'
        else 'pending'
      end
    from public.projects
    left join public.quotations on quotations.id = projects.quotation_id
    where projects.id = target_project_id
    returning * into summary_record;
  end if;

  if not public.is_super_admin() then
    if summary_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate payment summary for another organization project'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('payments', 'create')
      or public.user_has_permission('payments', 'update')
      or public.user_has_permission('payments', 'delete')
    ) then
      raise exception 'Missing payments permission'
        using errcode = '42501';
    end if;
  end if;

  select coalesce(sum(payments.amount), 0)
  into calculated_received
  from public.payments
  where payments.project_id = target_project_id
    and payments.organization_id = summary_record.organization_id
    and payments.status = 'received';

  calculated_balance := greatest(coalesce(summary_record.company_receivable_amount, 0) - calculated_received, 0);

  update public.project_payment_summary
  set
    amount_received = calculated_received,
    balance_due = calculated_balance,
    payment_status = case
      when calculated_balance <= 0 then 'paid'
      when calculated_received > 0 and calculated_balance > 0 then 'partial'
      else 'pending'
    end,
    updated_at = now()
  where project_payment_summary.project_id = target_project_id
  returning * into summary_record;

  return summary_record;
end;
$$;

-- Payment mutations keep the summary current. This runs as a trigger so direct
-- SQL/API writes cannot bypass balance recalculation.
create or replace function public.recalculate_payment_summary_after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalculate_project_payment_summary(new.project_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE')
    and old.project_id is not null
    and (tg_op = 'DELETE' or old.project_id <> new.project_id) then
    perform public.recalculate_project_payment_summary(old.project_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists recalculate_payment_summary_on_payments_change on public.payments;

create trigger recalculate_payment_summary_on_payments_change
after insert or update or delete on public.payments
for each row
execute function public.recalculate_payment_summary_after_payment_change();

grant execute on function public.create_project_payment_summary(uuid) to authenticated;
grant execute on function public.recalculate_project_payment_summary(uuid) to authenticated;

alter table public.project_payment_summary enable row level security;
alter table public.payments enable row level security;

-- Super admins can read and write every payment summary across every organization.
create policy "Super admins can manage project payment summaries"
on public.project_payment_summary
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view payment summaries in their organization with payments view permission.
create policy "Organization users can view project payment summaries"
on public.project_payment_summary
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'view')
);

-- Organization users can create payment summaries inside their organization with payments create permission.
create policy "Organization users can create project payment summaries"
on public.project_payment_summary
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'create')
);

-- Organization users can update payment summaries inside their organization with payments update permission.
create policy "Organization users can update project payment summaries"
on public.project_payment_summary
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'update')
);

-- Payment summary deletion requires explicit payments delete permission.
create policy "Organization users can delete project payment summaries"
on public.project_payment_summary
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'delete')
);

-- Super admins can read and write every payment across every organization.
create policy "Super admins can manage payments"
on public.payments
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view payments in their organization with payments view permission.
create policy "Organization users can view organization payments"
on public.payments
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'view')
);

-- Organization users can create payments only inside their organization with payments create permission.
create policy "Organization users can create organization payments"
on public.payments
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'create')
);

-- Organization users can update payments only inside their organization with payments update permission.
create policy "Organization users can update organization payments"
on public.payments
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'update')
);

-- Payment deletion requires explicit payments delete permission and never crosses organizations.
create policy "Organization users can delete organization payments"
on public.payments
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('payments', 'delete')
);
