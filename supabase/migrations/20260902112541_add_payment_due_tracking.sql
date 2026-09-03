-- Operational payment collection due dates for installation projects and
-- confirmed/dispatched B2B sales. Receipts remain in public.payments.

alter table public.projects
add column if not exists payment_due_on date;

alter table public.b2b_sales
add column if not exists payment_due_on date;

create index if not exists projects_payment_due_on_idx
on public.projects (organization_id, payment_due_on)
where payment_due_on is not null and archived_at is null;

create index if not exists b2b_sales_payment_due_on_idx
on public.b2b_sales (company_id, organization_id, payment_due_on)
where payment_due_on is not null and archived_at is null;

-- Due state is deliberately calculated at read time. It changes with the
-- calendar, so persisting "overdue" would become stale without a daily job.
-- SECURITY INVOKER keeps the caller's existing RLS and module permissions.
create or replace function public.get_payment_due_items(
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
set search_path = public
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

-- A B2B generated proforma carries the sales order's operational due date.
-- The final invoice already copies the proforma due_date.
create or replace function public.create_proforma_invoice_from_b2b_sale(target_sale_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  proforma_record public.proforma_invoices%rowtype;
  current_profile_id uuid;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'cancelled' then
    raise exception 'Cancelled B2B sales cannot be billed'
      using errcode = '23514';
  end if;

  if sale_record.proforma_invoice_id is not null then
    select *
    into proforma_record
    from public.proforma_invoices
    where proforma_invoices.id = sale_record.proforma_invoice_id;

    if found then
      return proforma_record;
    end if;
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
      or not public.user_has_permission('b2b_sales', 'view')
    ) then
    raise exception 'Missing permission to create proforma invoice from B2B sale'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
  ) then
    raise exception 'Add at least one item before creating a B2B proforma invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.proforma_invoices (
    company_id,
    organization_id,
    customer_id,
    b2b_sale_id,
    proforma_date,
    due_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    sale_record.company_id,
    sale_record.organization_id,
    sale_record.customer_id,
    sale_record.id,
    current_date,
    sale_record.payment_due_on,
    0,
    'unpaid',
    'Proforma invoice generated from B2B sale ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  )
  returning * into proforma_record;

  insert into public.proforma_invoice_items (
    company_id,
    organization_id,
    proforma_invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    discount_amount,
    sort_order
  )
  select
    sale_record.company_id,
    sale_record.organization_id,
    proforma_record.id,
    b2b_sale_items.inventory_item_id,
    b2b_sale_items.item_name,
    b2b_sale_items.description,
    b2b_sale_items.quantity,
    b2b_sale_items.unit,
    b2b_sale_items.unit_price,
    b2b_sale_items.gst_percent,
    b2b_sale_items.discount_amount,
    b2b_sale_items.sort_order
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = sale_record.id
  order by b2b_sale_items.sort_order, b2b_sale_items.created_at;

  update public.b2b_sales
  set proforma_invoice_id = proforma_record.id, updated_at = now()
  where b2b_sales.id = sale_record.id;

  return public.recalculate_proforma_invoice_totals(proforma_record.id);
end;
$$;

revoke execute on function public.create_proforma_invoice_from_b2b_sale(uuid)
from public, anon;

grant execute on function public.create_proforma_invoice_from_b2b_sale(uuid)
to authenticated;

notify pgrst, 'reload schema';
