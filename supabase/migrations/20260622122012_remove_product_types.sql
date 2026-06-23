-- Product Type is no longer part of the product or category model.
-- Product, category, pricing, inventory, and tenant data remain unchanged.

create or replace function public.set_product_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_category record;
begin
  if new.product_code is null or trim(new.product_code) = '' then
    new.product_code := public.generate_product_code(new.tenant_id);
  end if;

  select product_categories.tenant_id, product_categories.category_type
  into selected_category
  from public.product_categories
  where product_categories.id = new.category_id;

  if selected_category.tenant_id is null then
    raise exception 'category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if selected_category.tenant_id <> new.tenant_id then
    raise exception 'category_id must belong to the same tenant as the product'
      using errcode = '23503';
  end if;

  new.category_type := selected_category.category_type;
  new.product_code := upper(btrim(new.product_code));
  new.product_name := btrim(new.product_name);
  new.hsn_code := nullif(btrim(coalesce(new.hsn_code, '')), '');
  new.brand := nullif(btrim(coalesce(new.brand, '')), '');
  new.model_number := nullif(btrim(coalesce(new.model_number, '')), '');
  new.specifications := nullif(btrim(coalesce(new.specifications, '')), '');
  new.unit := lower(btrim(new.unit));
  new.purchase_price := coalesce(new.purchase_price, 0);
  new.selling_price := coalesce(new.selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.minimum_stock_alert := coalesce(new.minimum_stock_alert, 0);
  new.status := coalesce(nullif(lower(btrim(new.status)), ''), 'active');
  new.warranty_description := nullif(btrim(coalesce(new.warranty_description, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');

  return new;
end;
$$;

create or replace function public.import_catalog_library_defaults()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  category_count integer := 0;
begin
  target_tenant_id := public.current_user_organization_id();

  if target_tenant_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '23502';
  end if;

  if not public.user_has_permission('product_master', 'create') then
    raise exception 'Missing product_master create permission'
      using errcode = '42501';
  end if;

  insert into public.product_categories (
    tenant_id,
    name,
    category_type,
    display_order,
    description,
    is_active
  )
  select
    target_tenant_id,
    library_categories.name,
    library_categories.category_type,
    library_categories.display_order,
    library_categories.description,
    true
  from public.catalog_library_categories as library_categories
  where library_categories.is_active is not false
    and not exists (
      select 1
      from public.product_categories
      where product_categories.tenant_id = target_tenant_id
        and (
          lower(btrim(product_categories.name)) = lower(btrim(library_categories.name))
          or (
            library_categories.category_type <> 'OTHER'::public.product_category_type
            and product_categories.category_type = library_categories.category_type
          )
        )
    );

  get diagnostics category_count = row_count;

  return jsonb_build_object('categories_imported', category_count);
end;
$$;

alter table public.products drop column if exists product_type_id;
alter table public.quotation_bom_items drop column if exists product_type;

drop table if exists public.product_types;
drop table if exists public.catalog_library_product_types;

drop function if exists public.set_product_type_defaults();
drop function if exists public.set_catalog_library_product_type_defaults();

notify pgrst, 'reload schema';
