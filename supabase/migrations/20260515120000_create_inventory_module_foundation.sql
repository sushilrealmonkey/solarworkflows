-- Step 13 inventory module foundation.
-- Creates the database layer for solar inventory items and stock ledger
-- transactions only. No frontend screens are added here.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_code text,
  item_name text not null,
  item_category text not null,
  brand text,
  model text,
  unit text,
  current_stock numeric default 0,
  minimum_stock numeric default 0,
  purchase_price numeric default 0,
  selling_price numeric default 0,
  gst_percent numeric default 0,
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.inventory_items add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.inventory_items add column if not exists item_code text;
alter table public.inventory_items add column if not exists item_name text;
alter table public.inventory_items add column if not exists item_category text;
alter table public.inventory_items add column if not exists brand text;
alter table public.inventory_items add column if not exists model text;
alter table public.inventory_items add column if not exists unit text;
alter table public.inventory_items add column if not exists current_stock numeric default 0;
alter table public.inventory_items add column if not exists minimum_stock numeric default 0;
alter table public.inventory_items add column if not exists purchase_price numeric default 0;
alter table public.inventory_items add column if not exists selling_price numeric default 0;
alter table public.inventory_items add column if not exists gst_percent numeric default 0;
alter table public.inventory_items add column if not exists status text default 'active';
alter table public.inventory_items add column if not exists notes text;
alter table public.inventory_items add column if not exists created_at timestamptz default now();
alter table public.inventory_items add column if not exists updated_at timestamptz default now();

alter table public.inventory_items alter column id set default gen_random_uuid();
alter table public.inventory_items alter column organization_id set not null;
alter table public.inventory_items alter column item_name set not null;
alter table public.inventory_items alter column item_category set not null;
alter table public.inventory_items alter column current_stock set default 0;
alter table public.inventory_items alter column minimum_stock set default 0;
alter table public.inventory_items alter column purchase_price set default 0;
alter table public.inventory_items alter column selling_price set default 0;
alter table public.inventory_items alter column gst_percent set default 0;
alter table public.inventory_items alter column status set default 'active';
alter table public.inventory_items alter column created_at set default now();
alter table public.inventory_items alter column updated_at set default now();

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  transaction_type text not null,
  quantity numeric not null,
  transaction_date date default current_date,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.inventory_transactions add column if not exists id uuid default gen_random_uuid();
alter table public.inventory_transactions add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.inventory_transactions add column if not exists item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.inventory_transactions add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.inventory_transactions add column if not exists transaction_type text;
alter table public.inventory_transactions add column if not exists quantity numeric;
alter table public.inventory_transactions add column if not exists transaction_date date default current_date;
alter table public.inventory_transactions add column if not exists reference_type text;
alter table public.inventory_transactions add column if not exists reference_id uuid;
alter table public.inventory_transactions add column if not exists notes text;
alter table public.inventory_transactions add column if not exists created_by uuid references public.users_profile(id);
alter table public.inventory_transactions add column if not exists created_at timestamptz default now();
alter table public.inventory_transactions add column if not exists updated_at timestamptz default now();

alter table public.inventory_transactions alter column id set default gen_random_uuid();
alter table public.inventory_transactions alter column organization_id set not null;
alter table public.inventory_transactions alter column item_id set not null;
alter table public.inventory_transactions alter column transaction_type set not null;
alter table public.inventory_transactions alter column quantity set not null;
alter table public.inventory_transactions alter column transaction_date set default current_date;
alter table public.inventory_transactions alter column created_at set default now();
alter table public.inventory_transactions alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_category_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
    add constraint inventory_items_category_check
    check (item_category in (
      'solar_panel',
      'inverter',
      'battery',
      'mounting_structure',
      'cable',
      'connector',
      'meter',
      'safety_equipment',
      'tool',
      'other'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_status_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
    add constraint inventory_items_status_check
    check (status in ('active', 'inactive'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_default_numbers_nonnegative_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
    add constraint inventory_items_default_numbers_nonnegative_check
    check (
      minimum_stock >= 0
      and purchase_price >= 0
      and selling_price >= 0
      and gst_percent >= 0
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_transactions_type_check'
      and conrelid = 'public.inventory_transactions'::regclass
  ) then
    alter table public.inventory_transactions
    add constraint inventory_transactions_type_check
    check (transaction_type in (
      'stock_in',
      'stock_out',
      'adjustment',
      'project_issue',
      'return'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_transactions_quantity_check'
      and conrelid = 'public.inventory_transactions'::regclass
  ) then
    alter table public.inventory_transactions
    add constraint inventory_transactions_quantity_check
    check (
      (
        transaction_type = 'adjustment'
        and quantity <> 0
      )
      or (
        transaction_type <> 'adjustment'
        and quantity > 0
      )
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_transactions_project_issue_project_check'
      and conrelid = 'public.inventory_transactions'::regclass
  ) then
    alter table public.inventory_transactions
    add constraint inventory_transactions_project_issue_project_check
    check (
      transaction_type <> 'project_issue'
      or project_id is not null
    );
  end if;
end;
$$;

create unique index if not exists inventory_items_organization_item_code_unique
on public.inventory_items (organization_id, item_code)
where item_code is not null;

create index if not exists inventory_items_organization_id_idx
on public.inventory_items (organization_id);

create index if not exists inventory_items_item_code_idx
on public.inventory_items (item_code);

create index if not exists inventory_items_item_category_idx
on public.inventory_items (item_category);

create index if not exists inventory_items_status_idx
on public.inventory_items (status);

create index if not exists inventory_transactions_organization_id_idx
on public.inventory_transactions (organization_id);

create index if not exists inventory_transactions_item_id_idx
on public.inventory_transactions (item_id);

create index if not exists inventory_transactions_project_id_idx
on public.inventory_transactions (project_id);

create index if not exists inventory_transactions_transaction_type_idx
on public.inventory_transactions (transaction_type);

create index if not exists inventory_transactions_transaction_date_idx
on public.inventory_transactions (transaction_date);

-- Generates the next item code inside one organization. The advisory lock keeps
-- ITEM-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_inventory_item_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate an inventory item code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory_item:' || target_organization_id::text, 0));

  select coalesce(max(substring(inventory_items.item_code from '^ITEM-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.inventory_items
  where inventory_items.organization_id = target_organization_id
    and inventory_items.item_code ~ '^ITEM-[0-9]+$';

  return 'ITEM-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills item_code and numeric defaults when the application does not provide them.
create or replace function public.set_inventory_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_code is null or trim(new.item_code) = '' then
    new.item_code := public.generate_inventory_item_code(new.organization_id);
  end if;

  new.current_stock := coalesce(new.current_stock, 0);
  new.minimum_stock := coalesce(new.minimum_stock, 0);
  new.purchase_price := coalesce(new.purchase_price, 0);
  new.selling_price := coalesce(new.selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'active');

  return new;
end;
$$;

-- Ensures inventory transactions cannot link items, projects, or users across
-- organizations. created_by is inferred from the authenticated user when possible.
create or replace function public.set_inventory_transaction_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_organization_id uuid;
  current_profile_id uuid;
begin
  select inventory_items.organization_id
  into item_organization_id
  from public.inventory_items
  where inventory_items.id = new.item_id;

  if item_organization_id is null then
    raise exception 'item_id must reference an existing inventory item'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := item_organization_id;
  end if;

  if new.organization_id <> item_organization_id then
    raise exception 'transaction organization_id must match the inventory item organization_id'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
  ) then
    raise exception 'project_id must belong to the same organization as the inventory transaction'
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
    raise exception 'created_by must belong to the same organization as the inventory transaction'
      using errcode = '23503';
  end if;

  new.transaction_date := coalesce(new.transaction_date, current_date);

  return new;
end;
$$;

-- Applies inserted ledger transactions to inventory_items.current_stock.
create or replace function public.apply_inventory_transaction_stock_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_stock numeric;
  stock_delta numeric;
  next_stock numeric;
begin
  select inventory_items.current_stock
  into existing_stock
  from public.inventory_items
  where inventory_items.id = new.item_id
  for update;

  if not found then
    raise exception 'Inventory item not found'
      using errcode = 'P0002';
  end if;

  stock_delta := case new.transaction_type
    when 'stock_in' then new.quantity
    when 'return' then new.quantity
    when 'stock_out' then -new.quantity
    when 'project_issue' then -new.quantity
    when 'adjustment' then new.quantity
    else 0
  end;

  next_stock := coalesce(existing_stock, 0) + stock_delta;

  if next_stock < 0 and new.transaction_type <> 'adjustment' then
    raise exception 'Inventory stock cannot go below zero'
      using errcode = '23514';
  end if;

  update public.inventory_items
  set current_stock = next_stock
  where inventory_items.id = new.item_id;

  return new;
end;
$$;

drop trigger if exists set_inventory_items_defaults on public.inventory_items;

create trigger set_inventory_items_defaults
before insert or update on public.inventory_items
for each row
execute function public.set_inventory_item_defaults();

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;

create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row
execute function public.set_updated_at();

drop trigger if exists set_inventory_transactions_defaults on public.inventory_transactions;

create trigger set_inventory_transactions_defaults
before insert or update on public.inventory_transactions
for each row
execute function public.set_inventory_transaction_defaults();

drop trigger if exists apply_inventory_transaction_stock_change on public.inventory_transactions;

create trigger apply_inventory_transaction_stock_change
after insert on public.inventory_transactions
for each row
execute function public.apply_inventory_transaction_stock_change();

drop trigger if exists set_inventory_transactions_updated_at on public.inventory_transactions;

create trigger set_inventory_transactions_updated_at
before update on public.inventory_transactions
for each row
execute function public.set_updated_at();

-- Issues material to a project by creating a project_issue ledger transaction.
-- The stock reduction is performed by apply_inventory_transaction_stock_change().
create or replace function public.issue_inventory_to_project(
  target_project_id uuid,
  target_item_id uuid,
  issue_quantity numeric,
  issue_notes text default null
)
returns public.inventory_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
  item_record public.inventory_items%rowtype;
  transaction_record public.inventory_transactions%rowtype;
  current_profile_id uuid;
begin
  if issue_quantity is null or issue_quantity <= 0 then
    raise exception 'quantity must be greater than zero'
      using errcode = '23514';
  end if;

  select *
  into project_record
  from public.projects
  where projects.id = target_project_id;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = target_item_id;

  if not found then
    raise exception 'Inventory item not found'
      using errcode = 'P0002';
  end if;

  if project_record.organization_id <> item_record.organization_id then
    raise exception 'Project and inventory item must belong to the same organization'
      using errcode = '23503';
  end if;

  if not public.is_super_admin() then
    if item_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot issue inventory for another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('inventory', 'create') then
      raise exception 'Missing inventory create permission'
        using errcode = '42501';
    end if;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

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
  values (
    item_record.organization_id,
    item_record.id,
    project_record.id,
    'project_issue',
    issue_quantity,
    current_date,
    'project',
    project_record.id,
    issue_notes,
    current_profile_id
  )
  returning * into transaction_record;

  return transaction_record;
end;
$$;

grant execute on function public.issue_inventory_to_project(uuid, uuid, numeric, text) to authenticated;

alter table public.inventory_items enable row level security;
alter table public.inventory_transactions enable row level security;

drop policy if exists "Super admins can manage inventory items" on public.inventory_items;
drop policy if exists "Organization users can view inventory items" on public.inventory_items;
drop policy if exists "Organization users can create inventory items" on public.inventory_items;
drop policy if exists "Organization users can update inventory items" on public.inventory_items;
drop policy if exists "Organization users can delete inventory items" on public.inventory_items;

-- Super admins can read and write every inventory item across every organization.
create policy "Super admins can manage inventory items"
on public.inventory_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view inventory items in their organization with inventory view permission.
create policy "Organization users can view inventory items"
on public.inventory_items
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

-- Organization users can create inventory items only inside their organization with inventory create permission.
create policy "Organization users can create inventory items"
on public.inventory_items
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

-- Organization users can update inventory items only inside their organization with inventory update permission.
create policy "Organization users can update inventory items"
on public.inventory_items
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

-- Inventory item deletion requires explicit inventory delete permission and never crosses organizations.
create policy "Organization users can delete inventory items"
on public.inventory_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

drop policy if exists "Super admins can manage inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can view inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can create inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can update inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can delete inventory transactions" on public.inventory_transactions;

-- Super admins can read and write every inventory transaction across every organization.
create policy "Super admins can manage inventory transactions"
on public.inventory_transactions
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view inventory transactions in their organization with inventory view permission.
create policy "Organization users can view inventory transactions"
on public.inventory_transactions
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

-- Organization users can create inventory transactions only inside their organization with inventory create permission.
create policy "Organization users can create inventory transactions"
on public.inventory_transactions
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

-- Organization users can update inventory transactions only inside their organization with inventory update permission.
create policy "Organization users can update inventory transactions"
on public.inventory_transactions
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

-- Inventory transaction deletion requires explicit inventory delete permission and never crosses organizations.
create policy "Organization users can delete inventory transactions"
on public.inventory_transactions
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);
