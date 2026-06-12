-- BOM generation engine for quotation BOM rows.
-- This only generates storage rows from BOM template rules. It does not assign
-- products, price materials, reserve stock, deduct inventory, or create purchase logic.

alter table public.quotation_bom_items
add column if not exists is_auto_generated boolean not null default true;

alter table public.quotation_bom_items
drop constraint if exists quotation_bom_items_quantity_positive_check;

alter table public.quotation_bom_items
add constraint quotation_bom_items_quantity_non_negative_check
check (quantity >= 0);

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
  new.unit := nullif(lower(btrim(coalesce(new.unit, ''))), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);
  new.manually_modified := coalesce(new.manually_modified, false);
  new.is_auto_generated := coalesce(new.is_auto_generated, true);

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

  if parent_quotation.bom_template_id is not null
    and parent_rule.bom_template_id <> parent_quotation.bom_template_id then
    raise exception 'bom_template_rule_id must belong to the quotation BOM template'
      using errcode = '23503';
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

  if parent_rule.product_category_id <> new.product_category_id then
    raise exception 'product_category_id must match the BOM template rule category'
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

  return new;
end;
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
  template_tenant_id uuid;
  bom_rule_count integer;
  inserted_count integer;
  system_capacity numeric;
  panel_wattage numeric;
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

  if quotation_record.bom_template_id is null then
    raise exception 'Select a BOM template before generating BOM.'
      using errcode = '23502';
  end if;

  select bom_templates.tenant_id
  into template_tenant_id
  from public.bom_templates
  where bom_templates.id = quotation_record.bom_template_id;

  if template_tenant_id is null then
    raise exception 'Selected BOM template was not found.'
      using errcode = '23503';
  end if;

  if template_tenant_id <> quotation_record.organization_id then
    raise exception 'Selected BOM template must belong to the quotation organization.'
      using errcode = '23503';
  end if;

  system_capacity := quotation_record.system_capacity_kw;

  if system_capacity is null or system_capacity <= 0 then
    raise exception 'Enter system capacity greater than 0 before generating BOM.'
      using errcode = '23514';
  end if;

  select count(*)
  into bom_rule_count
  from public.bom_template_lines
  where bom_template_lines.bom_template_id = quotation_record.bom_template_id
    and bom_template_lines.tenant_id = quotation_record.organization_id;

  if bom_rule_count = 0 then
    raise exception 'Selected BOM template has no BOM rules.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.bom_template_lines
    where bom_template_lines.bom_template_id = quotation_record.bom_template_id
      and bom_template_lines.tenant_id = quotation_record.organization_id
      and bom_template_lines.calculation_type = 'panel_count'
  ) then
    panel_wattage := quotation_record.summary_module_wattage;

    if panel_wattage is null or panel_wattage <= 0 then
      raise exception 'Enter panel wattage greater than 0 before generating panel-count BOM items.'
        using errcode = '23514';
    end if;
  end if;

  delete from public.quotation_bom_items
  where quotation_bom_items.quotation_id = quotation_record.id
    and quotation_bom_items.tenant_id = quotation_record.organization_id
    and quotation_bom_items.is_auto_generated = true
    and quotation_bom_items.manually_modified = false;

  insert into public.quotation_bom_items (
    tenant_id,
    quotation_id,
    bom_template_rule_id,
    product_category_id,
    product_id,
    calculation_type,
    quantity,
    unit,
    is_required,
    manually_modified,
    is_auto_generated,
    display_order,
    notes
  )
  select
    quotation_record.organization_id,
    quotation_record.id,
    bom_template_lines.id,
    bom_template_lines.product_category_id,
    null,
    bom_template_lines.calculation_type,
    case bom_template_lines.calculation_type
      when 'panel_count' then ceil((system_capacity * 1000) / panel_wattage)
      when 'inverter_count' then 1
      when 'per_kw' then system_capacity * coalesce(bom_template_lines.formula_value, 0)
      when 'fixed_quantity' then coalesce(bom_template_lines.fixed_quantity, 0)
      when 'manual' then 0
      else 0
    end,
    bom_template_lines.unit,
    coalesce(bom_template_lines.is_required, true),
    false,
    true,
    bom_template_lines.display_order,
    bom_template_lines.notes
  from public.bom_template_lines
  where bom_template_lines.bom_template_id = quotation_record.bom_template_id
    and bom_template_lines.tenant_id = quotation_record.organization_id
  order by bom_template_lines.display_order, bom_template_lines.created_at;

  get diagnostics inserted_count = row_count;

  return inserted_count;
end;
$$;

grant execute on function public.generate_quotation_bom_items(uuid) to authenticated;
revoke execute on function public.generate_quotation_bom_items(uuid) from public;
revoke execute on function public.set_quotation_bom_item_defaults() from public, authenticated;

notify pgrst, 'reload schema';
