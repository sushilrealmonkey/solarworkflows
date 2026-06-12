-- Extends BOM template lines into product-backed BOM Rules.
-- Table names stay unchanged so existing references remain stable.

alter table public.bom_template_lines
add column if not exists product_id uuid references public.products(id) on delete restrict;

create index if not exists bom_template_lines_product_id_idx
on public.bom_template_lines (product_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_template_lines_product_required_check'
      and conrelid = 'public.bom_template_lines'::regclass
  ) then
    alter table public.bom_template_lines
    add constraint bom_template_lines_product_required_check
    check (product_id is not null)
    not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_template_lines_calculation_value_check'
      and conrelid = 'public.bom_template_lines'::regclass
  ) then
    alter table public.bom_template_lines
    add constraint bom_template_lines_calculation_value_check
    check (
      (
        calculation_type = 'fixed_quantity'
        and fixed_quantity > 0
        and formula_value is null
      )
      or (
        calculation_type = 'per_kw'
        and formula_value > 0
        and fixed_quantity is null
      )
      or (
        calculation_type in ('panel_count', 'inverter_count', 'manual')
        and formula_value is null
        and fixed_quantity is null
      )
    )
    not valid;
  end if;
end;
$$;

create or replace function public.set_bom_template_line_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_template_tenant_id uuid;
  selected_product_tenant_id uuid;
  selected_product_category_id uuid;
begin
  new.unit := lower(btrim(new.unit));
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);

  if new.unit = '' then
    raise exception 'Unit is required'
      using errcode = '23502';
  end if;

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

  if new.product_id is null then
    raise exception 'Product is required'
      using errcode = '23502';
  end if;

  select products.tenant_id, products.category_id
  into selected_product_tenant_id, selected_product_category_id
  from public.products
  where products.id = new.product_id;

  if selected_product_tenant_id is null then
    raise exception 'product_id must reference an existing product'
      using errcode = '23503';
  end if;

  if selected_product_tenant_id <> new.tenant_id then
    raise exception 'product_id must belong to the same tenant as the BOM template line'
      using errcode = '23503';
  end if;

  new.product_category_id := selected_product_category_id;

  if new.calculation_type = 'fixed_quantity' then
    new.formula_value := null;

    if new.fixed_quantity is null or new.fixed_quantity <= 0 then
      raise exception 'Fixed quantity must be greater than 0'
        using errcode = '23514';
    end if;
  elsif new.calculation_type = 'per_kw' then
    new.fixed_quantity := null;

    if new.formula_value is null or new.formula_value <= 0 then
      raise exception 'Formula value must be greater than 0'
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
