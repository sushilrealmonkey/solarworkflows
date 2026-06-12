-- Admin-managed catalog library defaults.
-- Shared records are templates only. Tenant product records continue to use
-- tenant-scoped product_categories, product_types, and product brand text.

create table if not exists public.catalog_library_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_type public.product_category_type not null,
  display_order integer not null default 999,
  description text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.catalog_library_product_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.catalog_library_categories(id) on delete cascade,
  name text not null,
  display_order integer not null default 999,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.catalog_library_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null default 999,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.catalog_library_categories add column if not exists id uuid default gen_random_uuid();
alter table public.catalog_library_categories add column if not exists name text;
alter table public.catalog_library_categories add column if not exists category_type public.product_category_type;
alter table public.catalog_library_categories add column if not exists display_order integer default 999;
alter table public.catalog_library_categories add column if not exists description text;
alter table public.catalog_library_categories add column if not exists is_active boolean default true;
alter table public.catalog_library_categories add column if not exists created_at timestamptz default now();
alter table public.catalog_library_categories add column if not exists updated_at timestamptz default now();

alter table public.catalog_library_product_types add column if not exists id uuid default gen_random_uuid();
alter table public.catalog_library_product_types add column if not exists category_id uuid references public.catalog_library_categories(id) on delete cascade;
alter table public.catalog_library_product_types add column if not exists name text;
alter table public.catalog_library_product_types add column if not exists display_order integer default 999;
alter table public.catalog_library_product_types add column if not exists is_active boolean default true;
alter table public.catalog_library_product_types add column if not exists created_at timestamptz default now();
alter table public.catalog_library_product_types add column if not exists updated_at timestamptz default now();

alter table public.catalog_library_brands add column if not exists id uuid default gen_random_uuid();
alter table public.catalog_library_brands add column if not exists name text;
alter table public.catalog_library_brands add column if not exists display_order integer default 999;
alter table public.catalog_library_brands add column if not exists is_active boolean default true;
alter table public.catalog_library_brands add column if not exists created_at timestamptz default now();
alter table public.catalog_library_brands add column if not exists updated_at timestamptz default now();

alter table public.catalog_library_categories alter column id set default gen_random_uuid();
alter table public.catalog_library_categories alter column name set not null;
alter table public.catalog_library_categories alter column category_type set not null;
alter table public.catalog_library_categories alter column display_order set default 999;
alter table public.catalog_library_categories alter column display_order set not null;
alter table public.catalog_library_categories alter column is_active set default true;
alter table public.catalog_library_categories alter column created_at set default now();
alter table public.catalog_library_categories alter column updated_at set default now();

alter table public.catalog_library_product_types alter column id set default gen_random_uuid();
alter table public.catalog_library_product_types alter column category_id set not null;
alter table public.catalog_library_product_types alter column name set not null;
alter table public.catalog_library_product_types alter column display_order set default 999;
alter table public.catalog_library_product_types alter column display_order set not null;
alter table public.catalog_library_product_types alter column is_active set default true;
alter table public.catalog_library_product_types alter column created_at set default now();
alter table public.catalog_library_product_types alter column updated_at set default now();

alter table public.catalog_library_brands alter column id set default gen_random_uuid();
alter table public.catalog_library_brands alter column name set not null;
alter table public.catalog_library_brands alter column display_order set default 999;
alter table public.catalog_library_brands alter column display_order set not null;
alter table public.catalog_library_brands alter column is_active set default true;
alter table public.catalog_library_brands alter column created_at set default now();
alter table public.catalog_library_brands alter column updated_at set default now();

create unique index if not exists catalog_library_categories_name_unique
on public.catalog_library_categories (lower(btrim(name)));

create unique index if not exists catalog_library_categories_category_type_unique
on public.catalog_library_categories (category_type)
where category_type <> 'OTHER'::public.product_category_type;

create unique index if not exists catalog_library_product_types_category_name_unique
on public.catalog_library_product_types (category_id, lower(btrim(name)));

create unique index if not exists catalog_library_brands_name_unique
on public.catalog_library_brands (lower(btrim(name)));

create index if not exists catalog_library_categories_order_idx
on public.catalog_library_categories (display_order, name);

create index if not exists catalog_library_product_types_order_idx
on public.catalog_library_product_types (category_id, display_order, name);

create index if not exists catalog_library_brands_order_idx
on public.catalog_library_brands (display_order, name);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_library_categories_display_order_positive_check'
      and conrelid = 'public.catalog_library_categories'::regclass
  ) then
    alter table public.catalog_library_categories
    add constraint catalog_library_categories_display_order_positive_check
    check (display_order > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_library_product_types_display_order_positive_check'
      and conrelid = 'public.catalog_library_product_types'::regclass
  ) then
    alter table public.catalog_library_product_types
    add constraint catalog_library_product_types_display_order_positive_check
    check (display_order > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_library_brands_display_order_positive_check'
      and conrelid = 'public.catalog_library_brands'::regclass
  ) then
    alter table public.catalog_library_brands
    add constraint catalog_library_brands_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

create or replace function public.set_catalog_library_category_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');

  if new.name = '' then
    raise exception 'Catalog category name is required'
      using errcode = '23502';
  end if;

  new.display_order := coalesce(new.display_order, 999);
  new.is_active := coalesce(new.is_active, true);

  return new;
end;
$$;

create or replace function public.set_catalog_library_product_type_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Catalog product type name is required'
      using errcode = '23502';
  end if;

  new.display_order := coalesce(new.display_order, 999);
  new.is_active := coalesce(new.is_active, true);

  return new;
end;
$$;

create or replace function public.set_catalog_library_brand_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);

  if new.name = '' then
    raise exception 'Catalog brand name is required'
      using errcode = '23502';
  end if;

  new.display_order := coalesce(new.display_order, 999);
  new.is_active := coalesce(new.is_active, true);

  return new;
end;
$$;

drop trigger if exists set_catalog_library_category_defaults on public.catalog_library_categories;
create trigger set_catalog_library_category_defaults
before insert or update on public.catalog_library_categories
for each row
execute function public.set_catalog_library_category_defaults();

drop trigger if exists set_catalog_library_product_type_defaults on public.catalog_library_product_types;
create trigger set_catalog_library_product_type_defaults
before insert or update on public.catalog_library_product_types
for each row
execute function public.set_catalog_library_product_type_defaults();

drop trigger if exists set_catalog_library_brand_defaults on public.catalog_library_brands;
create trigger set_catalog_library_brand_defaults
before insert or update on public.catalog_library_brands
for each row
execute function public.set_catalog_library_brand_defaults();

drop trigger if exists set_catalog_library_categories_updated_at on public.catalog_library_categories;
create trigger set_catalog_library_categories_updated_at
before update on public.catalog_library_categories
for each row
execute function public.set_updated_at();

drop trigger if exists set_catalog_library_product_types_updated_at on public.catalog_library_product_types;
create trigger set_catalog_library_product_types_updated_at
before update on public.catalog_library_product_types
for each row
execute function public.set_updated_at();

drop trigger if exists set_catalog_library_brands_updated_at on public.catalog_library_brands;
create trigger set_catalog_library_brands_updated_at
before update on public.catalog_library_brands
for each row
execute function public.set_updated_at();

insert into public.catalog_library_categories (
  name,
  category_type,
  display_order,
  description
)
select name, category_type, display_order, description
from (
  values
    ('Solar Panels', 'SOLAR_PANEL'::public.product_category_type, 1, 'PV modules and panel variants'),
    ('Inverters', 'INVERTER'::public.product_category_type, 2, 'Solar inverter categories'),
    ('Structure', 'STRUCTURE'::public.product_category_type, 3, 'Mounting and support structures'),
    ('DC Cable', 'DC_CABLE'::public.product_category_type, 4, 'DC cable materials'),
    ('AC Cable', 'AC_CABLE'::public.product_category_type, 5, 'AC cable materials'),
    ('Earthing', 'EARTHING'::public.product_category_type, 6, 'Earthing materials'),
    ('Protection Devices', 'PROTECTION_DEVICE'::public.product_category_type, 7, 'ACDB, DCDB, isolators, and protection devices'),
    ('Lightning Arrestor', 'LIGHTNING_ARRESTOR'::public.product_category_type, 8, 'Lightning protection materials'),
    ('Monitoring Devices', 'MONITORING_DEVICE'::public.product_category_type, 9, 'Monitoring and metering devices'),
    ('Battery', 'BATTERY'::public.product_category_type, 10, 'Battery and storage products'),
    ('Accessories', 'ACCESSORY'::public.product_category_type, 11, 'Connectors, fasteners, tools, and accessories'),
    ('Other', 'OTHER'::public.product_category_type, 999, 'Other catalog materials')
) as defaults(name, category_type, display_order, description)
where not exists (
  select 1
  from public.catalog_library_categories
  where lower(btrim(catalog_library_categories.name)) = lower(btrim(defaults.name))
);

insert into public.catalog_library_product_types (
  category_id,
  name,
  display_order
)
select categories.id, product_types.name, product_types.display_order
from (
  values
    ('Solar Panels', 'Mono PERC Panels', 1),
    ('Solar Panels', 'TOPCon Panels', 2),
    ('Solar Panels', 'Bifacial Panels', 3),
    ('Solar Panels', 'Polycrystalline Panels', 4),
    ('Inverters', 'String Inverters', 1),
    ('Inverters', 'Central Inverters', 2),
    ('Inverters', 'Micro Inverters', 3),
    ('Inverters', 'Hybrid Inverters', 4),
    ('Inverters', 'Off-Grid Inverters', 5)
) as product_types(category_name, name, display_order)
join public.catalog_library_categories as categories
  on lower(btrim(categories.name)) = lower(btrim(product_types.category_name))
where not exists (
  select 1
  from public.catalog_library_product_types
  where catalog_library_product_types.category_id = categories.id
    and lower(btrim(catalog_library_product_types.name)) = lower(btrim(product_types.name))
);

create or replace function public.import_catalog_library_defaults()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  category_count integer := 0;
  product_type_count integer := 0;
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

  insert into public.product_types (
    tenant_id,
    category_id,
    name,
    display_order,
    is_active
  )
  select
    target_tenant_id,
    tenant_categories.id,
    library_product_types.name,
    library_product_types.display_order,
    true
  from public.catalog_library_product_types as library_product_types
  join public.catalog_library_categories as library_categories
    on library_categories.id = library_product_types.category_id
  join public.product_categories as tenant_categories
    on tenant_categories.tenant_id = target_tenant_id
   and (
      lower(btrim(tenant_categories.name)) = lower(btrim(library_categories.name))
      or (
        library_categories.category_type <> 'OTHER'::public.product_category_type
        and tenant_categories.category_type = library_categories.category_type
      )
    )
  where library_categories.is_active is not false
    and library_product_types.is_active is not false
    and not exists (
      select 1
      from public.product_types
      where product_types.tenant_id = target_tenant_id
        and product_types.category_id = tenant_categories.id
        and lower(btrim(product_types.name)) = lower(btrim(library_product_types.name))
    );

  get diagnostics product_type_count = row_count;

  return jsonb_build_object(
    'categories_imported', category_count,
    'product_types_imported', product_type_count
  );
end;
$$;

alter table public.catalog_library_categories enable row level security;
alter table public.catalog_library_product_types enable row level security;
alter table public.catalog_library_brands enable row level security;

grant select, insert, update, delete on public.catalog_library_categories to authenticated;
grant select, insert, update, delete on public.catalog_library_product_types to authenticated;
grant select, insert, update, delete on public.catalog_library_brands to authenticated;

drop policy if exists "Authenticated users can view catalog library categories" on public.catalog_library_categories;
drop policy if exists "Super admins can manage catalog library categories" on public.catalog_library_categories;
drop policy if exists "Authenticated users can view catalog library product types" on public.catalog_library_product_types;
drop policy if exists "Super admins can manage catalog library product types" on public.catalog_library_product_types;
drop policy if exists "Authenticated users can view catalog library brands" on public.catalog_library_brands;
drop policy if exists "Super admins can manage catalog library brands" on public.catalog_library_brands;

create policy "Authenticated users can view catalog library categories"
on public.catalog_library_categories
for select
to authenticated
using (is_active is not false or public.is_super_admin());

create policy "Super admins can manage catalog library categories"
on public.catalog_library_categories
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Authenticated users can view catalog library product types"
on public.catalog_library_product_types
for select
to authenticated
using (is_active is not false or public.is_super_admin());

create policy "Super admins can manage catalog library product types"
on public.catalog_library_product_types
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Authenticated users can view catalog library brands"
on public.catalog_library_brands
for select
to authenticated
using (is_active is not false or public.is_super_admin());

create policy "Super admins can manage catalog library brands"
on public.catalog_library_brands
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

grant execute on function public.import_catalog_library_defaults() to authenticated;

notify pgrst, 'reload schema';
