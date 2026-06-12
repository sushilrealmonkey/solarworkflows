-- Adds tenant-scoped inventory master data for searchable create-or-select
-- dropdowns while keeping legacy inventory columns populated for existing flows.

create table if not exists public.products_master (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.brands_master (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.models_master (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products_master(id) on delete restrict,
  brand_id uuid not null references public.brands_master(id) on delete restrict,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.vendors_master (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

alter table public.inventory_items add column if not exists product_id uuid references public.products_master(id) on delete restrict;
alter table public.inventory_items add column if not exists brand_id uuid references public.brands_master(id) on delete restrict;
alter table public.inventory_items add column if not exists model_id uuid references public.models_master(id) on delete restrict;
alter table public.inventory_items add column if not exists vendor_id uuid references public.vendors_master(id) on delete set null;
alter table public.inventory_items add column if not exists opening_stock numeric default 0;
alter table public.inventory_items add column if not exists bill_no text;
alter table public.inventory_items add column if not exists inventory_date date;

alter table public.products_master alter column id set default gen_random_uuid();
alter table public.brands_master alter column id set default gen_random_uuid();
alter table public.models_master alter column id set default gen_random_uuid();
alter table public.vendors_master alter column id set default gen_random_uuid();

alter table public.products_master alter column created_at set default now();
alter table public.brands_master alter column created_at set default now();
alter table public.models_master alter column created_at set default now();
alter table public.vendors_master alter column created_at set default now();

create unique index if not exists products_master_organization_name_unique
on public.products_master (organization_id, lower(btrim(name)));

create unique index if not exists brands_master_organization_name_unique
on public.brands_master (organization_id, lower(btrim(name)));

create unique index if not exists vendors_master_organization_name_unique
on public.vendors_master (organization_id, lower(btrim(name)));

create unique index if not exists models_master_organization_product_brand_name_unique
on public.models_master (organization_id, product_id, brand_id, lower(btrim(name)));

create index if not exists products_master_organization_id_idx
on public.products_master (organization_id);

create index if not exists brands_master_organization_id_idx
on public.brands_master (organization_id);

create index if not exists models_master_organization_id_idx
on public.models_master (organization_id);

create index if not exists models_master_product_brand_idx
on public.models_master (product_id, brand_id);

create index if not exists vendors_master_organization_id_idx
on public.vendors_master (organization_id);

create index if not exists inventory_items_product_brand_model_idx
on public.inventory_items (organization_id, product_id, brand_id, model_id);

create unique index if not exists inventory_items_organization_product_brand_model_unique
on public.inventory_items (organization_id, product_id, brand_id, model_id)
where product_id is not null
  and brand_id is not null
  and model_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_opening_stock_nonnegative_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
    add constraint inventory_items_opening_stock_nonnegative_check
    check (opening_stock >= 0);
  end if;
end;
$$;

with source_products as (
  select distinct on (inventory_items.organization_id, lower(btrim(inventory_items.item_name)))
    inventory_items.organization_id,
    btrim(inventory_items.item_name) as name
  from public.inventory_items
  where nullif(btrim(inventory_items.item_name), '') is not null
  order by inventory_items.organization_id, lower(btrim(inventory_items.item_name)), inventory_items.created_at
)
insert into public.products_master (organization_id, name)
select source_products.organization_id, source_products.name
from source_products
where not exists (
  select 1
  from public.products_master
  where products_master.organization_id = source_products.organization_id
    and lower(btrim(products_master.name)) = lower(btrim(source_products.name))
);

with source_brands as (
  select distinct on (inventory_items.organization_id, lower(btrim(inventory_items.brand)))
    inventory_items.organization_id,
    btrim(inventory_items.brand) as name
  from public.inventory_items
  where nullif(btrim(coalesce(inventory_items.brand, '')), '') is not null
  order by inventory_items.organization_id, lower(btrim(inventory_items.brand)), inventory_items.created_at
)
insert into public.brands_master (organization_id, name)
select source_brands.organization_id, source_brands.name
from source_brands
where not exists (
  select 1
  from public.brands_master
  where brands_master.organization_id = source_brands.organization_id
    and lower(btrim(brands_master.name)) = lower(btrim(source_brands.name))
);

with source_vendors as (
  select distinct on (vendors.organization_id, lower(btrim(vendors.vendor_name)))
    vendors.organization_id,
    btrim(vendors.vendor_name) as name
  from public.vendors
  where nullif(btrim(coalesce(vendors.vendor_name, '')), '') is not null
  order by vendors.organization_id, lower(btrim(vendors.vendor_name)), vendors.created_at
)
insert into public.vendors_master (organization_id, name)
select source_vendors.organization_id, source_vendors.name
from source_vendors
where not exists (
  select 1
  from public.vendors_master
  where vendors_master.organization_id = source_vendors.organization_id
    and lower(btrim(vendors_master.name)) = lower(btrim(source_vendors.name))
);

update public.inventory_items
set product_id = products_master.id
from public.products_master
where inventory_items.product_id is null
  and inventory_items.organization_id = products_master.organization_id
  and lower(btrim(inventory_items.item_name)) = lower(btrim(products_master.name));

update public.inventory_items
set brand_id = brands_master.id
from public.brands_master
where inventory_items.brand_id is null
  and inventory_items.organization_id = brands_master.organization_id
  and nullif(btrim(coalesce(inventory_items.brand, '')), '') is not null
  and lower(btrim(inventory_items.brand)) = lower(btrim(brands_master.name));

with source_models as (
  select distinct on (
    inventory_items.organization_id,
    inventory_items.product_id,
    inventory_items.brand_id,
    lower(btrim(inventory_items.model))
  )
    inventory_items.organization_id,
    inventory_items.product_id,
    inventory_items.brand_id,
    btrim(inventory_items.model) as name
  from public.inventory_items
  where inventory_items.product_id is not null
    and inventory_items.brand_id is not null
    and nullif(btrim(coalesce(inventory_items.model, '')), '') is not null
  order by
    inventory_items.organization_id,
    inventory_items.product_id,
    inventory_items.brand_id,
    lower(btrim(inventory_items.model)),
    inventory_items.created_at
)
insert into public.models_master (organization_id, product_id, brand_id, name)
select
  source_models.organization_id,
  source_models.product_id,
  source_models.brand_id,
  source_models.name
from source_models
where not exists (
  select 1
  from public.models_master
  where models_master.organization_id = source_models.organization_id
    and models_master.product_id = source_models.product_id
    and models_master.brand_id = source_models.brand_id
    and lower(btrim(models_master.name)) = lower(btrim(source_models.name))
);

update public.inventory_items
set model_id = models_master.id
from public.models_master
where inventory_items.model_id is null
  and inventory_items.organization_id = models_master.organization_id
  and inventory_items.product_id = models_master.product_id
  and inventory_items.brand_id = models_master.brand_id
  and nullif(btrim(coalesce(inventory_items.model, '')), '') is not null
  and lower(btrim(inventory_items.model)) = lower(btrim(models_master.name));

create or replace function public.inventory_category_from_product_name(product_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(product_name, '')) like '%solar panel%' then 'solar_panel'
    when lower(coalesce(product_name, '')) like '%inverter%' then 'inverter'
    when lower(coalesce(product_name, '')) like '%battery%' then 'battery'
    when lower(coalesce(product_name, '')) like '%mounting%' then 'mounting_structure'
    when lower(coalesce(product_name, '')) like '%cable%' then 'cable'
    when lower(coalesce(product_name, '')) like '%acdb%' then 'safety_equipment'
    when lower(coalesce(product_name, '')) like '%dcdb%' then 'safety_equipment'
    when lower(coalesce(product_name, '')) like '%earthing%' then 'safety_equipment'
    when lower(coalesce(product_name, '')) like '%lightning%' then 'safety_equipment'
    else 'other'
  end;
$$;

create or replace function public.set_inventory_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product_record public.products_master%rowtype;
  brand_record public.brands_master%rowtype;
  model_record public.models_master%rowtype;
  vendor_record public.vendors_master%rowtype;
begin
  if new.item_code is null or trim(new.item_code) = '' then
    new.item_code := public.generate_inventory_item_code(new.organization_id);
  end if;

  if new.product_id is not null then
    select *
    into product_record
    from public.products_master
    where products_master.id = new.product_id;

    if not found or product_record.organization_id <> new.organization_id then
      raise exception 'product_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    new.item_name := product_record.name;
    new.item_category := public.inventory_category_from_product_name(product_record.name);
  end if;

  if new.brand_id is not null then
    select *
    into brand_record
    from public.brands_master
    where brands_master.id = new.brand_id;

    if not found or brand_record.organization_id <> new.organization_id then
      raise exception 'brand_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    new.brand := brand_record.name;
  end if;

  if new.model_id is not null then
    select *
    into model_record
    from public.models_master
    where models_master.id = new.model_id;

    if not found or model_record.organization_id <> new.organization_id then
      raise exception 'model_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    if new.product_id is not null and model_record.product_id <> new.product_id then
      raise exception 'model_id must match the selected product_id'
        using errcode = '23503';
    end if;

    if new.brand_id is not null and model_record.brand_id <> new.brand_id then
      raise exception 'model_id must match the selected brand_id'
        using errcode = '23503';
    end if;

    new.model := model_record.name;
  end if;

  if new.vendor_id is not null then
    select *
    into vendor_record
    from public.vendors_master
    where vendors_master.id = new.vendor_id;

    if not found or vendor_record.organization_id <> new.organization_id then
      raise exception 'vendor_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;
  end if;

  new.item_category := coalesce(nullif(trim(new.item_category), ''), 'other');
  new.current_stock := coalesce(new.current_stock, 0);
  new.opening_stock := coalesce(new.opening_stock, 0);
  new.minimum_stock := coalesce(new.minimum_stock, 0);
  new.purchase_price := coalesce(new.purchase_price, 0);
  new.selling_price := coalesce(new.selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'active');

  return new;
end;
$$;

drop trigger if exists set_inventory_items_defaults on public.inventory_items;

create trigger set_inventory_items_defaults
before insert or update on public.inventory_items
for each row
execute function public.set_inventory_item_defaults();

alter table public.products_master enable row level security;
alter table public.brands_master enable row level security;
alter table public.models_master enable row level security;
alter table public.vendors_master enable row level security;

drop policy if exists "Super admins can manage products master" on public.products_master;
drop policy if exists "Organization users can view products master" on public.products_master;
drop policy if exists "Organization users can create products master" on public.products_master;
drop policy if exists "Organization users can update products master" on public.products_master;
drop policy if exists "Organization users can delete products master" on public.products_master;

create policy "Super admins can manage products master"
on public.products_master for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view products master"
on public.products_master for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create products master"
on public.products_master for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update products master"
on public.products_master for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can delete products master"
on public.products_master for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

drop policy if exists "Super admins can manage brands master" on public.brands_master;
drop policy if exists "Organization users can view brands master" on public.brands_master;
drop policy if exists "Organization users can create brands master" on public.brands_master;
drop policy if exists "Organization users can update brands master" on public.brands_master;
drop policy if exists "Organization users can delete brands master" on public.brands_master;

create policy "Super admins can manage brands master"
on public.brands_master for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view brands master"
on public.brands_master for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create brands master"
on public.brands_master for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update brands master"
on public.brands_master for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can delete brands master"
on public.brands_master for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

drop policy if exists "Super admins can manage models master" on public.models_master;
drop policy if exists "Organization users can view models master" on public.models_master;
drop policy if exists "Organization users can create models master" on public.models_master;
drop policy if exists "Organization users can update models master" on public.models_master;
drop policy if exists "Organization users can delete models master" on public.models_master;

create policy "Super admins can manage models master"
on public.models_master for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view models master"
on public.models_master for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create models master"
on public.models_master for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update models master"
on public.models_master for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can delete models master"
on public.models_master for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

drop policy if exists "Super admins can manage vendors master" on public.vendors_master;
drop policy if exists "Organization users can view vendors master" on public.vendors_master;
drop policy if exists "Organization users can create vendors master" on public.vendors_master;
drop policy if exists "Organization users can update vendors master" on public.vendors_master;
drop policy if exists "Organization users can delete vendors master" on public.vendors_master;

create policy "Super admins can manage vendors master"
on public.vendors_master for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view vendors master"
on public.vendors_master for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create vendors master"
on public.vendors_master for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update vendors master"
on public.vendors_master for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can delete vendors master"
on public.vendors_master for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

notify pgrst, 'reload schema';
