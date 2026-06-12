-- Adds optional product-level catalog metadata.
-- These fields are tenant-scoped through the existing products table and do not
-- introduce quotation, tax, inventory, or BOM business logic.

alter table public.products
add column if not exists hsn_code text;

alter table public.products
add column if not exists product_type text;

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
  new.product_type := nullif(btrim(coalesce(new.product_type, '')), '');
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

notify pgrst, 'reload schema';
