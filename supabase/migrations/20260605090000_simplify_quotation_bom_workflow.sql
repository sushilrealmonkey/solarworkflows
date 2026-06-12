-- Simplifies quotation BOM generation away from templates/rules.
-- Existing template tables are left in place for compatibility, but quotation
-- BOM rows are now generated from quotation details and tenant default products.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'quotation_bom_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.quotation_bom_status as enum (
      'not_generated',
      'generated',
      'edited',
      'locked'
    );
  end if;
end;
$$;

alter table public.quotations
add column if not exists bom_status public.quotation_bom_status not null default 'not_generated';

create index if not exists quotations_bom_status_idx
on public.quotations (organization_id, bom_status);

alter table public.quotation_bom_items
alter column bom_template_rule_id drop not null;

alter table public.quotation_bom_items
add column if not exists item_name text,
add column if not exists manual_override boolean not null default false,
add column if not exists required_qty numeric,
add column if not exists reserved_qty numeric not null default 0,
add column if not exists issued_qty numeric not null default 0;

update public.quotation_bom_items
set
  manual_override = coalesce(manually_modified, manual_override, false),
  required_qty = coalesce(required_qty, quantity)
where manual_override is distinct from coalesce(manually_modified, manual_override, false)
  or required_qty is null;

alter table public.quotation_bom_items
drop constraint if exists quotation_bom_items_quantity_positive_check;

alter table public.quotation_bom_items
drop constraint if exists quotation_bom_items_quantity_non_negative_check;

alter table public.quotation_bom_items
add constraint quotation_bom_items_quantity_non_negative_check
check (
  quantity >= 0
  and (required_qty is null or required_qty >= 0)
  and reserved_qty >= 0
  and issued_qty >= 0
);

create index if not exists quotation_bom_items_manual_override_idx
on public.quotation_bom_items (quotation_id, manual_override);

alter table public.organization_settings
add column if not exists default_bom_panel_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_inverter_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_structure_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_dc_cable_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_ac_cable_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_earthing_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_lightning_arrestor_product_id uuid references public.products(id) on delete set null,
add column if not exists default_bom_structure_qty_per_panel numeric not null default 1,
add column if not exists default_bom_dc_cable_m_per_kw numeric not null default 20,
add column if not exists default_bom_ac_cable_m_per_kw numeric not null default 10,
add column if not exists default_bom_earthing_qty numeric not null default 3,
add column if not exists default_bom_lightning_arrestor_qty numeric not null default 1,
add column if not exists default_bom_installation_qty numeric not null default 1;

alter table public.organization_settings
drop constraint if exists organization_settings_default_bom_qty_check;

alter table public.organization_settings
add constraint organization_settings_default_bom_qty_check
check (
  default_bom_structure_qty_per_panel >= 0
  and default_bom_dc_cable_m_per_kw >= 0
  and default_bom_ac_cable_m_per_kw >= 0
  and default_bom_earthing_qty >= 0
  and default_bom_lightning_arrestor_qty >= 0
  and default_bom_installation_qty >= 0
);

create or replace function public.assert_bom_default_product(
  selected_product_id uuid,
  expected_organization_id uuid,
  expected_category_type public.product_category_type,
  field_label text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_product record;
begin
  if selected_product_id is null then
    return;
  end if;

  select products.tenant_id, products.category_type
  into selected_product
  from public.products
  where products.id = selected_product_id;

  if selected_product.tenant_id is null then
    raise exception '% product was not found', field_label
      using errcode = '23503';
  end if;

  if selected_product.tenant_id <> expected_organization_id then
    raise exception '% product must belong to this organization', field_label
      using errcode = '23503';
  end if;

  if selected_product.category_type <> expected_category_type then
    raise exception '% product must use % category type', field_label, expected_category_type
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.validate_organization_bom_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_bom_default_product(new.default_bom_panel_product_id, new.organization_id, 'SOLAR_PANEL', 'Default panel');
  perform public.assert_bom_default_product(new.default_bom_inverter_product_id, new.organization_id, 'INVERTER', 'Default inverter');
  perform public.assert_bom_default_product(new.default_bom_structure_product_id, new.organization_id, 'STRUCTURE', 'Default structure');
  perform public.assert_bom_default_product(new.default_bom_dc_cable_product_id, new.organization_id, 'DC_CABLE', 'Default DC cable');
  perform public.assert_bom_default_product(new.default_bom_ac_cable_product_id, new.organization_id, 'AC_CABLE', 'Default AC cable');
  perform public.assert_bom_default_product(new.default_bom_earthing_product_id, new.organization_id, 'EARTHING', 'Default earthing kit');
  perform public.assert_bom_default_product(new.default_bom_lightning_arrestor_product_id, new.organization_id, 'LIGHTNING_ARRESTOR', 'Default lightning arrester');

  return new;
end;
$$;

drop trigger if exists validate_organization_bom_defaults on public.organization_settings;

create trigger validate_organization_bom_defaults
before insert or update on public.organization_settings
for each row
execute function public.validate_organization_bom_defaults();

create or replace function public.set_quotation_bom_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_quotation public.quotations%rowtype;
  parent_rule public.bom_template_lines%rowtype;
  selected_category_tenant_id uuid;
  selected_product_tenant_id uuid;
  selected_product_category_id uuid;
begin
  new.item_name := nullif(btrim(coalesce(new.item_name, '')), '');
  new.unit := nullif(lower(btrim(coalesce(new.unit, ''))), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);
  new.manual_override := coalesce(new.manual_override, new.manually_modified, false);
  new.manually_modified := coalesce(new.manually_modified, new.manual_override, false);
  new.is_auto_generated := coalesce(new.is_auto_generated, true);
  new.required_qty := coalesce(new.required_qty, new.quantity);
  new.reserved_qty := coalesce(new.reserved_qty, 0);
  new.issued_qty := coalesce(new.issued_qty, 0);

  select *
  into parent_quotation
  from public.quotations
  where quotations.id = new.quotation_id;

  if parent_quotation.id is null then
    raise exception 'quotation_id must reference an existing quotation'
      using errcode = '23503';
  end if;

  if new.tenant_id is null then
    new.tenant_id := parent_quotation.organization_id;
  end if;

  if new.tenant_id <> parent_quotation.organization_id then
    raise exception 'quotation BOM item tenant_id must match the quotation organization'
      using errcode = '23503';
  end if;

  if new.bom_template_rule_id is not null then
    select *
    into parent_rule
    from public.bom_template_lines
    where bom_template_lines.id = new.bom_template_rule_id;

    if parent_rule.id is null then
      raise exception 'bom_template_rule_id must reference an existing BOM template rule'
        using errcode = '23503';
    end if;

    if parent_rule.tenant_id <> new.tenant_id then
      raise exception 'bom_template_rule_id must belong to the same tenant as the quotation BOM item'
        using errcode = '23503';
    end if;

    if parent_rule.calculation_type <> new.calculation_type then
      raise exception 'calculation_type must match the BOM template rule'
        using errcode = '23503';
    end if;

    if parent_rule.product_category_id <> new.product_category_id then
      raise exception 'product_category_id must match the BOM template rule category'
        using errcode = '23503';
    end if;
  end if;

  select product_categories.tenant_id
  into selected_category_tenant_id
  from public.product_categories
  where product_categories.id = new.product_category_id;

  if selected_category_tenant_id is null then
    raise exception 'product_category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if selected_category_tenant_id <> new.tenant_id then
    raise exception 'product_category_id must belong to the same tenant as the quotation BOM item'
      using errcode = '23503';
  end if;

  if new.product_id is not null then
    select products.tenant_id, products.category_id
    into selected_product_tenant_id, selected_product_category_id
    from public.products
    where products.id = new.product_id;

    if selected_product_tenant_id is null then
      raise exception 'product_id must reference an existing product'
        using errcode = '23503';
    end if;

    if selected_product_tenant_id <> new.tenant_id then
      raise exception 'product_id must belong to the same tenant as the quotation BOM item'
        using errcode = '23503';
    end if;

    if selected_product_category_id <> new.product_category_id then
      raise exception 'product_id must belong to the selected product category'
        using errcode = '23503';
    end if;
  end if;

  if new.product_id is null and new.item_name is null then
    raise exception 'item_name is required when product is not selected'
      using errcode = '23502';
  end if;

  return new;
end;
$$;

create or replace function public.bom_product_category_id(selected_product_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select products.category_id
  from public.products
  where products.id = selected_product_id
$$;

create or replace function public.bom_category_id(
  target_tenant_id uuid,
  target_category_type public.product_category_type
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select product_categories.id
  from public.product_categories
  where product_categories.tenant_id = target_tenant_id
    and product_categories.category_type = target_category_type
  order by product_categories.display_order, product_categories.name
  limit 1
$$;

create or replace function public.generate_quotation_bom_items(
  target_quotation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  settings_record public.organization_settings%rowtype;
  inserted_count integer;
  system_capacity numeric;
  panel_wattage numeric;
  panel_qty numeric;
  lightning_required boolean;
  missing_defaults text[] := array[]::text[];
  other_category_id uuid;
  has_manual_overrides boolean;
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

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to generate quotation BOM'
      using errcode = '42501';
  end if;

  if quotation_record.bom_status = 'locked' then
    raise exception 'BOM is locked for this quotation.'
      using errcode = '23514';
  end if;

  system_capacity := quotation_record.system_capacity_kw;
  panel_wattage := quotation_record.summary_module_wattage;
  lightning_required := quotation_record.summary_lightning_arrestor_included is distinct from false;

  if system_capacity is null or system_capacity <= 0 then
    raise exception 'Enter system capacity greater than 0 before generating BOM.'
      using errcode = '23514';
  end if;

  if panel_wattage is null or panel_wattage <= 0 then
    raise exception 'Enter panel wattage greater than 0 before generating BOM.'
      using errcode = '23514';
  end if;

  insert into public.organization_settings (organization_id)
  values (quotation_record.organization_id)
  on conflict (organization_id) do nothing;

  select *
  into settings_record
  from public.organization_settings
  where organization_settings.organization_id = quotation_record.organization_id;

  if settings_record.default_bom_panel_product_id is null then
    missing_defaults := missing_defaults || 'Default Panel';
  end if;
  if settings_record.default_bom_inverter_product_id is null then
    missing_defaults := missing_defaults || 'Default Inverter';
  end if;
  if settings_record.default_bom_structure_product_id is null then
    missing_defaults := missing_defaults || 'Default Structure';
  end if;
  if settings_record.default_bom_dc_cable_product_id is null then
    missing_defaults := missing_defaults || 'Default DC Cable';
  end if;
  if settings_record.default_bom_ac_cable_product_id is null then
    missing_defaults := missing_defaults || 'Default AC Cable';
  end if;
  if settings_record.default_bom_earthing_product_id is null then
    missing_defaults := missing_defaults || 'Default Earthing Kit';
  end if;
  if lightning_required and settings_record.default_bom_lightning_arrestor_product_id is null then
    missing_defaults := missing_defaults || 'Default Lightning Arrester';
  end if;

  other_category_id := public.bom_category_id(quotation_record.organization_id, 'OTHER');
  if other_category_id is null then
    missing_defaults := missing_defaults || 'Other Product Category';
  end if;

  if array_length(missing_defaults, 1) is not null then
    raise exception 'Set up Default BOM Products before generating BOM: %.', array_to_string(missing_defaults, ', ')
      using errcode = '23502';
  end if;

  panel_qty := ceil((system_capacity * 1000) / panel_wattage);

  select exists (
    select 1
    from public.quotation_bom_items
    where quotation_bom_items.quotation_id = quotation_record.id
      and quotation_bom_items.tenant_id = quotation_record.organization_id
      and quotation_bom_items.manual_override = true
  )
  into has_manual_overrides;

  delete from public.quotation_bom_items
  where quotation_bom_items.quotation_id = quotation_record.id
    and quotation_bom_items.tenant_id = quotation_record.organization_id
    and quotation_bom_items.is_auto_generated = true
    and quotation_bom_items.manual_override = false;

  insert into public.quotation_bom_items (
    tenant_id,
    quotation_id,
    bom_template_rule_id,
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
  select
    quotation_record.organization_id,
    quotation_record.id,
    null,
    generated_rows.product_category_id,
    generated_rows.product_id,
    generated_rows.item_name,
    generated_rows.calculation_type,
    generated_rows.quantity,
    generated_rows.quantity,
    generated_rows.unit,
    true,
    false,
    false,
    true,
    generated_rows.display_order,
    generated_rows.notes
  from (
    values
      (
        1,
        public.bom_product_category_id(settings_record.default_bom_panel_product_id),
        settings_record.default_bom_panel_product_id,
        null::text,
        'panel_count'::public.bom_calculation_type,
        panel_qty,
        'piece',
        'Panel quantity is calculated from system capacity and quotation panel wattage.'
      ),
      (
        2,
        public.bom_product_category_id(settings_record.default_bom_inverter_product_id),
        settings_record.default_bom_inverter_product_id,
        null::text,
        'inverter_count'::public.bom_calculation_type,
        1::numeric,
        'piece',
        null::text
      ),
      (
        3,
        public.bom_product_category_id(settings_record.default_bom_structure_product_id),
        settings_record.default_bom_structure_product_id,
        null::text,
        'panel_count'::public.bom_calculation_type,
        panel_qty * coalesce(settings_record.default_bom_structure_qty_per_panel, 1),
        'set',
        null::text
      ),
      (
        4,
        public.bom_product_category_id(settings_record.default_bom_dc_cable_product_id),
        settings_record.default_bom_dc_cable_product_id,
        null::text,
        'per_kw'::public.bom_calculation_type,
        system_capacity * coalesce(settings_record.default_bom_dc_cable_m_per_kw, 20),
        'meter',
        null::text
      ),
      (
        5,
        public.bom_product_category_id(settings_record.default_bom_ac_cable_product_id),
        settings_record.default_bom_ac_cable_product_id,
        null::text,
        'per_kw'::public.bom_calculation_type,
        system_capacity * coalesce(settings_record.default_bom_ac_cable_m_per_kw, 10),
        'meter',
        null::text
      ),
      (
        6,
        public.bom_product_category_id(settings_record.default_bom_earthing_product_id),
        settings_record.default_bom_earthing_product_id,
        null::text,
        'fixed_quantity'::public.bom_calculation_type,
        coalesce(quotation_record.summary_earthing_count, settings_record.default_bom_earthing_qty, 3),
        'set',
        null::text
      ),
      (
        7,
        public.bom_product_category_id(settings_record.default_bom_lightning_arrestor_product_id),
        settings_record.default_bom_lightning_arrestor_product_id,
        null::text,
        'fixed_quantity'::public.bom_calculation_type,
        coalesce(settings_record.default_bom_lightning_arrestor_qty, 1),
        'piece',
        null::text
      ),
      (
        8,
        other_category_id,
        null::uuid,
        'Installation & Commissioning',
        'fixed_quantity'::public.bom_calculation_type,
        coalesce(settings_record.default_bom_installation_qty, 1),
        'job',
        null::text
      )
  ) as generated_rows(display_order, product_category_id, product_id, item_name, calculation_type, quantity, unit, notes)
  where generated_rows.product_category_id is not null
    and (generated_rows.display_order <> 7 or lightning_required)
  order by generated_rows.display_order;

  get diagnostics inserted_count = row_count;

  update public.quotations
  set
    bom_status = case when has_manual_overrides then 'edited'::public.quotation_bom_status else 'generated'::public.quotation_bom_status end,
    updated_at = now()
  where quotations.id = quotation_record.id;

  return inserted_count;
end;
$$;

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
    entered_item_name,
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
    item_name = entered_item_name,
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

create or replace function public.delete_quotation_bom_item(
  target_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item public.quotation_bom_items%rowtype;
  quotation_record public.quotations%rowtype;
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

  delete from public.quotation_bom_items
  where quotation_bom_items.id = current_item.id;

  update public.quotations
  set bom_status = 'edited', updated_at = now()
  where quotations.id = quotation_record.id;
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
    date_format = case when incoming_settings ? 'date_format' then incoming_settings ->> 'date_format' else organization_settings.date_format end,
    default_bom_panel_product_id = case when incoming_settings ? 'default_bom_panel_product_id' then nullif(incoming_settings ->> 'default_bom_panel_product_id', '')::uuid else organization_settings.default_bom_panel_product_id end,
    default_bom_inverter_product_id = case when incoming_settings ? 'default_bom_inverter_product_id' then nullif(incoming_settings ->> 'default_bom_inverter_product_id', '')::uuid else organization_settings.default_bom_inverter_product_id end,
    default_bom_structure_product_id = case when incoming_settings ? 'default_bom_structure_product_id' then nullif(incoming_settings ->> 'default_bom_structure_product_id', '')::uuid else organization_settings.default_bom_structure_product_id end,
    default_bom_dc_cable_product_id = case when incoming_settings ? 'default_bom_dc_cable_product_id' then nullif(incoming_settings ->> 'default_bom_dc_cable_product_id', '')::uuid else organization_settings.default_bom_dc_cable_product_id end,
    default_bom_ac_cable_product_id = case when incoming_settings ? 'default_bom_ac_cable_product_id' then nullif(incoming_settings ->> 'default_bom_ac_cable_product_id', '')::uuid else organization_settings.default_bom_ac_cable_product_id end,
    default_bom_earthing_product_id = case when incoming_settings ? 'default_bom_earthing_product_id' then nullif(incoming_settings ->> 'default_bom_earthing_product_id', '')::uuid else organization_settings.default_bom_earthing_product_id end,
    default_bom_lightning_arrestor_product_id = case when incoming_settings ? 'default_bom_lightning_arrestor_product_id' then nullif(incoming_settings ->> 'default_bom_lightning_arrestor_product_id', '')::uuid else organization_settings.default_bom_lightning_arrestor_product_id end,
    default_bom_structure_qty_per_panel = case when incoming_settings ? 'default_bom_structure_qty_per_panel' then coalesce(nullif(incoming_settings ->> 'default_bom_structure_qty_per_panel', '')::numeric, 0) else organization_settings.default_bom_structure_qty_per_panel end,
    default_bom_dc_cable_m_per_kw = case when incoming_settings ? 'default_bom_dc_cable_m_per_kw' then coalesce(nullif(incoming_settings ->> 'default_bom_dc_cable_m_per_kw', '')::numeric, 0) else organization_settings.default_bom_dc_cable_m_per_kw end,
    default_bom_ac_cable_m_per_kw = case when incoming_settings ? 'default_bom_ac_cable_m_per_kw' then coalesce(nullif(incoming_settings ->> 'default_bom_ac_cable_m_per_kw', '')::numeric, 0) else organization_settings.default_bom_ac_cable_m_per_kw end,
    default_bom_earthing_qty = case when incoming_settings ? 'default_bom_earthing_qty' then coalesce(nullif(incoming_settings ->> 'default_bom_earthing_qty', '')::numeric, 0) else organization_settings.default_bom_earthing_qty end,
    default_bom_lightning_arrestor_qty = case when incoming_settings ? 'default_bom_lightning_arrestor_qty' then coalesce(nullif(incoming_settings ->> 'default_bom_lightning_arrestor_qty', '')::numeric, 0) else organization_settings.default_bom_lightning_arrestor_qty end,
    default_bom_installation_qty = case when incoming_settings ? 'default_bom_installation_qty' then coalesce(nullif(incoming_settings ->> 'default_bom_installation_qty', '')::numeric, 0) else organization_settings.default_bom_installation_qty end
  where organization_settings.organization_id = current_organization_id
  returning * into updated_settings;

  return updated_settings;
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

  update public.quotations
  set
    status = 'accepted',
    bom_status = 'locked',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
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

  select *
  into customer_record
  from public.customers
  where customers.id = quotation_record.customer_id
    and customers.organization_id = quotation_record.organization_id;

  if not found then
    raise exception 'Quotation customer was not found in the same organization'
      using errcode = '23503';
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

  update public.quotations
  set bom_status = 'locked', updated_at = now()
  where quotations.id = quotation_record.id;

  return project_record;
end;
$$;

grant execute on function public.generate_quotation_bom_items(uuid) to authenticated;
grant execute on function public.create_quotation_bom_item(uuid, uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.update_quotation_bom_item(uuid, uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.delete_quotation_bom_item(uuid) to authenticated;
grant execute on function public.update_organization_settings(jsonb) to authenticated;
grant execute on function public.accept_quotation(uuid) to authenticated;
grant execute on function public.create_project_from_quotation(uuid) to authenticated;

revoke execute on function public.assert_bom_default_product(uuid, uuid, public.product_category_type, text) from public, authenticated;
revoke execute on function public.validate_organization_bom_defaults() from public, authenticated;
revoke execute on function public.bom_product_category_id(uuid) from public, authenticated;
revoke execute on function public.bom_category_id(uuid, public.product_category_type) from public, authenticated;
revoke execute on function public.set_quotation_bom_item_defaults() from public, authenticated;

notify pgrst, 'reload schema';
