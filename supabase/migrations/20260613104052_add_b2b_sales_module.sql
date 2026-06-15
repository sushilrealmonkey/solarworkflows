-- Dedicated B2B product sales for project-free product/bulk sales to installers.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'b2b_sales',
  'B2B Sales',
  'Project-free product sales to installer customers',
  365,
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
where modules.module_key = 'b2b_sales'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where modules.module_key = 'b2b_sales'
  and (
    coalesce(roles.is_system_role, false) = true
    or lower(btrim(roles.role_name)) = 'admin'
  )
on conflict (role_id, permission_id) do nothing;

alter table public.customers
add column if not exists business_name text,
add column if not exists gst_number text,
add column if not exists contact_person_name text;

alter table public.customers
drop constraint if exists customers_customer_type_check;

alter table public.customers
add constraint customers_customer_type_check
check (
  customer_type in (
    'residential',
    'commercial',
    'industrial',
    'government',
    'b2b_installer',
    'other'
  )
);

create table if not exists public.b2b_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_code text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  sale_date date default current_date,
  dispatch_date date,
  status text not null default 'draft',
  base_amount numeric not null default 0,
  gst_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  total_amount numeric not null default 0,
  notes text,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.b2b_sales add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.b2b_sales add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.b2b_sales add column if not exists sale_code text;
alter table public.b2b_sales add column if not exists customer_id uuid references public.customers(id) on delete restrict;
alter table public.b2b_sales add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
alter table public.b2b_sales add column if not exists sale_date date default current_date;
alter table public.b2b_sales add column if not exists dispatch_date date;
alter table public.b2b_sales add column if not exists status text default 'draft';
alter table public.b2b_sales add column if not exists base_amount numeric default 0;
alter table public.b2b_sales add column if not exists gst_amount numeric default 0;
alter table public.b2b_sales add column if not exists discount_amount numeric default 0;
alter table public.b2b_sales add column if not exists total_amount numeric default 0;
alter table public.b2b_sales add column if not exists notes text;
alter table public.b2b_sales add column if not exists created_by uuid references public.users_profile(id) on delete set null;
alter table public.b2b_sales add column if not exists created_at timestamptz default now();
alter table public.b2b_sales add column if not exists updated_at timestamptz default now();

alter table public.b2b_sales alter column id set default gen_random_uuid();
alter table public.b2b_sales alter column company_id set not null;
alter table public.b2b_sales alter column organization_id set not null;
alter table public.b2b_sales alter column customer_id set not null;
alter table public.b2b_sales alter column sale_date set default current_date;
alter table public.b2b_sales alter column status set not null;
alter table public.b2b_sales alter column status set default 'draft';
alter table public.b2b_sales alter column base_amount set not null;
alter table public.b2b_sales alter column base_amount set default 0;
alter table public.b2b_sales alter column gst_amount set not null;
alter table public.b2b_sales alter column gst_amount set default 0;
alter table public.b2b_sales alter column discount_amount set not null;
alter table public.b2b_sales alter column discount_amount set default 0;
alter table public.b2b_sales alter column total_amount set not null;
alter table public.b2b_sales alter column total_amount set default 0;
alter table public.b2b_sales alter column created_at set not null;
alter table public.b2b_sales alter column created_at set default now();
alter table public.b2b_sales alter column updated_at set not null;
alter table public.b2b_sales alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'b2b_sales_status_check'
      and conrelid = 'public.b2b_sales'::regclass
  ) then
    alter table public.b2b_sales
    add constraint b2b_sales_status_check
    check (status in ('draft', 'confirmed', 'dispatched', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'b2b_sales_amounts_nonnegative_check'
      and conrelid = 'public.b2b_sales'::regclass
  ) then
    alter table public.b2b_sales
    add constraint b2b_sales_amounts_nonnegative_check
    check (
      base_amount >= 0
      and gst_amount >= 0
      and discount_amount >= 0
      and total_amount >= 0
    );
  end if;
end;
$$;

create table if not exists public.b2b_sale_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  b2b_sale_id uuid not null references public.b2b_sales(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  item_name text not null,
  description text,
  quantity numeric not null default 1,
  unit text,
  unit_price numeric not null default 0,
  gst_percent numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.b2b_sale_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.b2b_sale_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.b2b_sale_items add column if not exists b2b_sale_id uuid references public.b2b_sales(id) on delete cascade;
alter table public.b2b_sale_items add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.b2b_sale_items add column if not exists item_name text;
alter table public.b2b_sale_items add column if not exists description text;
alter table public.b2b_sale_items add column if not exists quantity numeric default 1;
alter table public.b2b_sale_items add column if not exists unit text;
alter table public.b2b_sale_items add column if not exists unit_price numeric default 0;
alter table public.b2b_sale_items add column if not exists gst_percent numeric default 0;
alter table public.b2b_sale_items add column if not exists line_total numeric default 0;
alter table public.b2b_sale_items add column if not exists sort_order integer default 0;
alter table public.b2b_sale_items add column if not exists created_at timestamptz default now();
alter table public.b2b_sale_items add column if not exists updated_at timestamptz default now();

alter table public.b2b_sale_items alter column id set default gen_random_uuid();
alter table public.b2b_sale_items alter column company_id set not null;
alter table public.b2b_sale_items alter column organization_id set not null;
alter table public.b2b_sale_items alter column b2b_sale_id set not null;
alter table public.b2b_sale_items alter column inventory_item_id set not null;
alter table public.b2b_sale_items alter column item_name set not null;
alter table public.b2b_sale_items alter column quantity set not null;
alter table public.b2b_sale_items alter column quantity set default 1;
alter table public.b2b_sale_items alter column unit_price set not null;
alter table public.b2b_sale_items alter column unit_price set default 0;
alter table public.b2b_sale_items alter column gst_percent set not null;
alter table public.b2b_sale_items alter column gst_percent set default 0;
alter table public.b2b_sale_items alter column line_total set not null;
alter table public.b2b_sale_items alter column line_total set default 0;
alter table public.b2b_sale_items alter column sort_order set not null;
alter table public.b2b_sale_items alter column sort_order set default 0;
alter table public.b2b_sale_items alter column created_at set not null;
alter table public.b2b_sale_items alter column created_at set default now();
alter table public.b2b_sale_items alter column updated_at set not null;
alter table public.b2b_sale_items alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'b2b_sale_items_amounts_nonnegative_check'
      and conrelid = 'public.b2b_sale_items'::regclass
  ) then
    alter table public.b2b_sale_items
    add constraint b2b_sale_items_amounts_nonnegative_check
    check (
      quantity > 0
      and unit_price >= 0
      and gst_percent >= 0
      and line_total >= 0
      and sort_order >= 0
    );
  end if;
end;
$$;

create unique index if not exists b2b_sales_company_sale_code_unique
on public.b2b_sales (company_id, sale_code)
where sale_code is not null;

create index if not exists b2b_sales_company_id_idx on public.b2b_sales (company_id);
create index if not exists b2b_sales_organization_id_idx on public.b2b_sales (organization_id);
create index if not exists b2b_sales_customer_id_idx on public.b2b_sales (customer_id);
create index if not exists b2b_sales_invoice_id_idx on public.b2b_sales (invoice_id) where invoice_id is not null;
create index if not exists b2b_sales_status_idx on public.b2b_sales (organization_id, status);
create index if not exists b2b_sales_sale_date_idx on public.b2b_sales (sale_date);

create index if not exists b2b_sale_items_company_id_idx on public.b2b_sale_items (company_id);
create index if not exists b2b_sale_items_organization_id_idx on public.b2b_sale_items (organization_id);
create index if not exists b2b_sale_items_b2b_sale_id_idx on public.b2b_sale_items (b2b_sale_id);
create index if not exists b2b_sale_items_inventory_item_id_idx on public.b2b_sale_items (inventory_item_id);

alter table public.invoices
add column if not exists b2b_sale_id uuid references public.b2b_sales(id) on delete set null;

create index if not exists invoices_b2b_sale_id_idx
on public.invoices (b2b_sale_id)
where b2b_sale_id is not null;

alter table public.payments
alter column project_id drop not null;

alter table public.payments
add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
add column if not exists b2b_sale_id uuid references public.b2b_sales(id) on delete set null;

create index if not exists payments_invoice_id_idx
on public.payments (invoice_id)
where invoice_id is not null;

create index if not exists payments_b2b_sale_id_idx
on public.payments (b2b_sale_id)
where b2b_sale_id is not null;

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
  limit 1;
$$;

create or replace function public.generate_b2b_sale_code(target_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_company_id is null then
    raise exception 'company_id is required to generate a B2B sale code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('b2b_sale:' || target_company_id::text, 0));

  select coalesce(max(substring(b2b_sales.sale_code from '^B2B-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.b2b_sales
  where b2b_sales.company_id = target_company_id
    and b2b_sales.sale_code ~ '^B2B-[0-9]+$';

  return 'B2B-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.set_b2b_sale_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.users_profile%rowtype;
begin
  select *
  into current_profile
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if new.company_id is null then
    new.company_id := current_profile.company_id;
  end if;

  if new.organization_id is null then
    new.organization_id := current_profile.organization_id;
  end if;

  if new.company_id is null then
    raise exception 'company_id is required for B2B sales'
      using errcode = '23502';
  end if;

  if new.organization_id is null then
    raise exception 'organization_id is required for B2B sales'
      using errcode = '23502';
  end if;

  if new.sale_code is null or trim(new.sale_code) = '' then
    new.sale_code := public.generate_b2b_sale_code(new.company_id);
  end if;

  new.sale_date := coalesce(new.sale_date, current_date);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');
  new.base_amount := coalesce(new.base_amount, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  if new.invoice_id is not null and not exists (
    select 1
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id
      and invoices.customer_id = new.customer_id
  ) then
    raise exception 'invoice_id must belong to the same organization and customer as the B2B sale'
      using errcode = '23503';
  end if;

  if new.created_by is null then
    new.created_by := current_profile.id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.set_b2b_sale_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  item_record public.inventory_items%rowtype;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = new.b2b_sale_id;

  if not found then
    raise exception 'b2b_sale_id must reference an existing B2B sale'
      using errcode = '23503';
  end if;

  if sale_record.status in ('dispatched', 'cancelled') then
    raise exception 'Items cannot be changed after a B2B sale is dispatched or cancelled'
      using errcode = '23514';
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = new.inventory_item_id;

  if not found then
    raise exception 'inventory_item_id must reference an existing inventory item'
      using errcode = '23503';
  end if;

  if item_record.organization_id <> sale_record.organization_id then
    raise exception 'inventory_item_id must belong to the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  new.company_id := sale_record.company_id;
  new.organization_id := sale_record.organization_id;
  new.item_name := coalesce(nullif(trim(new.item_name), ''), item_record.item_name);
  new.unit := coalesce(nullif(trim(new.unit), ''), item_record.unit);
  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, item_record.gst_percent, 0);
  new.line_total := new.quantity * new.unit_price;
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

create or replace function public.refresh_b2b_sale_totals_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_sale_id uuid;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  current_discount_amount numeric;
begin
  target_sale_id := coalesce(new.b2b_sale_id, old.b2b_sale_id);

  select
    coalesce(sum(b2b_sale_items.line_total), 0),
    coalesce(sum(b2b_sale_items.line_total * coalesce(b2b_sale_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = target_sale_id;

  select coalesce(b2b_sales.discount_amount, 0)
  into current_discount_amount
  from public.b2b_sales
  where b2b_sales.id = target_sale_id;

  update public.b2b_sales
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = greatest(calculated_base_amount + calculated_gst_amount - current_discount_amount, 0),
    updated_at = now()
  where b2b_sales.id = target_sale_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.recalculate_b2b_sale_totals(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not (
        public.user_has_permission('b2b_sales', 'create')
        or public.user_has_permission('b2b_sales', 'update')
      )
    ) then
    raise exception 'Missing permission to recalculate B2B sale totals'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(b2b_sale_items.line_total), 0),
    coalesce(sum(b2b_sale_items.line_total * coalesce(b2b_sale_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = target_sale_id
    and b2b_sale_items.organization_id = sale_record.organization_id;

  update public.b2b_sales
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = greatest(calculated_base_amount + calculated_gst_amount - coalesce(discount_amount, 0), 0),
    updated_at = now()
  where b2b_sales.id = target_sale_id
  returning * into sale_record;

  return sale_record;
end;
$$;

create or replace function public.set_b2b_sale_discount_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := greatest(
    coalesce(new.base_amount, 0) + coalesce(new.gst_amount, 0) - new.discount_amount,
    0
  );
  return new;
end;
$$;

create or replace function public.confirm_b2b_sale(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status not in ('draft', 'confirmed') then
    raise exception 'Only draft B2B sales can be confirmed'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('b2b_sales', 'update')
    ) then
    raise exception 'Missing permission to confirm B2B sale'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
  ) then
    raise exception 'Add at least one item before confirming a B2B sale'
      using errcode = '23514';
  end if;

  update public.b2b_sales
  set status = 'confirmed', updated_at = now()
  where b2b_sales.id = target_sale_id
  returning * into sale_record;

  return sale_record;
end;
$$;

create or replace function public.cancel_b2b_sale(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'dispatched' then
    raise exception 'Dispatched B2B sales cannot be cancelled'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('b2b_sales', 'update')
    ) then
    raise exception 'Missing permission to cancel B2B sale'
      using errcode = '42501';
  end if;

  update public.b2b_sales
  set status = 'cancelled', updated_at = now()
  where b2b_sales.id = target_sale_id
  returning * into sale_record;

  return sale_record;
end;
$$;

create or replace function public.dispatch_b2b_sale(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  current_profile_id uuid;
  stock_warning text;
  inserted_count integer := 0;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'dispatched' then
    raise exception 'B2B sale is already dispatched'
      using errcode = '23514';
  end if;

  if sale_record.status <> 'confirmed' then
    raise exception 'Confirm the B2B sale before dispatch'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('b2b_sales', 'update')
      or not (
        public.user_has_permission('inventory', 'create')
        or public.user_has_permission('inventory', 'update')
      )
    ) then
    raise exception 'Missing permission to dispatch B2B sale'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.inventory_transactions
    where inventory_transactions.reference_type = 'b2b_sale'
      and inventory_transactions.reference_id = sale_record.id
      and inventory_transactions.transaction_type = 'stock_out'
  ) then
    raise exception 'Stock out has already been recorded for this B2B sale'
      using errcode = '23514';
  end if;

  select string_agg(
    format(
      '%s needs %s%s but only %s%s is available',
      coalesce(b2b_sale_items.item_name, inventory_items.item_name, 'Inventory item'),
      b2b_sale_items.quantity,
      coalesce(' ' || nullif(b2b_sale_items.unit, ''), ''),
      public.inventory_item_available_quantity(inventory_items.id, null),
      coalesce(' ' || nullif(inventory_items.unit, ''), '')
    ),
    E'\n'
  )
  into stock_warning
  from public.b2b_sale_items
  join public.inventory_items on inventory_items.id = b2b_sale_items.inventory_item_id
  where b2b_sale_items.b2b_sale_id = sale_record.id
    and b2b_sale_items.organization_id = sale_record.organization_id
    and public.inventory_item_available_quantity(inventory_items.id, null) < b2b_sale_items.quantity;

  if stock_warning is not null then
    raise exception 'Out of stock warning:% % B2B dispatch was not recorded.',
      E'\n' || stock_warning,
      E'\n'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.inventory_transactions (
    organization_id,
    item_id,
    project_id,
    transaction_type,
    quantity,
    transaction_date,
    reference_type,
    reference_id,
    notes,
    created_by
  )
  select
    sale_record.organization_id,
    b2b_sale_items.inventory_item_id,
    null,
    'stock_out',
    b2b_sale_items.quantity,
    current_date,
    'b2b_sale',
    sale_record.id,
    'B2B sale dispatch: ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = sale_record.id
    and b2b_sale_items.organization_id = sale_record.organization_id;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    raise exception 'Add at least one item before dispatching a B2B sale'
      using errcode = '23514';
  end if;

  update public.b2b_sales
  set
    status = 'dispatched',
    dispatch_date = coalesce(dispatch_date, current_date),
    updated_at = now()
  where b2b_sales.id = sale_record.id
  returning * into sale_record;

  return sale_record;
end;
$$;

create or replace function public.set_invoice_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.invoice_code is null or trim(new.invoice_code) = '' then
    new.invoice_code := public.generate_invoice_code(new.organization_id);
  end if;

  new.invoice_date := coalesce(new.invoice_date, current_date);
  new.base_amount := coalesce(new.base_amount, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);
  new.amount_paid := coalesce(new.amount_paid, 0);
  new.balance_due := coalesce(new.balance_due, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and projects.customer_id = new.customer_id
  ) then
    raise exception 'project_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
      and quotations.customer_id = new.customer_id
  ) then
    raise exception 'quotation_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.b2b_sale_id is not null and not exists (
    select 1
    from public.b2b_sales
    where b2b_sales.id = new.b2b_sale_id
      and b2b_sales.organization_id = new.organization_id
      and b2b_sales.customer_id = new.customer_id
  ) then
    raise exception 'b2b_sale_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and new.b2b_sale_id is not null then
    raise exception 'An invoice cannot be linked to both a project and a B2B sale'
      using errcode = '23514';
  end if;

  if new.project_id is not null
    and new.quotation_id is not null
    and not exists (
      select 1
      from public.projects
      where projects.id = new.project_id
        and projects.quotation_id = new.quotation_id
    ) then
    raise exception 'quotation_id must match the linked project quotation when both are provided'
      using errcode = '23503';
  end if;

  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the invoice'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.recalculate_invoice_totals(target_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  calculated_total_amount numeric;
  calculated_amount_paid numeric;
  calculated_balance_due numeric;
  next_status text;
begin
  select *
  into invoice_record
  from public.invoices
  where invoices.id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if invoice_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate an invoice from another organization'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('invoices', 'update')
      or public.user_has_permission('invoices', 'create')
      or (
        invoice_record.project_id is null
        and (
          public.user_has_permission('payments', 'create')
          or public.user_has_permission('payments', 'update')
          or public.user_has_permission('payments', 'delete')
        )
      )
    ) then
      raise exception 'Missing invoices update permission'
        using errcode = '42501';
    end if;
  end if;

  select
    coalesce(sum(invoice_items.line_total), 0),
    coalesce(sum(invoice_items.line_total * coalesce(invoice_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.invoice_items
  where invoice_items.invoice_id = target_invoice_id
    and invoice_items.organization_id = invoice_record.organization_id;

  calculated_total_amount := greatest(
    calculated_base_amount
      + calculated_gst_amount
      - coalesce(invoice_record.discount_amount, 0),
    0
  );

  if invoice_record.project_id is not null then
    select coalesce(sum(payments.amount), 0)
    into calculated_amount_paid
    from public.payments
    where payments.project_id = invoice_record.project_id
      and payments.organization_id = invoice_record.organization_id
      and payments.status = 'received';
  else
    select coalesce(sum(payments.amount), 0)
    into calculated_amount_paid
    from public.payments
    where payments.invoice_id = invoice_record.id
      and payments.organization_id = invoice_record.organization_id
      and payments.status = 'received';
  end if;

  calculated_balance_due := greatest(calculated_total_amount - calculated_amount_paid, 0);

  next_status := case
    when invoice_record.status = 'cancelled' then 'cancelled'
    when calculated_total_amount > 0 and calculated_balance_due <= 0 then 'paid'
    when calculated_amount_paid > 0 and calculated_balance_due > 0 then 'partially_paid'
    when invoice_record.status = 'draft' then 'draft'
    when invoice_record.due_date is not null
      and invoice_record.due_date < current_date
      and calculated_balance_due > 0 then 'overdue'
    else 'sent'
  end;

  update public.invoices
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = calculated_total_amount,
    amount_paid = calculated_amount_paid,
    balance_due = calculated_balance_due,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(public.invoices.paid_at, now())
      when next_status in ('partially_paid', 'sent', 'overdue', 'draft') then null
      else public.invoices.paid_at
    end,
    updated_at = now()
  where invoices.id = target_invoice_id
  returning * into invoice_record;

  return invoice_record;
end;
$$;

create or replace function public.create_invoice_from_b2b_sale(target_sale_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  invoice_record public.invoices%rowtype;
  current_profile_id uuid;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'cancelled' then
    raise exception 'Cancelled B2B sales cannot be invoiced'
      using errcode = '23514';
  end if;

  if sale_record.invoice_id is not null then
    select *
    into invoice_record
    from public.invoices
    where invoices.id = sale_record.invoice_id;

    if found then
      return invoice_record;
    end if;
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
      or not public.user_has_permission('b2b_sales', 'view')
    ) then
    raise exception 'Missing permission to create invoice from B2B sale'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
  ) then
    raise exception 'Add at least one item before creating a B2B invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.invoices (
    organization_id,
    customer_id,
    project_id,
    quotation_id,
    b2b_sale_id,
    invoice_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    sale_record.organization_id,
    sale_record.customer_id,
    null,
    null,
    sale_record.id,
    current_date,
    sale_record.discount_amount,
    'draft',
    'Invoice generated from B2B sale ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  )
  returning * into invoice_record;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    sort_order
  )
  select
    sale_record.organization_id,
    invoice_record.id,
    b2b_sale_items.inventory_item_id,
    b2b_sale_items.item_name,
    b2b_sale_items.description,
    b2b_sale_items.quantity,
    b2b_sale_items.unit,
    b2b_sale_items.unit_price,
    b2b_sale_items.gst_percent,
    b2b_sale_items.sort_order
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = sale_record.id
  order by b2b_sale_items.sort_order, b2b_sale_items.created_at;

  update public.b2b_sales
  set invoice_id = invoice_record.id, updated_at = now()
  where b2b_sales.id = sale_record.id;

  update public.invoices
  set b2b_sale_id = sale_record.id, updated_at = now()
  where invoices.id = invoice_record.id;

  return public.recalculate_invoice_totals(invoice_record.id);
end;
$$;

create or replace function public.set_payment_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  resolved_customer_id uuid;
  resolved_quotation_id uuid;
  resolved_invoice_id uuid;
  resolved_b2b_sale_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.project_id is null and new.invoice_id is null and new.b2b_sale_id is null then
    raise exception 'payment must be linked to a project, invoice, or B2B sale'
      using errcode = '23503';
  end if;

  if new.project_id is not null then
    select projects.customer_id, projects.quotation_id
    into resolved_customer_id, resolved_quotation_id
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment project must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        new.quotation_id is not null
        and resolved_quotation_id is distinct from new.quotation_id
      ) then
      raise exception 'payment project, customer, and quotation must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.b2b_sale_id is not null then
    select b2b_sales.customer_id, b2b_sales.invoice_id
    into resolved_customer_id, resolved_invoice_id
    from public.b2b_sales
    where b2b_sales.id = new.b2b_sale_id
      and b2b_sales.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment B2B sale must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.invoice_id is null then
      new.invoice_id := resolved_invoice_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        resolved_invoice_id is not null
        and new.invoice_id is not null
        and new.invoice_id <> resolved_invoice_id
      ) then
      raise exception 'payment B2B sale, invoice, and customer must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.invoice_id is not null then
    select invoices.customer_id, invoices.b2b_sale_id
    into resolved_customer_id, resolved_b2b_sale_id
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment invoice must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.b2b_sale_id is null then
      new.b2b_sale_id := resolved_b2b_sale_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        resolved_b2b_sale_id is not null
        and new.b2b_sale_id is not null
        and new.b2b_sale_id <> resolved_b2b_sale_id
      ) then
      raise exception 'payment invoice, B2B sale, and customer must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.customer_id is null then
    raise exception 'customer_id is required for payments'
      using errcode = '23502';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the payment'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.recalculate_payment_summary_after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.project_id is not null then
    perform public.recalculate_project_payment_summary(new.project_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE')
    and old.project_id is not null
    and (tg_op = 'DELETE' or old.project_id <> new.project_id) then
    perform public.recalculate_project_payment_summary(old.project_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    target_invoice_id := new.invoice_id;
    if target_invoice_id is null and new.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = new.b2b_sale_id;
    end if;

    if target_invoice_id is not null then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    target_invoice_id := old.invoice_id;
    if target_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_invoice_id is not null then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  elsif tg_op = 'UPDATE' then
    target_invoice_id := old.invoice_id;
    if target_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_invoice_id is not null
      and (
        old.invoice_id is distinct from new.invoice_id
        or old.b2b_sale_id is distinct from new.b2b_sale_id
      ) then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists set_b2b_sales_defaults on public.b2b_sales;
create trigger set_b2b_sales_defaults
before insert or update on public.b2b_sales
for each row
execute function public.set_b2b_sale_defaults();

drop trigger if exists set_b2b_sales_discount_total on public.b2b_sales;
create trigger set_b2b_sales_discount_total
before insert or update of base_amount, gst_amount, discount_amount on public.b2b_sales
for each row
execute function public.set_b2b_sale_discount_total();

drop trigger if exists set_b2b_sales_updated_at on public.b2b_sales;
create trigger set_b2b_sales_updated_at
before update on public.b2b_sales
for each row
execute function public.set_updated_at();

drop trigger if exists set_b2b_sale_items_defaults on public.b2b_sale_items;
create trigger set_b2b_sale_items_defaults
before insert or update on public.b2b_sale_items
for each row
execute function public.set_b2b_sale_item_defaults();

drop trigger if exists refresh_b2b_sale_totals_on_items_change on public.b2b_sale_items;
create trigger refresh_b2b_sale_totals_on_items_change
after insert or update or delete on public.b2b_sale_items
for each row
execute function public.refresh_b2b_sale_totals_after_item_change();

drop trigger if exists set_b2b_sale_items_updated_at on public.b2b_sale_items;
create trigger set_b2b_sale_items_updated_at
before update on public.b2b_sale_items
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on public.b2b_sales to authenticated;
grant select, insert, update, delete on public.b2b_sale_items to authenticated;
grant execute on function public.recalculate_b2b_sale_totals(uuid) to authenticated;
grant execute on function public.confirm_b2b_sale(uuid) to authenticated;
grant execute on function public.cancel_b2b_sale(uuid) to authenticated;
grant execute on function public.dispatch_b2b_sale(uuid) to authenticated;
grant execute on function public.create_invoice_from_b2b_sale(uuid) to authenticated;

revoke execute on function public.current_user_profile_id() from public;
revoke execute on function public.generate_b2b_sale_code(uuid) from public, authenticated;
revoke execute on function public.set_b2b_sale_defaults() from public, authenticated;
revoke execute on function public.set_b2b_sale_item_defaults() from public, authenticated;
revoke execute on function public.refresh_b2b_sale_totals_after_item_change() from public, authenticated;
revoke execute on function public.set_b2b_sale_discount_total() from public, authenticated;

alter table public.b2b_sales enable row level security;
alter table public.b2b_sale_items enable row level security;

drop policy if exists "Super admins can manage B2B sales" on public.b2b_sales;
drop policy if exists "Organization users can view B2B sales" on public.b2b_sales;
drop policy if exists "Organization users can create B2B sales" on public.b2b_sales;
drop policy if exists "Organization users can update B2B sales" on public.b2b_sales;
drop policy if exists "Organization users can delete B2B sales" on public.b2b_sales;

create policy "Super admins can manage B2B sales"
on public.b2b_sales
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view B2B sales"
on public.b2b_sales
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'view')
);

create policy "Organization users can create B2B sales"
on public.b2b_sales
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'create')
);

create policy "Organization users can update B2B sales"
on public.b2b_sales
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'update')
)
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'update')
);

create policy "Organization users can delete B2B sales"
on public.b2b_sales
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'delete')
);

drop policy if exists "Super admins can manage B2B sale items" on public.b2b_sale_items;
drop policy if exists "Organization users can view B2B sale items" on public.b2b_sale_items;
drop policy if exists "Organization users can create B2B sale items" on public.b2b_sale_items;
drop policy if exists "Organization users can update B2B sale items" on public.b2b_sale_items;
drop policy if exists "Organization users can delete B2B sale items" on public.b2b_sale_items;

create policy "Super admins can manage B2B sale items"
on public.b2b_sale_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view B2B sale items"
on public.b2b_sale_items
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'view')
);

create policy "Organization users can create B2B sale items"
on public.b2b_sale_items
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'create')
);

create policy "Organization users can update B2B sale items"
on public.b2b_sale_items
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'update')
)
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'update')
);

create policy "Organization users can delete B2B sale items"
on public.b2b_sale_items
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales', 'delete')
);

notify pgrst, 'reload schema';
