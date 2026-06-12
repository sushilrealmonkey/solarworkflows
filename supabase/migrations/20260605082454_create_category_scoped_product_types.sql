-- Converts Product Type from free text on products into tenant-scoped,
-- category-specific catalog metadata.

create table if not exists public.product_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  name text not null,
  display_order integer not null default 999,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.product_types add column if not exists id uuid default gen_random_uuid();
alter table public.product_types add column if not exists tenant_id uuid references public.organizations(id) on delete cascade;
alter table public.product_types add column if not exists category_id uuid references public.product_categories(id) on delete cascade;
alter table public.product_types add column if not exists name text;
alter table public.product_types add column if not exists display_order integer default 999;
alter table public.product_types add column if not exists is_active boolean default true;
alter table public.product_types add column if not exists created_at timestamptz default now();
alter table public.product_types add column if not exists updated_at timestamptz default now();

alter table public.product_types alter column id set default gen_random_uuid();
alter table public.product_types alter column tenant_id set not null;
alter table public.product_types alter column category_id set not null;
alter table public.product_types alter column name set not null;
alter table public.product_types alter column display_order set default 999;
alter table public.product_types alter column display_order set not null;
alter table public.product_types alter column is_active set default true;
alter table public.product_types alter column created_at set default now();
alter table public.product_types alter column updated_at set default now();

alter table public.products
add column if not exists product_type_id uuid references public.product_types(id) on delete restrict;

create unique index if not exists product_types_tenant_category_name_unique
on public.product_types (tenant_id, category_id, lower(btrim(name)));

create index if not exists product_types_tenant_category_order_idx
on public.product_types (tenant_id, category_id, display_order, name);

create index if not exists product_types_is_active_idx
on public.product_types (is_active);

create index if not exists products_product_type_id_idx
on public.products (product_type_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_types_display_order_positive_check'
      and conrelid = 'public.product_types'::regclass
  ) then
    alter table public.product_types
    add constraint product_types_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

create or replace function public.set_product_type_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category_tenant_id uuid;
begin
  select product_categories.tenant_id
  into category_tenant_id
  from public.product_categories
  where product_categories.id = new.category_id;

  if category_tenant_id is null then
    raise exception 'category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if category_tenant_id <> new.tenant_id then
    raise exception 'category_id must belong to the same tenant as the product type'
      using errcode = '23503';
  end if;

  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Product type name is required'
      using errcode = '23502';
  end if;

  new.display_order := coalesce(new.display_order, 999);
  new.is_active := coalesce(new.is_active, true);

  return new;
end;
$$;

drop trigger if exists set_product_type_defaults on public.product_types;

create trigger set_product_type_defaults
before insert or update on public.product_types
for each row
execute function public.set_product_type_defaults();

drop trigger if exists set_product_types_updated_at on public.product_types;

create trigger set_product_types_updated_at
before update on public.product_types
for each row
execute function public.set_updated_at();

insert into public.product_types (tenant_id, category_id, name, display_order)
select
  migrated_types.tenant_id,
  migrated_types.category_id,
  migrated_types.name,
  row_number() over (
    partition by migrated_types.tenant_id, migrated_types.category_id
    order by lower(migrated_types.name)
  )::integer
from (
  select distinct
    products.tenant_id,
    products.category_id,
    btrim(products.product_type) as name
  from public.products
  where products.product_type is not null
    and btrim(products.product_type) <> ''
) as migrated_types
where not exists (
  select 1
  from public.product_types
  where product_types.tenant_id = migrated_types.tenant_id
    and product_types.category_id = migrated_types.category_id
    and lower(btrim(product_types.name)) = lower(btrim(migrated_types.name))
);

update public.products
set product_type_id = product_types.id
from public.product_types
where products.product_type_id is null
  and products.product_type is not null
  and products.tenant_id = product_types.tenant_id
  and products.category_id = product_types.category_id
  and lower(btrim(products.product_type)) = lower(btrim(product_types.name));

alter table public.products
drop column if exists product_type;

create or replace function public.set_product_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_category record;
  selected_product_type record;
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

  if new.product_type_id is not null then
    select product_types.tenant_id, product_types.category_id
    into selected_product_type
    from public.product_types
    where product_types.id = new.product_type_id;

    if selected_product_type.tenant_id is null then
      raise exception 'product_type_id must reference an existing product type'
        using errcode = '23503';
    end if;

    if selected_product_type.tenant_id <> new.tenant_id then
      raise exception 'product_type_id must belong to the same tenant as the product'
        using errcode = '23503';
    end if;

    if selected_product_type.category_id <> new.category_id then
      raise exception 'product_type_id must belong to the selected product category'
        using errcode = '23503';
    end if;
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

alter table public.product_types enable row level security;

drop policy if exists "Super admins can manage product types" on public.product_types;
drop policy if exists "Tenant users can view product types" on public.product_types;
drop policy if exists "Tenant users can create product types" on public.product_types;
drop policy if exists "Tenant users can update product types" on public.product_types;
drop policy if exists "Tenant users can delete product types" on public.product_types;

create policy "Super admins can manage product types"
on public.product_types
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view product types"
on public.product_types
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create product types"
on public.product_types
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update product types"
on public.product_types
for update
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
);

create policy "Tenant users can delete product types"
on public.product_types
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'delete')
);

notify pgrst, 'reload schema';
