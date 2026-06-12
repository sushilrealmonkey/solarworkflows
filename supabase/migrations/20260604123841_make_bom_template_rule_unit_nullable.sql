-- BOM rules are category-level template rules. Units are assigned later during
-- generated BOM processing, so template lines must allow NULL unit values.

alter table public.bom_template_lines
alter column unit drop not null;

create or replace function public.set_bom_template_line_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_template_tenant_id uuid;
  selected_category_tenant_id uuid;
begin
  new.unit := nullif(lower(btrim(coalesce(new.unit, ''))), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);

  select bom_templates.tenant_id
  into selected_template_tenant_id
  from public.bom_templates
  where bom_templates.id = new.bom_template_id;

  if selected_template_tenant_id is null then
    raise exception 'bom_template_id must reference an existing BOM template'
      using errcode = '23503';
  end if;

  if selected_template_tenant_id <> new.tenant_id then
    raise exception 'bom_template_id must belong to the same tenant as the BOM template line'
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
    raise exception 'product_category_id must belong to the same tenant as the BOM template line'
      using errcode = '23503';
  end if;

  if new.calculation_type = 'fixed_quantity' then
    new.formula_value := null;

    if new.fixed_quantity is null or new.fixed_quantity <= 0 then
      raise exception 'Fixed quantity must be greater than 0'
        using errcode = '23514';
    end if;
  elsif new.calculation_type = 'per_kw' then
    new.fixed_quantity := null;

    if new.formula_value is null or new.formula_value <= 0 then
      raise exception 'Formula must be greater than 0'
        using errcode = '23514';
    end if;
  else
    new.formula_value := null;
    new.fixed_quantity := null;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
