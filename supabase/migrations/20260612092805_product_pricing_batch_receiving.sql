-- Product pricing, batch cost, and partial purchase receiving.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'product_pricing',
  'Product Pricing',
  'Admin-only product purchase and selling price management',
  386,
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
where modules.module_key = 'product_pricing'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where modules.module_key = 'product_pricing'
  and (
    coalesce(roles.is_system_role, false) = true
    or lower(btrim(roles.role_name)) = 'admin'
  )
on conflict (role_id, permission_id) do nothing;

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  current_purchase_price numeric default 0,
  current_selling_price numeric default 0,
  gst_percent numeric default 0,
  effective_date date default current_date,
  created_by uuid references public.users_profile(id) on delete set null,
  updated_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.product_prices add column if not exists id uuid default gen_random_uuid();
alter table public.product_prices add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.product_prices add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.product_prices add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.product_prices add column if not exists current_purchase_price numeric default 0;
alter table public.product_prices add column if not exists current_selling_price numeric default 0;
alter table public.product_prices add column if not exists gst_percent numeric default 0;
alter table public.product_prices add column if not exists effective_date date default current_date;
alter table public.product_prices add column if not exists created_by uuid references public.users_profile(id) on delete set null;
alter table public.product_prices add column if not exists updated_by uuid references public.users_profile(id) on delete set null;
alter table public.product_prices add column if not exists created_at timestamptz default now();
alter table public.product_prices add column if not exists updated_at timestamptz default now();

alter table public.product_prices alter column id set default gen_random_uuid();
alter table public.product_prices alter column organization_id set not null;
alter table public.product_prices alter column product_id set not null;
alter table public.product_prices alter column current_purchase_price set default 0;
alter table public.product_prices alter column current_selling_price set default 0;
alter table public.product_prices alter column gst_percent set default 0;
alter table public.product_prices alter column effective_date set default current_date;
alter table public.product_prices alter column created_at set default now();
alter table public.product_prices alter column updated_at set default now();

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  product_price_id uuid references public.product_prices(id) on delete set null,
  old_purchase_price numeric,
  new_purchase_price numeric default 0,
  old_selling_price numeric,
  new_selling_price numeric default 0,
  old_gst_percent numeric,
  new_gst_percent numeric default 0,
  effective_date date default current_date,
  source text default 'manual',
  changed_by uuid references public.users_profile(id) on delete set null,
  changed_at timestamptz default now()
);

alter table public.product_price_history add column if not exists id uuid default gen_random_uuid();
alter table public.product_price_history add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.product_price_history add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.product_price_history add column if not exists product_id uuid references public.products(id) on delete cascade;
alter table public.product_price_history add column if not exists product_price_id uuid references public.product_prices(id) on delete set null;
alter table public.product_price_history add column if not exists old_purchase_price numeric;
alter table public.product_price_history add column if not exists new_purchase_price numeric default 0;
alter table public.product_price_history add column if not exists old_selling_price numeric;
alter table public.product_price_history add column if not exists new_selling_price numeric default 0;
alter table public.product_price_history add column if not exists old_gst_percent numeric;
alter table public.product_price_history add column if not exists new_gst_percent numeric default 0;
alter table public.product_price_history add column if not exists effective_date date default current_date;
alter table public.product_price_history add column if not exists source text default 'manual';
alter table public.product_price_history add column if not exists changed_by uuid references public.users_profile(id) on delete set null;
alter table public.product_price_history add column if not exists changed_at timestamptz default now();

alter table public.product_price_history alter column id set default gen_random_uuid();
alter table public.product_price_history alter column organization_id set not null;
alter table public.product_price_history alter column product_id set not null;
alter table public.product_price_history alter column new_purchase_price set default 0;
alter table public.product_price_history alter column new_selling_price set default 0;
alter table public.product_price_history alter column new_gst_percent set default 0;
alter table public.product_price_history alter column effective_date set default current_date;
alter table public.product_price_history alter column source set default 'manual';
alter table public.product_price_history alter column changed_at set default now();

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  received_quantity numeric not null,
  remaining_quantity numeric not null,
  actual_unit_purchase_price numeric default 0,
  gst_percent numeric default 0,
  bill_no text,
  received_date date default current_date,
  notes text,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.inventory_batches add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_batches add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.inventory_batches add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.inventory_batches add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.inventory_batches add column if not exists product_id uuid references public.products(id) on delete restrict;
alter table public.inventory_batches add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;
alter table public.inventory_batches add column if not exists purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null;
alter table public.inventory_batches add column if not exists vendor_id uuid references public.vendors(id) on delete set null;
alter table public.inventory_batches add column if not exists received_quantity numeric;
alter table public.inventory_batches add column if not exists remaining_quantity numeric;
alter table public.inventory_batches add column if not exists actual_unit_purchase_price numeric default 0;
alter table public.inventory_batches add column if not exists gst_percent numeric default 0;
alter table public.inventory_batches add column if not exists bill_no text;
alter table public.inventory_batches add column if not exists received_date date default current_date;
alter table public.inventory_batches add column if not exists notes text;
alter table public.inventory_batches add column if not exists created_by uuid references public.users_profile(id) on delete set null;
alter table public.inventory_batches add column if not exists created_at timestamptz default now();
alter table public.inventory_batches add column if not exists updated_at timestamptz default now();

alter table public.inventory_batches alter column id set default gen_random_uuid();
alter table public.inventory_batches alter column organization_id set not null;
alter table public.inventory_batches alter column inventory_item_id set not null;
alter table public.inventory_batches alter column product_id set not null;
alter table public.inventory_batches alter column received_quantity set not null;
alter table public.inventory_batches alter column remaining_quantity set not null;
alter table public.inventory_batches alter column actual_unit_purchase_price set default 0;
alter table public.inventory_batches alter column gst_percent set default 0;
alter table public.inventory_batches alter column received_date set default current_date;
alter table public.inventory_batches alter column created_at set default now();
alter table public.inventory_batches alter column updated_at set default now();

alter table public.purchase_order_items add column if not exists received_quantity numeric default 0;
alter table public.purchase_order_items add column if not exists last_received_at timestamptz;
alter table public.purchase_order_items alter column received_quantity set default 0;

create unique index if not exists product_prices_product_id_unique
on public.product_prices (product_id);

create index if not exists product_prices_company_id_idx
on public.product_prices (company_id)
where company_id is not null;

create index if not exists product_prices_organization_id_idx
on public.product_prices (organization_id);

create index if not exists product_price_history_product_id_idx
on public.product_price_history (product_id);

create index if not exists product_price_history_organization_id_idx
on public.product_price_history (organization_id);

create index if not exists inventory_batches_inventory_item_id_idx
on public.inventory_batches (inventory_item_id);

create index if not exists inventory_batches_product_id_idx
on public.inventory_batches (product_id);

create index if not exists inventory_batches_purchase_order_item_id_idx
on public.inventory_batches (purchase_order_item_id);

create index if not exists inventory_batches_organization_id_idx
on public.inventory_batches (organization_id);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_status_check'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders drop constraint purchase_orders_status_check;
  end if;
end;
$$;

alter table public.purchase_orders
add constraint purchase_orders_status_check
check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_prices_numbers_nonnegative_check'
      and conrelid = 'public.product_prices'::regclass
  ) then
    alter table public.product_prices
    add constraint product_prices_numbers_nonnegative_check
    check (
      current_purchase_price >= 0
      and current_selling_price >= 0
      and gst_percent >= 0
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_price_history_source_check'
      and conrelid = 'public.product_price_history'::regclass
  ) then
    alter table public.product_price_history
    add constraint product_price_history_source_check
    check (source in ('manual', 'purchase_receive', 'legacy_migration'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_batches_numbers_check'
      and conrelid = 'public.inventory_batches'::regclass
  ) then
    alter table public.inventory_batches
    add constraint inventory_batches_numbers_check
    check (
      received_quantity > 0
      and remaining_quantity >= 0
      and remaining_quantity <= received_quantity
      and actual_unit_purchase_price >= 0
      and gst_percent >= 0
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_order_items_received_quantity_check'
      and conrelid = 'public.purchase_order_items'::regclass
  ) then
    alter table public.purchase_order_items
    add constraint purchase_order_items_received_quantity_check
    check (
      received_quantity >= 0
      and received_quantity <= quantity
    );
  end if;
end;
$$;

create or replace function public.current_user_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users_profile.id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;
$$;

create or replace function public.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users_profile.company_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;
$$;

create or replace function public.set_product_price_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product_organization_id uuid;
begin
  select products.tenant_id
  into product_organization_id
  from public.products
  where products.id = new.product_id;

  if product_organization_id is null then
    raise exception 'product_id must reference an existing product'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := product_organization_id;
  end if;

  if new.organization_id <> product_organization_id then
    raise exception 'product price organization_id must match product tenant'
      using errcode = '23503';
  end if;

  if new.company_id is null then
    new.company_id := public.current_user_company_id();
  end if;

  new.current_purchase_price := coalesce(new.current_purchase_price, 0);
  new.current_selling_price := coalesce(new.current_selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.effective_date := coalesce(new.effective_date, current_date);
  new.updated_by := coalesce(new.updated_by, public.current_user_profile_id());

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, new.updated_by);
  end if;

  return new;
end;
$$;

create or replace function public.set_product_price_history_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product_organization_id uuid;
begin
  select products.tenant_id
  into product_organization_id
  from public.products
  where products.id = new.product_id;

  if product_organization_id is null then
    raise exception 'product_id must reference an existing product'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := product_organization_id;
  end if;

  if new.organization_id <> product_organization_id then
    raise exception 'product price history organization_id must match product tenant'
      using errcode = '23503';
  end if;

  if new.company_id is null then
    new.company_id := public.current_user_company_id();
  end if;

  new.new_purchase_price := coalesce(new.new_purchase_price, 0);
  new.new_selling_price := coalesce(new.new_selling_price, 0);
  new.new_gst_percent := coalesce(new.new_gst_percent, 0);
  new.effective_date := coalesce(new.effective_date, current_date);
  new.source := coalesce(nullif(lower(btrim(new.source)), ''), 'manual');
  new.changed_by := coalesce(new.changed_by, public.current_user_profile_id());

  return new;
end;
$$;

create or replace function public.set_inventory_batch_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.inventory_items%rowtype;
  order_organization_id uuid;
begin
  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = new.inventory_item_id;

  if not found then
    raise exception 'inventory_item_id must reference an existing inventory item'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := item_record.organization_id;
  end if;

  if new.organization_id <> item_record.organization_id then
    raise exception 'inventory batch organization_id must match inventory item'
      using errcode = '23503';
  end if;

  if item_record.catalog_product_id is null then
    raise exception 'inventory batch item must be linked to Product Master'
      using errcode = '23503';
  end if;

  if new.product_id is null then
    new.product_id := item_record.catalog_product_id;
  end if;

  if new.product_id <> item_record.catalog_product_id then
    raise exception 'inventory batch product_id must match inventory item product'
      using errcode = '23503';
  end if;

  if new.purchase_order_id is not null then
    select purchase_orders.organization_id
    into order_organization_id
    from public.purchase_orders
    where purchase_orders.id = new.purchase_order_id;

    if order_organization_id is null or order_organization_id <> new.organization_id then
      raise exception 'purchase_order_id must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.company_id is null then
    new.company_id := public.current_user_company_id();
  end if;

  new.received_quantity := coalesce(new.received_quantity, 0);
  new.remaining_quantity := coalesce(new.remaining_quantity, new.received_quantity);
  new.actual_unit_purchase_price := coalesce(new.actual_unit_purchase_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.received_date := coalesce(new.received_date, current_date);
  new.bill_no := nullif(btrim(coalesce(new.bill_no, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.created_by := coalesce(new.created_by, public.current_user_profile_id());

  return new;
end;
$$;

drop trigger if exists set_product_prices_defaults on public.product_prices;
create trigger set_product_prices_defaults
before insert or update on public.product_prices
for each row
execute function public.set_product_price_defaults();

drop trigger if exists set_product_prices_updated_at on public.product_prices;
create trigger set_product_prices_updated_at
before update on public.product_prices
for each row
execute function public.set_updated_at();

drop trigger if exists set_product_price_history_defaults on public.product_price_history;
create trigger set_product_price_history_defaults
before insert on public.product_price_history
for each row
execute function public.set_product_price_history_defaults();

drop trigger if exists set_inventory_batches_defaults on public.inventory_batches;
create trigger set_inventory_batches_defaults
before insert or update on public.inventory_batches
for each row
execute function public.set_inventory_batch_defaults();

drop trigger if exists set_inventory_batches_updated_at on public.inventory_batches;
create trigger set_inventory_batches_updated_at
before update on public.inventory_batches
for each row
execute function public.set_updated_at();

insert into public.product_prices (
  organization_id,
  product_id,
  current_purchase_price,
  current_selling_price,
  gst_percent,
  effective_date,
  created_at,
  updated_at
)
select
  products.tenant_id,
  products.id,
  coalesce(products.purchase_price, 0),
  coalesce(products.selling_price, 0),
  coalesce(products.gst_percent, 0),
  current_date,
  coalesce(products.created_at, now()),
  coalesce(products.updated_at, now())
from public.products
where not exists (
  select 1
  from public.product_prices
  where product_prices.product_id = products.id
)
on conflict (product_id) do nothing;

insert into public.product_price_history (
  organization_id,
  product_id,
  product_price_id,
  new_purchase_price,
  new_selling_price,
  new_gst_percent,
  effective_date,
  source,
  changed_at
)
select
  product_prices.organization_id,
  product_prices.product_id,
  product_prices.id,
  product_prices.current_purchase_price,
  product_prices.current_selling_price,
  product_prices.gst_percent,
  product_prices.effective_date,
  'legacy_migration',
  product_prices.created_at
from public.product_prices
where not exists (
  select 1
  from public.product_price_history
  where product_price_history.product_id = product_prices.product_id
    and product_price_history.source = 'legacy_migration'
);

-- Legacy price columns remain for compatibility only. Clear migrated values so
-- staff-safe product and inventory table access cannot leak old prices.
update public.products
set
  purchase_price = 0,
  selling_price = 0;

update public.inventory_items
set
  purchase_price = 0,
  selling_price = 0;

create or replace function public.update_product_price(
  target_product_id uuid,
  new_purchase_price numeric,
  new_selling_price numeric,
  new_gst_percent numeric,
  new_effective_date date default current_date
)
returns public.product_prices
language plpgsql
security definer
set search_path = public
as $$
declare
  product_record public.products%rowtype;
  existing_price public.product_prices%rowtype;
  next_price public.product_prices%rowtype;
  current_profile_id uuid := public.current_user_profile_id();
  current_company_id uuid := public.current_user_company_id();
begin
  if target_product_id is null then
    raise exception 'target_product_id is required'
      using errcode = '23502';
  end if;

  select *
  into product_record
  from public.products
  where products.id = target_product_id;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if product_record.tenant_id <> public.current_user_organization_id() then
      raise exception 'Cannot update product pricing for another organization'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('product_pricing', 'update')
      or public.user_has_permission('product_pricing', 'create')
    ) then
      raise exception 'Missing product_pricing update permission'
        using errcode = '42501';
    end if;
  end if;

  if coalesce(new_purchase_price, 0) < 0
    or coalesce(new_selling_price, 0) < 0
    or coalesce(new_gst_percent, 0) < 0 then
    raise exception 'Price and GST values cannot be negative'
      using errcode = '23514';
  end if;

  select *
  into existing_price
  from public.product_prices
  where product_prices.product_id = product_record.id
  for update;

  insert into public.product_prices (
    company_id,
    organization_id,
    product_id,
    current_purchase_price,
    current_selling_price,
    gst_percent,
    effective_date,
    created_by,
    updated_by
  )
  values (
    current_company_id,
    product_record.tenant_id,
    product_record.id,
    coalesce(new_purchase_price, 0),
    coalesce(new_selling_price, 0),
    coalesce(new_gst_percent, 0),
    coalesce(new_effective_date, current_date),
    current_profile_id,
    current_profile_id
  )
  on conflict (product_id) do update
  set
    company_id = coalesce(excluded.company_id, product_prices.company_id),
    current_purchase_price = excluded.current_purchase_price,
    current_selling_price = excluded.current_selling_price,
    gst_percent = excluded.gst_percent,
    effective_date = excluded.effective_date,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into next_price;

  insert into public.product_price_history (
    company_id,
    organization_id,
    product_id,
    product_price_id,
    old_purchase_price,
    new_purchase_price,
    old_selling_price,
    new_selling_price,
    old_gst_percent,
    new_gst_percent,
    effective_date,
    source,
    changed_by
  )
  values (
    coalesce(next_price.company_id, current_company_id),
    next_price.organization_id,
    next_price.product_id,
    next_price.id,
    existing_price.current_purchase_price,
    next_price.current_purchase_price,
    existing_price.current_selling_price,
    next_price.current_selling_price,
    existing_price.gst_percent,
    next_price.gst_percent,
    next_price.effective_date,
    'manual',
    current_profile_id
  );

  return next_price;
end;
$$;

create or replace function public.receive_purchase_order_items(
  target_purchase_order_id uuid,
  received_items jsonb,
  receipt_bill_no text default null,
  receipt_date date default current_date,
  receipt_notes text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.purchase_orders%rowtype;
  receive_row jsonb;
  item_record public.purchase_order_items%rowtype;
  inventory_record public.inventory_items%rowtype;
  current_profile_id uuid := public.current_user_profile_id();
  current_company_id uuid := public.current_user_company_id();
  receive_quantity numeric;
  actual_unit_price numeric;
  receive_gst_percent numeric;
  update_current_price boolean;
  existing_price public.product_prices%rowtype;
  next_price public.product_prices%rowtype;
  received_any boolean := false;
  all_received boolean;
  any_received boolean;
begin
  if target_purchase_order_id is null then
    raise exception 'target_purchase_order_id is required'
      using errcode = '23502';
  end if;

  if received_items is null or jsonb_typeof(received_items) <> 'array' or jsonb_array_length(received_items) = 0 then
    raise exception 'received_items must contain at least one item'
      using errcode = '23514';
  end if;

  select *
  into order_record
  from public.purchase_orders
  where purchase_orders.id = target_purchase_order_id
  for update;

  if not found then
    raise exception 'Purchase order not found'
      using errcode = 'P0002';
  end if;

  if order_record.status = 'received' then
    raise exception 'Purchase order is already received'
      using errcode = '23514';
  end if;

  if order_record.status = 'cancelled' then
    raise exception 'Cancelled purchase orders cannot be received'
      using errcode = '23514';
  end if;

  if not public.is_super_admin() then
    if order_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot receive purchase orders for another organization'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('inventory', 'create')
      and public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    ) then
      raise exception 'Missing inventory or product pricing permission'
        using errcode = '42501';
    end if;
  end if;

  for receive_row in
    select value
    from jsonb_array_elements(received_items)
  loop
    if nullif(receive_row ->> 'purchase_order_item_id', '') is null then
      raise exception 'purchase_order_item_id is required for every received item'
        using errcode = '23502';
    end if;

    receive_quantity := coalesce((receive_row ->> 'received_quantity')::numeric, 0);
    actual_unit_price := coalesce((receive_row ->> 'actual_unit_purchase_price')::numeric, 0);
    receive_gst_percent := coalesce((receive_row ->> 'gst_percent')::numeric, 0);
    update_current_price := coalesce((receive_row ->> 'update_current_purchase_price')::boolean, false);

    if receive_quantity <= 0 then
      continue;
    end if;

    if actual_unit_price < 0 or receive_gst_percent < 0 then
      raise exception 'Received price and GST cannot be negative'
        using errcode = '23514';
    end if;

    select *
    into item_record
    from public.purchase_order_items
    where purchase_order_items.id = (receive_row ->> 'purchase_order_item_id')::uuid
      and purchase_order_items.purchase_order_id = order_record.id
    for update;

    if not found then
      raise exception 'Purchase order item not found for this order'
        using errcode = 'P0002';
    end if;

    if coalesce(item_record.received_quantity, 0) + receive_quantity > item_record.quantity then
      raise exception 'Received quantity cannot exceed ordered quantity'
        using errcode = '23514';
    end if;

    select *
    into inventory_record
    from public.inventory_items
    where inventory_items.id = item_record.item_id
    for update;

    if not found then
      raise exception 'Inventory item not found'
        using errcode = 'P0002';
    end if;

    if inventory_record.organization_id <> order_record.organization_id
      or item_record.organization_id <> order_record.organization_id then
      raise exception 'Purchase line and inventory item must belong to the same organization'
        using errcode = '23503';
    end if;

    if inventory_record.catalog_product_id is null then
      raise exception 'Inventory item must be linked to Product Master before receiving'
        using errcode = '23503';
    end if;

    insert into public.inventory_batches (
      company_id,
      organization_id,
      inventory_item_id,
      product_id,
      purchase_order_id,
      purchase_order_item_id,
      vendor_id,
      received_quantity,
      remaining_quantity,
      actual_unit_purchase_price,
      gst_percent,
      bill_no,
      received_date,
      notes,
      created_by
    )
    values (
      current_company_id,
      order_record.organization_id,
      inventory_record.id,
      inventory_record.catalog_product_id,
      order_record.id,
      item_record.id,
      order_record.vendor_id,
      receive_quantity,
      receive_quantity,
      actual_unit_price,
      receive_gst_percent,
      receipt_bill_no,
      coalesce(receipt_date, current_date),
      receipt_notes,
      current_profile_id
    );

    insert into public.inventory_transactions (
      organization_id,
      item_id,
      transaction_type,
      quantity,
      transaction_date,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    values (
      order_record.organization_id,
      inventory_record.id,
      'stock_in',
      receive_quantity,
      coalesce(receipt_date, current_date),
      'purchase_order',
      order_record.id,
      'Received from purchase order ' || coalesce(order_record.purchase_code, order_record.id::text),
      current_profile_id
    );

    update public.purchase_order_items
    set
      received_quantity = coalesce(received_quantity, 0) + receive_quantity,
      last_received_at = now()
    where purchase_order_items.id = item_record.id;

    if update_current_price then
      select *
      into existing_price
      from public.product_prices
      where product_prices.product_id = inventory_record.catalog_product_id
      for update;

      insert into public.product_prices (
        company_id,
        organization_id,
        product_id,
        current_purchase_price,
        current_selling_price,
        gst_percent,
        effective_date,
        created_by,
        updated_by
      )
      values (
        current_company_id,
        order_record.organization_id,
        inventory_record.catalog_product_id,
        actual_unit_price,
        coalesce(existing_price.current_selling_price, 0),
        receive_gst_percent,
        coalesce(receipt_date, current_date),
        current_profile_id,
        current_profile_id
      )
      on conflict (product_id) do update
      set
        company_id = coalesce(excluded.company_id, product_prices.company_id),
        current_purchase_price = excluded.current_purchase_price,
        current_selling_price = product_prices.current_selling_price,
        gst_percent = excluded.gst_percent,
        effective_date = excluded.effective_date,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning * into next_price;

      insert into public.product_price_history (
        company_id,
        organization_id,
        product_id,
        product_price_id,
        old_purchase_price,
        new_purchase_price,
        old_selling_price,
        new_selling_price,
        old_gst_percent,
        new_gst_percent,
        effective_date,
        source,
        changed_by
      )
      values (
        coalesce(next_price.company_id, current_company_id),
        next_price.organization_id,
        next_price.product_id,
        next_price.id,
        existing_price.current_purchase_price,
        next_price.current_purchase_price,
        existing_price.current_selling_price,
        next_price.current_selling_price,
        existing_price.gst_percent,
        next_price.gst_percent,
        next_price.effective_date,
        'purchase_receive',
        current_profile_id
      );
    end if;

    received_any := true;
  end loop;

  if not received_any then
    raise exception 'At least one received quantity must be greater than zero'
      using errcode = '23514';
  end if;

  select
    bool_and(coalesce(purchase_order_items.received_quantity, 0) >= purchase_order_items.quantity),
    bool_or(coalesce(purchase_order_items.received_quantity, 0) > 0)
  into all_received, any_received
  from public.purchase_order_items
  where purchase_order_items.purchase_order_id = order_record.id;

  update public.purchase_orders
  set status = case
    when all_received then 'received'
    when any_received then 'partially_received'
    else status
  end
  where purchase_orders.id = order_record.id
  returning * into order_record;

  return order_record;
end;
$$;

create or replace function public.receive_purchase_order(target_purchase_order_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  received_payload jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'purchase_order_item_id', purchase_order_items.id,
      'received_quantity', purchase_order_items.quantity - coalesce(purchase_order_items.received_quantity, 0),
      'actual_unit_purchase_price', purchase_order_items.unit_price,
      'gst_percent', purchase_order_items.gst_percent,
      'update_current_purchase_price', false
    )
  )
  into received_payload
  from public.purchase_order_items
  where purchase_order_items.purchase_order_id = target_purchase_order_id
    and purchase_order_items.quantity - coalesce(purchase_order_items.received_quantity, 0) > 0;

  return public.receive_purchase_order_items(
    target_purchase_order_id,
    coalesce(received_payload, '[]'::jsonb),
    null,
    current_date,
    null
  );
end;
$$;

create or replace function public.inventory_batch_history(target_item_id uuid)
returns table (
  id uuid,
  inventory_item_id uuid,
  product_id uuid,
  purchase_order_id uuid,
  purchase_order_item_id uuid,
  vendor_id uuid,
  vendor_name text,
  received_quantity numeric,
  remaining_quantity numeric,
  actual_unit_purchase_price numeric,
  gst_percent numeric,
  bill_no text,
  received_date date,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  item_organization_id uuid;
  can_view_cost boolean;
begin
  select inventory_items.organization_id
  into item_organization_id
  from public.inventory_items
  where inventory_items.id = target_item_id;

  if item_organization_id is null then
    return;
  end if;

  if not public.is_super_admin() then
    if item_organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot view inventory batches for another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('inventory', 'view') then
      raise exception 'Missing inventory view permission'
        using errcode = '42501';
    end if;
  end if;

  can_view_cost := public.is_super_admin()
    or public.user_has_permission('product_pricing', 'view');

  return query
  select
    inventory_batches.id,
    inventory_batches.inventory_item_id,
    inventory_batches.product_id,
    inventory_batches.purchase_order_id,
    inventory_batches.purchase_order_item_id,
    inventory_batches.vendor_id,
    vendors.vendor_name,
    inventory_batches.received_quantity,
    inventory_batches.remaining_quantity,
    case when can_view_cost then inventory_batches.actual_unit_purchase_price else null end,
    case when can_view_cost then inventory_batches.gst_percent else null end,
    inventory_batches.bill_no,
    inventory_batches.received_date,
    inventory_batches.notes,
    inventory_batches.created_at
  from public.inventory_batches
  left join public.vendors on vendors.id = inventory_batches.vendor_id
  where inventory_batches.inventory_item_id = target_item_id
  order by inventory_batches.received_date desc, inventory_batches.created_at desc;
end;
$$;

create or replace function public.purchase_order_public_rows(target_item_id uuid default null)
returns table (
  order_data jsonb
)
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
    and not public.user_has_permission('inventory', 'view') then
    raise exception 'Missing inventory view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', purchase_orders.id,
    'organization_id', purchase_orders.organization_id,
    'purchase_code', purchase_orders.purchase_code,
    'vendor_id', purchase_orders.vendor_id,
    'order_date', purchase_orders.order_date,
    'expected_delivery_date', purchase_orders.expected_delivery_date,
    'status', purchase_orders.status,
    'subtotal', null,
    'gst_amount', null,
    'total_amount', null,
    'notes', purchase_orders.notes,
    'created_by', purchase_orders.created_by,
    'created_at', purchase_orders.created_at,
    'updated_at', purchase_orders.updated_at,
    'vendor', jsonb_build_object(
      'id', vendors.id,
      'vendor_code', vendors.vendor_code,
      'vendor_name', vendors.vendor_name,
      'contact_person', vendors.contact_person,
      'phone', vendors.phone
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', purchase_order_items.id,
          'organization_id', purchase_order_items.organization_id,
          'purchase_order_id', purchase_order_items.purchase_order_id,
          'item_id', purchase_order_items.item_id,
          'quantity', purchase_order_items.quantity,
          'received_quantity', purchase_order_items.received_quantity,
          'unit_price', null,
          'gst_percent', null,
          'line_total', null,
          'created_at', purchase_order_items.created_at,
          'updated_at', purchase_order_items.updated_at,
          'item', jsonb_build_object(
            'id', inventory_items.id,
            'item_code', inventory_items.item_code,
            'item_name', inventory_items.item_name,
            'unit', inventory_items.unit,
            'brand', inventory_items.brand,
            'model', inventory_items.model
          )
        )
        order by purchase_order_items.created_at
      )
      from public.purchase_order_items
      join public.inventory_items on inventory_items.id = purchase_order_items.item_id
      where purchase_order_items.purchase_order_id = purchase_orders.id
    ), '[]'::jsonb)
  )
  from public.purchase_orders
  left join public.vendors on vendors.id = purchase_orders.vendor_id
  where (
      public.is_super_admin()
      or purchase_orders.organization_id = target_organization_id
    )
    and (
      target_item_id is null
      or exists (
        select 1
        from public.purchase_order_items
        where purchase_order_items.purchase_order_id = purchase_orders.id
          and purchase_order_items.item_id = target_item_id
      )
    )
  order by purchase_orders.created_at desc;
end;
$$;

alter table public.product_prices enable row level security;
alter table public.product_price_history enable row level security;
alter table public.inventory_batches enable row level security;

drop policy if exists "Super admins can manage product prices" on public.product_prices;
drop policy if exists "Organization pricing users can view product prices" on public.product_prices;

create policy "Super admins can manage product prices"
on public.product_prices
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization pricing users can view product prices"
on public.product_prices
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('product_pricing', 'view')
);

drop policy if exists "Super admins can manage product price history" on public.product_price_history;
drop policy if exists "Organization pricing users can view product price history" on public.product_price_history;

create policy "Super admins can manage product price history"
on public.product_price_history
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization pricing users can view product price history"
on public.product_price_history
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('product_pricing', 'view')
);

drop policy if exists "Super admins can manage inventory batches" on public.inventory_batches;
drop policy if exists "Organization pricing users can view inventory batches" on public.inventory_batches;

create policy "Super admins can manage inventory batches"
on public.inventory_batches
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization pricing users can view inventory batches"
on public.inventory_batches
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('product_pricing', 'view')
);

drop policy if exists "Organization users can view purchase orders" on public.purchase_orders;
create policy "Organization pricing users can view purchase orders"
on public.purchase_orders
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
  and public.user_has_permission('product_pricing', 'view')
);

drop policy if exists "Organization users can create purchase orders" on public.purchase_orders;
create policy "Organization pricing users can create purchase orders"
on public.purchase_orders
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
  and public.user_has_permission('product_pricing', 'create')
);

drop policy if exists "Organization users can update purchase orders" on public.purchase_orders;
create policy "Organization pricing users can update purchase orders"
on public.purchase_orders
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
  and public.user_has_permission('product_pricing', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
  and public.user_has_permission('product_pricing', 'update')
);

drop policy if exists "Organization users can delete purchase orders" on public.purchase_orders;
create policy "Organization pricing users can delete purchase orders"
on public.purchase_orders
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
  and public.user_has_permission('product_pricing', 'delete')
);

drop policy if exists "Organization users can view purchase order items" on public.purchase_order_items;
create policy "Organization pricing users can view purchase order items"
on public.purchase_order_items
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
  and public.user_has_permission('product_pricing', 'view')
);

drop policy if exists "Organization users can create purchase order items" on public.purchase_order_items;
create policy "Organization pricing users can create purchase order items"
on public.purchase_order_items
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
  and public.user_has_permission('product_pricing', 'create')
);

drop policy if exists "Organization users can update purchase order items" on public.purchase_order_items;
create policy "Organization pricing users can update purchase order items"
on public.purchase_order_items
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
  and public.user_has_permission('product_pricing', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
  and public.user_has_permission('product_pricing', 'update')
);

drop policy if exists "Organization users can delete purchase order items" on public.purchase_order_items;
create policy "Organization pricing users can delete purchase order items"
on public.purchase_order_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
  and public.user_has_permission('product_pricing', 'delete')
);

grant execute on function public.current_user_profile_id() to authenticated;
grant execute on function public.current_user_company_id() to authenticated;
grant execute on function public.update_product_price(uuid, numeric, numeric, numeric, date) to authenticated;
grant execute on function public.receive_purchase_order_items(uuid, jsonb, text, date, text) to authenticated;
grant execute on function public.receive_purchase_order(uuid) to authenticated;
grant execute on function public.inventory_batch_history(uuid) to authenticated;
grant execute on function public.purchase_order_public_rows(uuid) to authenticated;

revoke execute on function public.set_product_price_defaults() from public, authenticated;
revoke execute on function public.set_product_price_history_defaults() from public, authenticated;
revoke execute on function public.set_inventory_batch_defaults() from public, authenticated;

notify pgrst, 'reload schema';
