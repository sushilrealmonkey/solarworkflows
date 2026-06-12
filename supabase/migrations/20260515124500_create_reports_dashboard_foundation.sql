-- Step 16 reports and dashboard metrics foundation.
-- Creates database-only reporting functions. No frontend screens are added here.

-- Centralizes report visibility. Report functions run as security definer, so
-- every report explicitly calls this helper before reading operational tables.
create or replace function public.can_view_reports_for_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or (
      target_organization_id = public.current_user_organization_id()
      and public.user_has_permission('reports', 'view')
    );
$$;

-- Documents are not present in the current migration chain. This helper keeps
-- dashboard_summary safe now and can count a future public.documents table when
-- it exposes organization_id plus status or document_status.
create or replace function public.count_pending_documents(target_organization_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pending_count bigint := 0;
  status_column text;
begin
  if to_regclass('public.documents') is null then
    return 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'organization_id'
  ) then
    return 0;
  end if;

  select document_columns.column_name
  into status_column
  from information_schema.columns as document_columns
  where document_columns.table_schema = 'public'
    and document_columns.table_name = 'documents'
    and document_columns.column_name in ('document_status', 'status')
  order by case document_columns.column_name when 'document_status' then 1 else 2 end
  limit 1;

  if status_column is null then
    return 0;
  end if;

  execute format(
    'select count(*)
     from public.documents
     where organization_id = $1
       and %I in (''pending'', ''requested'', ''missing'', ''expired'', ''rejected'')',
    status_column
  )
  into pending_count
  using target_organization_id;

  return coalesce(pending_count, 0);
end;
$$;

create or replace function public.dashboard_summary()
returns table (
  organization_id uuid,
  total_customers bigint,
  total_leads bigint,
  active_projects bigint,
  completed_projects bigint,
  pending_site_surveys bigint,
  quotations_sent bigint,
  quotations_accepted bigint,
  total_project_value numeric,
  total_received_amount numeric,
  total_balance_due numeric,
  low_stock_items bigint,
  pending_documents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    organizations.id as organization_id,
    coalesce(customers_summary.total_customers, 0) as total_customers,
    coalesce(leads_summary.total_leads, 0) as total_leads,
    coalesce(projects_summary.active_projects, 0) as active_projects,
    coalesce(projects_summary.completed_projects, 0) as completed_projects,
    coalesce(site_surveys_summary.pending_site_surveys, 0) as pending_site_surveys,
    coalesce(quotations_summary.quotations_sent, 0) as quotations_sent,
    coalesce(quotations_summary.quotations_accepted, 0) as quotations_accepted,
    coalesce(payments_summary.total_project_value, 0) as total_project_value,
    coalesce(payments_summary.total_received_amount, 0) as total_received_amount,
    coalesce(payments_summary.total_balance_due, 0) as total_balance_due,
    coalesce(inventory_summary.low_stock_items, 0) as low_stock_items,
    public.count_pending_documents(organizations.id) as pending_documents
  from public.organizations
  left join (
    select customers.organization_id, count(*) as total_customers
    from public.customers
    group by customers.organization_id
  ) customers_summary on customers_summary.organization_id = organizations.id
  left join (
    select leads.organization_id, count(*) as total_leads
    from public.leads
    group by leads.organization_id
  ) leads_summary on leads_summary.organization_id = organizations.id
  left join (
    select
      projects.organization_id,
      count(*) filter (
        where projects.project_status not in ('installation_completed', 'commissioned', 'cancelled')
      ) as active_projects,
      count(*) filter (
        where projects.project_status in ('installation_completed', 'commissioned')
      ) as completed_projects
    from public.projects
    group by projects.organization_id
  ) projects_summary on projects_summary.organization_id = organizations.id
  left join (
    select
      site_surveys.organization_id,
      count(*) filter (
        where site_surveys.survey_status in ('scheduled', 'in_progress', 'rescheduled')
      ) as pending_site_surveys
    from public.site_surveys
    group by site_surveys.organization_id
  ) site_surveys_summary on site_surveys_summary.organization_id = organizations.id
  left join (
    select
      quotations.organization_id,
      count(*) filter (where quotations.status = 'sent') as quotations_sent,
      count(*) filter (where quotations.status = 'accepted') as quotations_accepted
    from public.quotations
    group by quotations.organization_id
  ) quotations_summary on quotations_summary.organization_id = organizations.id
  left join (
    select
      project_payment_summary.organization_id,
      coalesce(sum(project_payment_summary.total_project_amount), 0) as total_project_value,
      coalesce(sum(project_payment_summary.amount_received), 0) as total_received_amount,
      coalesce(sum(project_payment_summary.balance_due), 0) as total_balance_due
    from public.project_payment_summary
    group by project_payment_summary.organization_id
  ) payments_summary on payments_summary.organization_id = organizations.id
  left join (
    select inventory_items.organization_id, count(*) as low_stock_items
    from public.inventory_items
    where inventory_items.status = 'active'
      and inventory_items.current_stock <= inventory_items.minimum_stock
    group by inventory_items.organization_id
  ) inventory_summary on inventory_summary.organization_id = organizations.id
  where public.can_view_reports_for_organization(organizations.id);
$$;

create or replace function public.sales_report(start_date date, end_date date)
returns table (
  organization_id uuid,
  quotation_count bigint,
  accepted_quotation_count bigint,
  total_quotation_value numeric,
  project_count bigint,
  total_project_value numeric,
  invoice_total numeric,
  payment_received_total numeric,
  balance_due_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with report_window as (
    select
      coalesce(start_date, '-infinity'::date) as start_date,
      coalesce(end_date, 'infinity'::date) as end_date
  )
  select
    organizations.id as organization_id,
    coalesce(quotations_summary.quotation_count, 0) as quotation_count,
    coalesce(quotations_summary.accepted_quotation_count, 0) as accepted_quotation_count,
    coalesce(quotations_summary.total_quotation_value, 0) as total_quotation_value,
    coalesce(projects_summary.project_count, 0) as project_count,
    coalesce(projects_summary.total_project_value, 0) as total_project_value,
    coalesce(invoices_summary.invoice_total, 0) as invoice_total,
    coalesce(payments_summary.payment_received_total, 0) as payment_received_total,
    coalesce(invoices_summary.balance_due_total, 0) as balance_due_total
  from public.organizations
  cross join report_window
  left join (
    select
      quotations.organization_id,
      count(*) as quotation_count,
      count(*) filter (where quotations.status = 'accepted') as accepted_quotation_count,
      coalesce(sum(quotations.total_amount), 0) as total_quotation_value
    from public.quotations, report_window
    where quotations.quotation_date between report_window.start_date and report_window.end_date
    group by quotations.organization_id
  ) quotations_summary on quotations_summary.organization_id = organizations.id
  left join (
    select
      projects.organization_id,
      count(*) as project_count,
      coalesce(sum(project_payment_summary.total_project_amount), 0) as total_project_value
    from public.projects
    left join public.project_payment_summary on project_payment_summary.project_id = projects.id
      and project_payment_summary.organization_id = projects.organization_id
    cross join report_window
    where projects.created_at::date between report_window.start_date and report_window.end_date
    group by projects.organization_id
  ) projects_summary on projects_summary.organization_id = organizations.id
  left join (
    select
      invoices.organization_id,
      coalesce(sum(invoices.total_amount), 0) as invoice_total,
      coalesce(sum(invoices.balance_due), 0) as balance_due_total
    from public.invoices, report_window
    where invoices.invoice_date between report_window.start_date and report_window.end_date
      and invoices.status <> 'cancelled'
    group by invoices.organization_id
  ) invoices_summary on invoices_summary.organization_id = organizations.id
  left join (
    select
      payments.organization_id,
      coalesce(sum(payments.amount), 0) as payment_received_total
    from public.payments, report_window
    where payments.payment_date between report_window.start_date and report_window.end_date
      and payments.status = 'received'
    group by payments.organization_id
  ) payments_summary on payments_summary.organization_id = organizations.id
  where public.can_view_reports_for_organization(organizations.id);
$$;

create or replace function public.project_status_report()
returns table (
  organization_id uuid,
  project_status text,
  project_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    projects.organization_id,
    projects.project_status,
    count(*) as project_count
  from public.projects
  where public.can_view_reports_for_organization(projects.organization_id)
  group by projects.organization_id, projects.project_status
  order by projects.organization_id, projects.project_status;
$$;

create or replace function public.lead_status_report()
returns table (
  organization_id uuid,
  status text,
  lead_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    leads.organization_id,
    leads.status,
    count(*) as lead_count
  from public.leads
  where public.can_view_reports_for_organization(leads.organization_id)
  group by leads.organization_id, leads.status
  order by leads.organization_id, leads.status;
$$;

create or replace function public.payment_report(start_date date, end_date date)
returns table (
  organization_id uuid,
  payment_source text,
  payment_mode text,
  total_amount numeric,
  payment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    payments.organization_id,
    payments.payment_source,
    payments.payment_mode,
    coalesce(sum(payments.amount), 0) as total_amount,
    count(*) as payment_count
  from public.payments
  where public.can_view_reports_for_organization(payments.organization_id)
    and payments.payment_date between coalesce(start_date, '-infinity'::date) and coalesce(end_date, 'infinity'::date)
    and payments.status = 'received'
  group by payments.organization_id, payments.payment_source, payments.payment_mode
  order by payments.organization_id, payments.payment_source, payments.payment_mode;
$$;

create or replace function public.inventory_low_stock_report()
returns table (
  organization_id uuid,
  item_id uuid,
  item_code text,
  item_name text,
  item_category text,
  brand text,
  model text,
  unit text,
  current_stock numeric,
  minimum_stock numeric,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    inventory_items.organization_id,
    inventory_items.id as item_id,
    inventory_items.item_code,
    inventory_items.item_name,
    inventory_items.item_category,
    inventory_items.brand,
    inventory_items.model,
    inventory_items.unit,
    inventory_items.current_stock,
    inventory_items.minimum_stock,
    inventory_items.status
  from public.inventory_items
  where public.can_view_reports_for_organization(inventory_items.organization_id)
    and inventory_items.current_stock <= inventory_items.minimum_stock
  order by inventory_items.organization_id, inventory_items.item_name;
$$;

revoke execute on function public.can_view_reports_for_organization(uuid) from public;
revoke execute on function public.count_pending_documents(uuid) from public;

grant execute on function public.dashboard_summary() to authenticated;
grant execute on function public.sales_report(date, date) to authenticated;
grant execute on function public.project_status_report() to authenticated;
grant execute on function public.lead_status_report() to authenticated;
grant execute on function public.payment_report(date, date) to authenticated;
grant execute on function public.inventory_low_stock_report() to authenticated;
