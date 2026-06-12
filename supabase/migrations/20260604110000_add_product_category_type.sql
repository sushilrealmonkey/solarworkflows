-- Adds a durable category type for future BOM, quotation, stock, and reporting workflows.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'product_category_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.product_category_type as enum (
      'SOLAR_PANEL',
      'INVERTER',
      'STRUCTURE',
      'DC_CABLE',
      'AC_CABLE',
      'EARTHING',
      'LIGHTNING_ARRESTOR',
      'BATTERY',
      'MONITORING_DEVICE',
      'PROTECTION_DEVICE',
      'ACCESSORY',
      'OTHER'
    );
  end if;
end;
$$;

alter table public.product_categories
add column if not exists category_type public.product_category_type;

alter table public.products
add column if not exists category_type public.product_category_type;

update public.product_categories
set category_type = case
  when lower(btrim(name)) in ('solar panels', 'solar panel') then 'SOLAR_PANEL'::public.product_category_type
  when lower(btrim(name)) in ('inverters', 'inverter') then 'INVERTER'::public.product_category_type
  when lower(btrim(name)) in ('structure', 'structures', 'mounting structures', 'mounting structure') then 'STRUCTURE'::public.product_category_type
  when lower(btrim(name)) in ('dc cable', 'dc cables') then 'DC_CABLE'::public.product_category_type
  when lower(btrim(name)) in ('ac cable', 'ac cables') then 'AC_CABLE'::public.product_category_type
  when lower(btrim(name)) in ('earthing', 'earthing materials', 'earthing material') then 'EARTHING'::public.product_category_type
  when lower(btrim(name)) in ('lightning arrestor', 'lightning arrestors', 'lightning arrester', 'lightning arresters') then 'LIGHTNING_ARRESTOR'::public.product_category_type
  when lower(btrim(name)) in ('battery', 'batteries') then 'BATTERY'::public.product_category_type
  when lower(btrim(name)) in ('monitoring device', 'monitoring devices', 'metering equipment') then 'MONITORING_DEVICE'::public.product_category_type
  when lower(btrim(name)) in ('protection device', 'protection devices', 'acdb / dcdb', 'acdb', 'dcdb') then 'PROTECTION_DEVICE'::public.product_category_type
  when lower(btrim(name)) in ('accessory', 'accessories', 'connectors & accessories', 'connectors and accessories') then 'ACCESSORY'::public.product_category_type
  else 'OTHER'::public.product_category_type
end
where category_type is null;

update public.products
set category_type = product_categories.category_type
from public.product_categories
where products.category_id = product_categories.id
  and products.category_type is null;

update public.products
set category_type = 'OTHER'::public.product_category_type
where category_type is null;

alter table public.product_categories
alter column category_type set not null;

alter table public.products
alter column category_type set not null;

create index if not exists product_categories_category_type_idx
on public.product_categories (category_type);

create index if not exists products_category_type_idx
on public.products (category_type);

create or replace function public.set_product_category_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');

  if new.name = '' then
    raise exception 'Category name is required'
      using errcode = '23502';
  end if;

  if new.category_type is null then
    raise exception 'Category type is required'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE'
    and old.category_type is distinct from new.category_type
    and not public.is_super_admin() then
    raise exception 'Only super admins can change category type'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists set_product_category_defaults on public.product_categories;

create trigger set_product_category_defaults
before insert or update on public.product_categories
for each row
execute function public.set_product_category_defaults();

create or replace function public.sync_product_category_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.category_type is distinct from new.category_type then
    update public.products
    set category_type = new.category_type
    where category_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_product_category_type on public.product_categories;

create trigger sync_product_category_type
after update of category_type on public.product_categories
for each row
execute function public.sync_product_category_type();

create or replace function public.seed_default_product_categories(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_tenant_id is null then
    return;
  end if;

  insert into public.product_categories (tenant_id, name, category_type)
  select target_tenant_id, category_name, category_type
  from (
    values
      ('Solar Panels', 'SOLAR_PANEL'::public.product_category_type),
      ('Inverters', 'INVERTER'::public.product_category_type),
      ('Structure', 'STRUCTURE'::public.product_category_type),
      ('DC Cable', 'DC_CABLE'::public.product_category_type),
      ('AC Cable', 'AC_CABLE'::public.product_category_type),
      ('Earthing', 'EARTHING'::public.product_category_type),
      ('Lightning Arrestor', 'LIGHTNING_ARRESTOR'::public.product_category_type),
      ('Battery', 'BATTERY'::public.product_category_type),
      ('Monitoring Devices', 'MONITORING_DEVICE'::public.product_category_type),
      ('Accessories', 'ACCESSORY'::public.product_category_type)
  ) as default_categories(category_name, category_type)
  where not exists (
    select 1
    from public.product_categories
    where product_categories.tenant_id = target_tenant_id
      and (
        lower(btrim(product_categories.name)) = lower(btrim(category_name))
        or product_categories.category_type = default_categories.category_type
      )
  );
end;
$$;

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

select public.seed_default_product_categories(organizations.id)
from public.organizations;

notify pgrst, 'reload schema';
