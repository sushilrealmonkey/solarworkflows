-- Replace manually managed category display order with immutable tenant-scoped
-- serial numbers, add the same behavior to products, and retire category imports.

with ranked_categories as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by created_at nulls last, id
    )::integer as serial_number
  from public.product_categories
)
update public.product_categories
set display_order = ranked_categories.serial_number
from ranked_categories
where product_categories.id = ranked_categories.id;

alter table public.product_categories
alter column display_order drop default;

create unique index if not exists product_categories_tenant_serial_number_unique
on public.product_categories (tenant_id, display_order);

alter table public.products
add column if not exists serial_number integer;

with ranked_products as (
  select
    id,
    row_number() over (
      partition by tenant_id
      order by created_at nulls last, id
    )::integer as serial_number
  from public.products
)
update public.products
set serial_number = ranked_products.serial_number
from ranked_products
where products.id = ranked_products.id;

alter table public.products
alter column serial_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_serial_number_positive_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_serial_number_positive_check
    check (serial_number > 0);
  end if;
end;
$$;

create unique index if not exists products_tenant_serial_number_unique
on public.products (tenant_id, serial_number);

create or replace function public.assign_product_category_serial_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.display_order := old.display_order;
    return new;
  end if;

  if new.tenant_id is null then
    raise exception 'tenant_id is required before assigning a category serial number'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('product_categories'),
    hashtext(new.tenant_id::text)
  );

  select coalesce(max(product_categories.display_order), 0) + 1
  into new.display_order
  from public.product_categories
  where product_categories.tenant_id = new.tenant_id;

  return new;
end;
$$;

drop trigger if exists assign_product_category_serial_number on public.product_categories;

create trigger assign_product_category_serial_number
before insert or update of display_order on public.product_categories
for each row
execute function public.assign_product_category_serial_number();

revoke all on function public.assign_product_category_serial_number() from public, anon, authenticated;

create or replace function public.assign_product_serial_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.serial_number := old.serial_number;
    return new;
  end if;

  if new.tenant_id is null then
    raise exception 'tenant_id is required before assigning a product serial number'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('products'),
    hashtext(new.tenant_id::text)
  );

  select coalesce(max(products.serial_number), 0) + 1
  into new.serial_number
  from public.products
  where products.tenant_id = new.tenant_id;

  return new;
end;
$$;

drop trigger if exists assign_product_serial_number on public.products;

create trigger assign_product_serial_number
before insert or update of serial_number on public.products
for each row
execute function public.assign_product_serial_number();

revoke all on function public.assign_product_serial_number() from public, anon, authenticated;

create or replace function public.product_catalog_public_rows()
returns table(product_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('product_master', 'view')
      or public.user_has_permission('quotations', 'view')
      or public.user_has_permission('inventory', 'view')
    ) then
    raise exception 'Missing product catalog view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', products.id,
    'tenant_id', products.tenant_id,
    'serial_number', products.serial_number,
    'product_code', products.product_code,
    'product_name', products.product_name,
    'category_id', products.category_id,
    'category_type', products.category_type,
    'hsn_code', products.hsn_code,
    'brand', products.brand,
    'model_number', products.model_number,
    'specifications', products.specifications,
    'unit', products.unit,
    'gst_percent', products.gst_percent,
    'warranty_description', products.warranty_description,
    'status', products.status,
    'notes', products.notes,
    'purchase_price', null,
    'selling_price', null,
    'minimum_stock_alert', null,
    'created_at', products.created_at,
    'updated_at', products.updated_at,
    'category', case
      when product_categories.id is null then null
      else jsonb_build_object(
        'id', product_categories.id,
        'name', product_categories.name,
        'category_type', product_categories.category_type,
        'display_order', product_categories.display_order
      )
    end
  )
  from public.products
  left join public.product_categories on product_categories.id = products.category_id
  where public.is_super_admin()
     or products.tenant_id = target_organization_id
  order by products.serial_number, products.created_at, products.id;
end;
$$;

drop function if exists public.import_catalog_library_defaults();

notify pgrst, 'reload schema';
