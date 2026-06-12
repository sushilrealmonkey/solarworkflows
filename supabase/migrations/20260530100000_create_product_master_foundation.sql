-- Product Master foundation.
-- Creates tenant-scoped product reference data without changing Inventory,
-- Purchase Orders, Quotation BOM, or Project Material Planning tables.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'product_master',
  'Product Master',
  'Central product catalog used by inventory, purchases, quotations, projects, and reports',
  385,
  true
)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.permissions (module_id, action_key, action_name)
select
  modules.id,
  actions.action_key,
  actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('update', 'Update'),
    ('delete', 'Delete')
) as actions(action_key, action_name)
where modules.module_key = 'product_master'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where modules.module_key = 'product_master'
  and (
    coalesce(roles.is_system_role, false) = true
    or lower(btrim(roles.role_name)) = 'admin'
  )
on conflict (role_id, permission_id) do nothing;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  category_id uuid not null references public.product_categories(id) on delete restrict,
  brand text,
  model_number text,
  unit text not null,
  purchase_price numeric default 0,
  selling_price numeric default 0,
  gst_percent numeric default 0,
  warranty_description text,
  minimum_stock_alert numeric default 0,
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.product_categories add column if not exists id uuid default gen_random_uuid();
alter table public.product_categories add column if not exists tenant_id uuid references public.organizations(id) on delete cascade;
alter table public.product_categories add column if not exists name text;
alter table public.product_categories add column if not exists description text;
alter table public.product_categories add column if not exists is_active boolean default true;
alter table public.product_categories add column if not exists created_at timestamptz default now();
alter table public.product_categories add column if not exists updated_at timestamptz default now();

alter table public.product_categories alter column id set default gen_random_uuid();
alter table public.product_categories alter column tenant_id set not null;
alter table public.product_categories alter column name set not null;
alter table public.product_categories alter column is_active set default true;
alter table public.product_categories alter column created_at set default now();
alter table public.product_categories alter column updated_at set default now();

alter table public.products add column if not exists id uuid default gen_random_uuid();
alter table public.products add column if not exists tenant_id uuid references public.organizations(id) on delete cascade;
alter table public.products add column if not exists product_code text;
alter table public.products add column if not exists product_name text;
alter table public.products add column if not exists category_id uuid references public.product_categories(id) on delete restrict;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists model_number text;
alter table public.products add column if not exists unit text;
alter table public.products add column if not exists purchase_price numeric default 0;
alter table public.products add column if not exists selling_price numeric default 0;
alter table public.products add column if not exists gst_percent numeric default 0;
alter table public.products add column if not exists warranty_description text;
alter table public.products add column if not exists minimum_stock_alert numeric default 0;
alter table public.products add column if not exists status text default 'active';
alter table public.products add column if not exists notes text;
alter table public.products add column if not exists created_at timestamptz default now();
alter table public.products add column if not exists updated_at timestamptz default now();

alter table public.products alter column id set default gen_random_uuid();
alter table public.products alter column tenant_id set not null;
alter table public.products alter column product_code set not null;
alter table public.products alter column product_name set not null;
alter table public.products alter column category_id set not null;
alter table public.products alter column unit set not null;
alter table public.products alter column purchase_price set default 0;
alter table public.products alter column selling_price set default 0;
alter table public.products alter column gst_percent set default 0;
alter table public.products alter column minimum_stock_alert set default 0;
alter table public.products alter column status set default 'active';
alter table public.products alter column created_at set default now();
alter table public.products alter column updated_at set default now();

create unique index if not exists product_categories_tenant_name_unique
on public.product_categories (tenant_id, lower(btrim(name)));

create unique index if not exists products_tenant_product_code_unique
on public.products (tenant_id, lower(btrim(product_code)));

create index if not exists product_categories_tenant_id_idx
on public.product_categories (tenant_id);

create index if not exists product_categories_is_active_idx
on public.product_categories (is_active);

create index if not exists products_tenant_id_idx
on public.products (tenant_id);

create index if not exists products_category_id_idx
on public.products (category_id);

create index if not exists products_status_idx
on public.products (status);

create index if not exists products_product_name_idx
on public.products (product_name);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_status_check
    check (status in ('active', 'inactive', 'discontinued'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_numbers_nonnegative_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_numbers_nonnegative_check
    check (
      purchase_price >= 0
      and selling_price >= 0
      and gst_percent >= 0
      and minimum_stock_alert >= 0
    );
  end if;
end;
$$;

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

  insert into public.product_categories (tenant_id, name)
  select target_tenant_id, category_name
  from unnest(array[
    'Solar Panels',
    'Inverters',
    'Mounting Structures',
    'DC Cables',
    'AC Cables',
    'Earthing Materials',
    'ACDB / DCDB',
    'Lightning Arresters',
    'Metering Equipment',
    'Connectors & Accessories',
    'Batteries',
    'Tools & Equipment',
    'Service Items',
    'Other'
  ]) as default_categories(category_name)
  where not exists (
    select 1
    from public.product_categories
    where product_categories.tenant_id = target_tenant_id
      and lower(btrim(product_categories.name)) = lower(btrim(category_name))
  );
end;
$$;

create or replace function public.seed_product_categories_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_product_categories(new.id);
  return new;
end;
$$;

drop trigger if exists seed_product_categories_for_organization on public.organizations;

create trigger seed_product_categories_for_organization
after insert on public.organizations
for each row
execute function public.seed_product_categories_for_organization();

select public.seed_default_product_categories(organizations.id)
from public.organizations;

create or replace function public.generate_product_code(target_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_tenant_id is null then
    raise exception 'tenant_id is required to generate a product code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product:' || target_tenant_id::text, 0));

  select coalesce(max(substring(products.product_code from '^PRD-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.products
  where products.tenant_id = target_tenant_id
    and products.product_code ~ '^PRD-[0-9]+$';

  return 'PRD-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.set_product_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category_tenant_id uuid;
begin
  if new.product_code is null or trim(new.product_code) = '' then
    new.product_code := public.generate_product_code(new.tenant_id);
  end if;

  select product_categories.tenant_id
  into category_tenant_id
  from public.product_categories
  where product_categories.id = new.category_id;

  if category_tenant_id is null then
    raise exception 'category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if category_tenant_id <> new.tenant_id then
    raise exception 'category_id must belong to the same tenant as the product'
      using errcode = '23503';
  end if;

  new.product_code := upper(btrim(new.product_code));
  new.product_name := btrim(new.product_name);
  new.brand := nullif(btrim(coalesce(new.brand, '')), '');
  new.model_number := nullif(btrim(coalesce(new.model_number, '')), '');
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

drop trigger if exists set_product_categories_updated_at on public.product_categories;

create trigger set_product_categories_updated_at
before update on public.product_categories
for each row
execute function public.set_updated_at();

drop trigger if exists set_products_defaults on public.products;

create trigger set_products_defaults
before insert or update on public.products
for each row
execute function public.set_product_defaults();

drop trigger if exists set_products_updated_at on public.products;

create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;

drop policy if exists "Super admins can manage product categories" on public.product_categories;
drop policy if exists "Tenant users can view product categories" on public.product_categories;
drop policy if exists "Tenant users can create product categories" on public.product_categories;
drop policy if exists "Tenant users can update product categories" on public.product_categories;
drop policy if exists "Tenant users can delete product categories" on public.product_categories;

create policy "Super admins can manage product categories"
on public.product_categories
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view product categories"
on public.product_categories
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create product categories"
on public.product_categories
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update product categories"
on public.product_categories
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

create policy "Tenant users can delete product categories"
on public.product_categories
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'delete')
);

drop policy if exists "Super admins can manage products" on public.products;
drop policy if exists "Tenant users can view products" on public.products;
drop policy if exists "Tenant users can create products" on public.products;
drop policy if exists "Tenant users can update products" on public.products;
drop policy if exists "Tenant users can delete products" on public.products;

create policy "Super admins can manage products"
on public.products
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view products"
on public.products
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create products"
on public.products
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update products"
on public.products
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

create policy "Tenant users can delete products"
on public.products
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'delete')
);

revoke execute on function public.seed_default_product_categories(uuid) from public, authenticated;
revoke execute on function public.generate_product_code(uuid) from public, authenticated;

notify pgrst, 'reload schema';
