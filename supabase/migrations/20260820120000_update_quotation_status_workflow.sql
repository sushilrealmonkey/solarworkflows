-- Replace the legacy quotation statuses with the current sales workflow.
-- Historical sent/draft quotations remain active as Created; closed legacy
-- statuses are represented as Cancelled.

alter table public.quotations
  drop constraint if exists quotations_status_check;

update public.quotations
set status = case
  when status in ('draft', 'sent') then 'created'
  when status in ('rejected', 'expired') then 'cancelled'
  else status
end
where status in ('draft', 'sent', 'rejected', 'expired');

alter table public.quotations
  add constraint quotations_status_check
  check (status in (
    'created',
    'accepted',
    'cancelled',
    'loan_approval_due',
    'loan_approved'
  ));

-- Created quotations remain editable. All later statuses may only change
-- workflow-owned fields, except through the authorized approval transition.
create or replace function public.protect_non_draft_commercial_record()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  before_data jsonb := to_jsonb(old);
  after_data jsonb := to_jsonb(new);
begin
  if tg_table_name = 'quotations' and old.status <> 'created' then
    before_data := before_data - array['status','approved_by','approved_at','sent_at','accepted_at','rejected_at','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','approved_by','approved_at','sent_at','accepted_at','rejected_at','archived_at','archived_by','archive_reason','updated_at'];

    if current_setting('app.quotation_transition', true) = 'accept' then
      before_data := before_data - array['customer_id','bom_status'];
      after_data := after_data - array['customer_id','bom_status'];
    end if;
  elsif tg_table_name = 'invoices' and old.status <> 'draft' then
    before_data := before_data - array['status','amount_paid','balance_due','sent_at','paid_at','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','amount_paid','balance_due','sent_at','paid_at','archived_at','archived_by','archive_reason','updated_at'];
  elsif tg_table_name = 'proforma_invoices' and old.status <> 'draft' then
    before_data := before_data - array['status','amount_paid','balance_due','sent_at','paid_at','converted_at','final_invoice_id','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','amount_paid','balance_due','sent_at','paid_at','converted_at','final_invoice_id','archived_at','archived_by','archive_reason','updated_at'];
  else
    return new;
  end if;

  if before_data is distinct from after_data then
    raise exception 'Commercial terms are locked after creation. Create a revision instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.create_project_from_quotation(target_quotation_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
  project_record public.projects%rowtype;
  current_profile_id uuid;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if quotation_record.status not in ('accepted', 'loan_approved') then
    raise exception 'Only approved quotations can become projects'
      using errcode = '23514';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot create a project from another organization quotation'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('projects', 'create') then
      raise exception 'Missing projects create permission'
        using errcode = '42501';
    end if;
  end if;

  if quotation_record.lead_id is not null then
    select *
    into customer_record
    from public.convert_lead_to_customer(quotation_record.lead_id);

    if quotation_record.customer_id is null then
      perform set_config('app.quotation_transition', 'accept', true);
      update public.quotations
      set
        customer_id = customer_record.id,
        updated_at = now()
      where quotations.id = quotation_record.id
      returning * into quotation_record;
      perform set_config('app.quotation_transition', '', true);
    end if;
  end if;

  if quotation_record.customer_id is null then
    raise exception 'Quotation needs a customer or lead before a project can be created'
      using errcode = '23503';
  end if;

  select *
  into customer_record
  from public.customers
  where customers.id = quotation_record.customer_id
    and customers.organization_id = quotation_record.organization_id;

  if not found then
    raise exception 'Quotation customer was not found in the same organization'
      using errcode = '23503';
  end if;

  select *
  into project_record
  from public.projects
  where projects.quotation_id = quotation_record.id
    and projects.organization_id = quotation_record.organization_id
  limit 1;

  if found then
    update public.inventory_reservations
    set project_id = project_record.id, updated_at = now()
    where inventory_reservations.quotation_id = quotation_record.id
      and inventory_reservations.organization_id = quotation_record.organization_id
      and inventory_reservations.status in ('active', 'partial', 'shortage')
      and inventory_reservations.project_id is distinct from project_record.id;

    return project_record;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  insert into public.projects (
    organization_id,
    customer_id,
    lead_id,
    quotation_id,
    site_survey_id,
    project_name,
    system_capacity_kw,
    project_type,
    installation_address,
    city,
    district,
    state,
    pincode,
    project_status,
    priority,
    notes,
    created_by
  )
  values (
    quotation_record.organization_id,
    quotation_record.customer_id,
    quotation_record.lead_id,
    quotation_record.id,
    quotation_record.site_survey_id,
    customer_record.full_name || ' Solar Installation - ' || coalesce(quotation_record.quotation_code, 'Quotation'),
    quotation_record.system_capacity_kw,
    coalesce(customer_record.customer_type, 'residential'),
    coalesce(customer_record.address_line_1, ''),
    customer_record.city,
    customer_record.district,
    customer_record.state,
    customer_record.pincode,
    'created',
    'medium',
    quotation_record.notes,
    current_profile_id
  )
  returning * into project_record;

  update public.inventory_reservations
  set project_id = project_record.id, updated_at = now()
  where inventory_reservations.quotation_id = quotation_record.id
    and inventory_reservations.organization_id = quotation_record.organization_id
    and inventory_reservations.status in ('active', 'partial', 'shortage');

  update public.quotations
  set bom_status = 'locked', updated_at = now()
  where quotations.id = quotation_record.id;

  return project_record;
end;
$$;

-- Approve either of the two conversion statuses in one transaction. The
-- lead conversion function is idempotent, so retries do not create duplicates.
create or replace function public.approve_quotation(
  target_quotation_id uuid,
  approval_status text
)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
begin
  if approval_status not in ('accepted', 'loan_approved') then
    raise exception 'Unsupported quotation approval status: %', approval_status
      using errcode = '23514';
  end if;

  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to approve quotation'
      using errcode = '42501';
  end if;

  if quotation_record.lead_id is not null then
    select *
    into customer_record
    from public.convert_lead_to_customer(quotation_record.lead_id);
  end if;

  if quotation_record.customer_id is null and customer_record.id is null then
    raise exception 'Quotation needs a customer or lead before it can be approved'
      using errcode = '23503';
  end if;

  perform set_config('app.quotation_transition', 'accept', true);

  update public.quotations
  set
    customer_id = coalesce(quotation_record.customer_id, customer_record.id),
    status = approval_status,
    bom_status = 'locked',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  perform set_config('app.quotation_transition', '', true);

  if public.subscription_can_write_capability('quotations.inventory_reservations') then
    perform public.sync_inventory_reservations_for_quotation(quotation_record.id);
  end if;
  perform public.create_project_from_quotation(quotation_record.id);

  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id;

  return quotation_record;
end;
$$;

create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language sql
security definer
set search_path = public
as $$
  select public.approve_quotation(target_quotation_id, 'accepted');
$$;

revoke execute on function public.approve_quotation(uuid, text) from public, anon;
grant execute on function public.approve_quotation(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Keep reporting aligned with the new quotation states while preserving the
-- existing RPC result shape used by the dashboard.
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
  pending_documents bigint,
  b2b_customers bigint,
  active_b2b_customers bigint,
  b2b_sales_count bigint,
  b2b_sales_value numeric,
  b2b_sales_received_amount numeric,
  b2b_sales_balance_due numeric
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
    public.count_pending_documents(organizations.id) as pending_documents,
    coalesce(customers_summary.b2b_customers, 0) as b2b_customers,
    coalesce(customers_summary.active_b2b_customers, 0) as active_b2b_customers,
    coalesce(b2b_sales_summary.b2b_sales_count, 0) as b2b_sales_count,
    coalesce(b2b_sales_summary.b2b_sales_value, 0) as b2b_sales_value,
    coalesce(b2b_payments_summary.b2b_sales_received_amount, 0) as b2b_sales_received_amount,
    greatest(
      coalesce(b2b_sales_summary.b2b_sales_value, 0) -
        coalesce(b2b_payments_summary.b2b_sales_received_amount, 0),
      0
    ) as b2b_sales_balance_due
  from public.organizations
  left join (
    select
      customers.organization_id,
      count(*) as total_customers,
      count(*) filter (where customers.customer_segment = 'b2b_direct') as b2b_customers,
      count(*) filter (
        where customers.customer_segment = 'b2b_direct'
          and customers.status = 'active'
      ) as active_b2b_customers
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
      count(*) filter (where quotations.status <> 'cancelled') as quotations_sent,
      count(*) filter (where quotations.status in ('accepted', 'loan_approved')) as quotations_accepted
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
  left join (
    select
      b2b_sales.organization_id,
      count(*) as b2b_sales_count,
      coalesce(sum(b2b_sales.total_amount), 0) as b2b_sales_value
    from public.b2b_sales
    where b2b_sales.status <> 'cancelled'
      and (
        public.is_super_admin()
        or (
          b2b_sales.organization_id = public.current_user_organization_id()
          and b2b_sales.company_id = public.get_current_user_company_id()
        )
      )
    group by b2b_sales.organization_id
  ) b2b_sales_summary on b2b_sales_summary.organization_id = organizations.id
  left join (
    select
      b2b_sales.organization_id,
      coalesce(sum(payments.amount), 0) as b2b_sales_received_amount
    from public.b2b_sales
    join public.payments on payments.b2b_sale_id = b2b_sales.id
      and payments.organization_id = b2b_sales.organization_id
    where b2b_sales.status <> 'cancelled'
      and payments.status = 'received'
      and (
        public.is_super_admin()
        or (
          b2b_sales.organization_id = public.current_user_organization_id()
          and b2b_sales.company_id = public.get_current_user_company_id()
        )
      )
    group by b2b_sales.organization_id
  ) b2b_payments_summary on b2b_payments_summary.organization_id = organizations.id
  where public.is_super_admin()
    or organizations.id = public.current_user_organization_id();
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
      count(*) filter (where quotations.status in ('accepted', 'loan_approved')) as accepted_quotation_count,
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
