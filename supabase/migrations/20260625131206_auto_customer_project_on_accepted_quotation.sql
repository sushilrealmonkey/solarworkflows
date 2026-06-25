-- Automatically complete the downstream workflow when a quotation is accepted:
-- convert the linked lead into a project-based customer, attach that customer
-- to the quotation when it was lead-only, and create the linked project.

create or replace function public.convert_lead_to_customer(target_lead_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_record public.leads%rowtype;
  customer_record public.customers%rowtype;
  current_profile_id uuid;
begin
  select *
  into lead_record
  from public.leads
  where leads.id = target_lead_id
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if lead_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot convert a lead from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('leads', 'update') then
      raise exception 'Missing leads update permission'
        using errcode = '42501';
    end if;

    if lead_record.converted_customer_id is null
      and lead_record.customer_id is null
      and not public.user_has_permission('customers', 'create') then
      raise exception 'Missing customers create permission'
        using errcode = '42501';
    end if;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if lead_record.converted_customer_id is not null then
    select *
    into customer_record
    from public.customers
    where customers.id = lead_record.converted_customer_id
      and customers.organization_id = lead_record.organization_id;
  elsif lead_record.customer_id is not null then
    select *
    into customer_record
    from public.customers
    where customers.id = lead_record.customer_id
      and customers.organization_id = lead_record.organization_id;
  else
    insert into public.customers (
      organization_id,
      customer_segment,
      full_name,
      phone,
      alternate_phone,
      email,
      address_line_1,
      city,
      district,
      state,
      pincode,
      lead_source,
      status,
      notes,
      created_by,
      assigned_to
    )
    values (
      lead_record.organization_id,
      'project_based',
      lead_record.full_name,
      lead_record.phone,
      lead_record.alternate_phone,
      lead_record.email,
      lead_record.address,
      lead_record.city,
      lead_record.district,
      lead_record.state,
      lead_record.pincode,
      lead_record.lead_source,
      'active',
      lead_record.notes,
      coalesce(current_profile_id, lead_record.created_by),
      lead_record.assigned_to
    )
    returning * into customer_record;
  end if;

  if customer_record.id is null then
    raise exception 'Lead customer was not found in the same organization'
      using errcode = '23503';
  end if;

  update public.leads
  set
    status = 'converted',
    converted_customer_id = customer_record.id,
    converted_at = coalesce(public.leads.converted_at, now()),
    customer_id = coalesce(public.leads.customer_id, customer_record.id),
    updated_at = now()
  where public.leads.id = lead_record.id;

  return customer_record;
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

  if quotation_record.status <> 'accepted' then
    raise exception 'Only accepted quotations can become projects'
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
      update public.quotations
      set
        customer_id = customer_record.id,
        updated_at = now()
      where quotations.id = quotation_record.id
      returning * into quotation_record;
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

create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
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

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to accept quotation'
      using errcode = '42501';
  end if;

  if quotation_record.lead_id is not null then
    select *
    into customer_record
    from public.convert_lead_to_customer(quotation_record.lead_id);
  end if;

  if quotation_record.customer_id is null and customer_record.id is null then
    raise exception 'Quotation needs a customer or lead before it can be accepted'
      using errcode = '23503';
  end if;

  update public.quotations
  set
    customer_id = coalesce(quotation_record.customer_id, customer_record.id),
    status = 'accepted',
    bom_status = 'locked',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  perform public.sync_inventory_reservations_for_quotation(quotation_record.id);
  perform public.create_project_from_quotation(quotation_record.id);

  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id;

  return quotation_record;
end;
$$;

revoke execute on function public.convert_lead_to_customer(uuid) from public, anon;
revoke execute on function public.create_project_from_quotation(uuid) from public, anon;
revoke execute on function public.accept_quotation(uuid) from public, anon;

grant execute on function public.convert_lead_to_customer(uuid) to authenticated;
grant execute on function public.create_project_from_quotation(uuid) to authenticated;
grant execute on function public.accept_quotation(uuid) to authenticated;

notify pgrst, 'reload schema';
