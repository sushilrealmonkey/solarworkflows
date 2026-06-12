-- Removes the active Default BOM Products workflow.
-- Existing columns remain harmless for compatibility, but settings updates no
-- longer write them and BOM rows are now manually product-selected.

drop trigger if exists validate_organization_bom_defaults on public.organization_settings;
drop function if exists public.validate_organization_bom_defaults();
drop function if exists public.assert_bom_default_product(uuid, uuid, public.product_category_type, text);

create or replace function public.create_quotation_bom_item(
  target_quotation_id uuid,
  selected_product_category_id uuid,
  selected_product_id uuid default null,
  entered_item_name text default null,
  entered_quantity numeric default 1,
  entered_unit text default null,
  entered_notes text default null
)
returns public.quotation_bom_items
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  inserted_item public.quotation_bom_items%rowtype;
  next_display_order integer;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if quotation_record.id is null then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if selected_product_id is null then
    raise exception 'Select a product before saving the BOM row.'
      using errcode = '23502';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to edit quotation BOM'
      using errcode = '42501';
  end if;

  if quotation_record.bom_status = 'locked' then
    raise exception 'BOM is locked for this quotation.'
      using errcode = '23514';
  end if;

  select coalesce(max(display_order), 0) + 1
  into next_display_order
  from public.quotation_bom_items
  where quotation_id = quotation_record.id
    and tenant_id = quotation_record.organization_id;

  insert into public.quotation_bom_items (
    tenant_id,
    quotation_id,
    product_category_id,
    product_id,
    item_name,
    calculation_type,
    quantity,
    required_qty,
    unit,
    is_required,
    manually_modified,
    manual_override,
    is_auto_generated,
    display_order,
    notes
  )
  values (
    quotation_record.organization_id,
    quotation_record.id,
    selected_product_category_id,
    selected_product_id,
    null,
    'manual',
    coalesce(entered_quantity, 0),
    coalesce(entered_quantity, 0),
    entered_unit,
    true,
    true,
    true,
    false,
    next_display_order,
    entered_notes
  )
  returning * into inserted_item;

  update public.quotations
  set bom_status = 'edited', updated_at = now()
  where quotations.id = quotation_record.id;

  return inserted_item;
end;
$$;

create or replace function public.update_quotation_bom_item(
  target_item_id uuid,
  selected_product_category_id uuid,
  selected_product_id uuid default null,
  entered_item_name text default null,
  entered_quantity numeric default 1,
  entered_unit text default null,
  entered_notes text default null
)
returns public.quotation_bom_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item public.quotation_bom_items%rowtype;
  quotation_record public.quotations%rowtype;
  updated_item public.quotation_bom_items%rowtype;
begin
  select *
  into current_item
  from public.quotation_bom_items
  where quotation_bom_items.id = target_item_id
  for update;

  if current_item.id is null then
    raise exception 'BOM item not found'
      using errcode = 'P0002';
  end if;

  if selected_product_id is null then
    raise exception 'Select a product before saving the BOM row.'
      using errcode = '23502';
  end if;

  select *
  into quotation_record
  from public.quotations
  where quotations.id = current_item.quotation_id
  for update;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to edit quotation BOM'
      using errcode = '42501';
  end if;

  if quotation_record.bom_status = 'locked' then
    raise exception 'BOM is locked for this quotation.'
      using errcode = '23514';
  end if;

  update public.quotation_bom_items
  set
    product_category_id = selected_product_category_id,
    product_id = selected_product_id,
    item_name = null,
    quantity = coalesce(entered_quantity, 0),
    required_qty = coalesce(entered_quantity, 0),
    unit = entered_unit,
    notes = entered_notes,
    manually_modified = true,
    manual_override = true,
    is_auto_generated = false
  where quotation_bom_items.id = current_item.id
  returning * into updated_item;

  update public.quotations
  set bom_status = 'edited', updated_at = now()
  where quotations.id = quotation_record.id;

  return updated_item;
end;
$$;

create or replace function public.update_organization_settings(settings jsonb)
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  incoming_settings jsonb := coalesce(settings, '{}'::jsonb);
  updated_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update organization settings'
      using errcode = '42501';
  end if;

  if jsonb_typeof(incoming_settings) <> 'object' then
    raise exception 'settings must be a JSON object'
      using errcode = '22023';
  end if;

  if not public.user_has_permission('settings', 'update') then
    raise exception 'Missing permission to update organization settings'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  update public.organization_settings as organization_settings
  set
    company_name = case when incoming_settings ? 'company_name' then incoming_settings ->> 'company_name' else organization_settings.company_name end,
    company_details = case when incoming_settings ? 'company_details' then incoming_settings ->> 'company_details' else organization_settings.company_details end,
    company_logo_url = case when incoming_settings ? 'company_logo_url' then incoming_settings ->> 'company_logo_url' else organization_settings.company_logo_url end,
    favicon_url = case when incoming_settings ? 'favicon_url' then incoming_settings ->> 'favicon_url' else organization_settings.favicon_url end,
    primary_color = case when incoming_settings ? 'primary_color' then incoming_settings ->> 'primary_color' else organization_settings.primary_color end,
    secondary_color = case when incoming_settings ? 'secondary_color' then incoming_settings ->> 'secondary_color' else organization_settings.secondary_color end,
    accent_color = case when incoming_settings ? 'accent_color' then incoming_settings ->> 'accent_color' else organization_settings.accent_color end,
    font_family = case when incoming_settings ? 'font_family' then incoming_settings ->> 'font_family' else organization_settings.font_family end,
    address = case when incoming_settings ? 'address' then incoming_settings ->> 'address' else organization_settings.address end,
    contact_person = case when incoming_settings ? 'contact_person' then incoming_settings ->> 'contact_person' else organization_settings.contact_person end,
    contact_email = case when incoming_settings ? 'contact_email' then incoming_settings ->> 'contact_email' else organization_settings.contact_email end,
    contact_phone = case when incoming_settings ? 'contact_phone' then incoming_settings ->> 'contact_phone' else organization_settings.contact_phone end,
    gst_number = case when incoming_settings ? 'gst_number' then incoming_settings ->> 'gst_number' else organization_settings.gst_number end,
    bank_account_holder_name = case when incoming_settings ? 'bank_account_holder_name' then incoming_settings ->> 'bank_account_holder_name' else organization_settings.bank_account_holder_name end,
    bank_name = case when incoming_settings ? 'bank_name' then incoming_settings ->> 'bank_name' else organization_settings.bank_name end,
    bank_ifsc_code = case when incoming_settings ? 'bank_ifsc_code' then incoming_settings ->> 'bank_ifsc_code' else organization_settings.bank_ifsc_code end,
    bank_account_number = case when incoming_settings ? 'bank_account_number' then incoming_settings ->> 'bank_account_number' else organization_settings.bank_account_number end,
    bank_account_type = case when incoming_settings ? 'bank_account_type' then incoming_settings ->> 'bank_account_type' else organization_settings.bank_account_type end,
    invoice_prefix = case when incoming_settings ? 'invoice_prefix' then incoming_settings ->> 'invoice_prefix' else organization_settings.invoice_prefix end,
    quotation_prefix = case when incoming_settings ? 'quotation_prefix' then incoming_settings ->> 'quotation_prefix' else organization_settings.quotation_prefix end,
    customer_prefix = case when incoming_settings ? 'customer_prefix' then incoming_settings ->> 'customer_prefix' else organization_settings.customer_prefix end,
    project_prefix = case when incoming_settings ? 'project_prefix' then incoming_settings ->> 'project_prefix' else organization_settings.project_prefix end,
    lead_prefix = case when incoming_settings ? 'lead_prefix' then incoming_settings ->> 'lead_prefix' else organization_settings.lead_prefix end,
    timezone = case when incoming_settings ? 'timezone' then incoming_settings ->> 'timezone' else organization_settings.timezone end,
    currency = case when incoming_settings ? 'currency' then incoming_settings ->> 'currency' else organization_settings.currency end,
    date_format = case when incoming_settings ? 'date_format' then incoming_settings ->> 'date_format' else organization_settings.date_format end
  where organization_settings.organization_id = current_organization_id
  returning * into updated_settings;

  return updated_settings;
end;
$$;

grant execute on function public.create_quotation_bom_item(uuid, uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.update_quotation_bom_item(uuid, uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.update_organization_settings(jsonb) to authenticated;

notify pgrst, 'reload schema';
