-- Step 31 dashboard access update.
-- Dashboard totals are visible to active organization users; report RPCs remain
-- gated by can_view_reports_for_organization and reports:view.

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
  where public.is_super_admin()
    or organizations.id = public.current_user_organization_id();
$$;

grant execute on function public.dashboard_summary() to authenticated;
