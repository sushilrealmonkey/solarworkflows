-- Step 29 purchase tracking foundation.
-- Adds organization-scoped purchase orders and line items, with receiving
-- wired into the inventory stock ledger.

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_code text,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  order_date date default current_date,
  expected_delivery_date date,
  status text default 'draft',
  subtotal numeric default 0,
  gst_amount numeric default 0,
  total_amount numeric default 0,
  notes text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.purchase_orders add column if not exists id uuid default gen_random_uuid();
alter table public.purchase_orders add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.purchase_orders add column if not exists purchase_code text;
alter table public.purchase_orders add column if not exists vendor_id uuid references public.vendors(id) on delete restrict;
alter table public.purchase_orders add column if not exists order_date date default current_date;
alter table public.purchase_orders add column if not exists expected_delivery_date date;
alter table public.purchase_orders add column if not exists status text default 'draft';
alter table public.purchase_orders add column if not exists subtotal numeric default 0;
alter table public.purchase_orders add column if not exists gst_amount numeric default 0;
alter table public.purchase_orders add column if not exists total_amount numeric default 0;
alter table public.purchase_orders add column if not exists notes text;
alter table public.purchase_orders add column if not exists created_by uuid references public.users_profile(id);
alter table public.purchase_orders add column if not exists created_at timestamptz default now();
alter table public.purchase_orders add column if not exists updated_at timestamptz default now();

alter table public.purchase_orders alter column id set default gen_random_uuid();
alter table public.purchase_orders alter column organization_id set not null;
alter table public.purchase_orders alter column vendor_id set not null;
alter table public.purchase_orders alter column order_date set default current_date;
alter table public.purchase_orders alter column status set default 'draft';
alter table public.purchase_orders alter column subtotal set default 0;
alter table public.purchase_orders alter column gst_amount set default 0;
alter table public.purchase_orders alter column total_amount set default 0;
alter table public.purchase_orders alter column created_at set default now();
alter table public.purchase_orders alter column updated_at set default now();

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric not null,
  unit_price numeric default 0,
  gst_percent numeric default 0,
  line_total numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.purchase_order_items add column if not exists id uuid default gen_random_uuid();
alter table public.purchase_order_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.purchase_order_items add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete cascade;
alter table public.purchase_order_items add column if not exists item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.purchase_order_items add column if not exists quantity numeric;
alter table public.purchase_order_items add column if not exists unit_price numeric default 0;
alter table public.purchase_order_items add column if not exists gst_percent numeric default 0;
alter table public.purchase_order_items add column if not exists line_total numeric default 0;
alter table public.purchase_order_items add column if not exists created_at timestamptz default now();
alter table public.purchase_order_items add column if not exists updated_at timestamptz default now();

alter table public.purchase_order_items alter column id set default gen_random_uuid();
alter table public.purchase_order_items alter column organization_id set not null;
alter table public.purchase_order_items alter column purchase_order_id set not null;
alter table public.purchase_order_items alter column item_id set not null;
alter table public.purchase_order_items alter column quantity set not null;
alter table public.purchase_order_items alter column unit_price set default 0;
alter table public.purchase_order_items alter column gst_percent set default 0;
alter table public.purchase_order_items alter column line_total set default 0;
alter table public.purchase_order_items alter column created_at set default now();
alter table public.purchase_order_items alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_status_check'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
    add constraint purchase_orders_status_check
    check (status in ('draft', 'ordered', 'received', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_amounts_nonnegative_check'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
    add constraint purchase_orders_amounts_nonnegative_check
    check (subtotal >= 0 and gst_amount >= 0 and total_amount >= 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_order_items_numbers_check'
      and conrelid = 'public.purchase_order_items'::regclass
  ) then
    alter table public.purchase_order_items
    add constraint purchase_order_items_numbers_check
    check (
      quantity > 0
      and unit_price >= 0
      and gst_percent >= 0
      and line_total >= 0
    );
  end if;
end;
$$;

create unique index if not exists purchase_orders_organization_purchase_code_unique
on public.purchase_orders (organization_id, purchase_code)
where purchase_code is not null;

create index if not exists purchase_orders_organization_id_idx
on public.purchase_orders (organization_id);

create index if not exists purchase_orders_vendor_id_idx
on public.purchase_orders (vendor_id);

create index if not exists purchase_orders_status_idx
on public.purchase_orders (status);

create index if not exists purchase_orders_order_date_idx
on public.purchase_orders (order_date);

create index if not exists purchase_order_items_organization_id_idx
on public.purchase_order_items (organization_id);

create index if not exists purchase_order_items_purchase_order_id_idx
on public.purchase_order_items (purchase_order_id);

create index if not exists purchase_order_items_item_id_idx
on public.purchase_order_items (item_id);

create or replace function public.generate_purchase_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a purchase code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('purchase_order:' || target_organization_id::text, 0));

  select coalesce(max(substring(purchase_orders.purchase_code from '^PO-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.purchase_orders
  where purchase_orders.organization_id = target_organization_id
    and purchase_orders.purchase_code ~ '^PO-[0-9]+$';

  return 'PO-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.set_purchase_order_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.purchase_code is null or trim(new.purchase_code) = '' then
    new.purchase_code := public.generate_purchase_code(new.organization_id);
  end if;

  new.order_date := coalesce(new.order_date, current_date);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');
  new.subtotal := coalesce(new.subtotal, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);

  if not exists (
    select 1
    from public.vendors
    where vendors.id = new.vendor_id
      and vendors.organization_id = new.organization_id
  ) then
    raise exception 'vendor_id must belong to the same organization as the purchase order'
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
    raise exception 'created_by must belong to the same organization as the purchase order'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.set_purchase_order_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_organization_id uuid;
begin
  select purchase_orders.organization_id
  into order_organization_id
  from public.purchase_orders
  where purchase_orders.id = new.purchase_order_id;

  if order_organization_id is null then
    raise exception 'purchase_order_id must reference an existing purchase order'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := order_organization_id;
  end if;

  if new.organization_id <> order_organization_id then
    raise exception 'purchase order item organization_id must match purchase order'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.inventory_items
    where inventory_items.id = new.item_id
      and inventory_items.organization_id = new.organization_id
  ) then
    raise exception 'item_id must belong to the same organization as the purchase order'
      using errcode = '23503';
  end if;

  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.line_total := round((new.quantity * new.unit_price) * (1 + (new.gst_percent / 100)), 2);

  return new;
end;
$$;

create or replace function public.recalculate_purchase_order_totals(target_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchase_orders
  set
    subtotal = coalesce(item_totals.subtotal, 0),
    gst_amount = coalesce(item_totals.gst_amount, 0),
    total_amount = coalesce(item_totals.total_amount, 0)
  from (
    select
      purchase_order_items.purchase_order_id,
      round(sum(purchase_order_items.quantity * purchase_order_items.unit_price), 2) as subtotal,
      round(sum((purchase_order_items.quantity * purchase_order_items.unit_price) * (purchase_order_items.gst_percent / 100)), 2) as gst_amount,
      round(sum(purchase_order_items.line_total), 2) as total_amount
    from public.purchase_order_items
    where purchase_order_items.purchase_order_id = target_purchase_order_id
    group by purchase_order_items.purchase_order_id
  ) item_totals
  where purchase_orders.id = target_purchase_order_id
    and item_totals.purchase_order_id = purchase_orders.id;

  if not found then
    update public.purchase_orders
    set subtotal = 0, gst_amount = 0, total_amount = 0
    where purchase_orders.id = target_purchase_order_id;
  end if;
end;
$$;

create or replace function public.update_purchase_order_totals_from_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_purchase_order_totals(coalesce(new.purchase_order_id, old.purchase_order_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists set_purchase_orders_defaults on public.purchase_orders;

create trigger set_purchase_orders_defaults
before insert or update on public.purchase_orders
for each row
execute function public.set_purchase_order_defaults();

drop trigger if exists set_purchase_orders_updated_at on public.purchase_orders;

create trigger set_purchase_orders_updated_at
before update on public.purchase_orders
for each row
execute function public.set_updated_at();

drop trigger if exists set_purchase_order_items_defaults on public.purchase_order_items;

create trigger set_purchase_order_items_defaults
before insert or update on public.purchase_order_items
for each row
execute function public.set_purchase_order_item_defaults();

drop trigger if exists set_purchase_order_items_updated_at on public.purchase_order_items;

create trigger set_purchase_order_items_updated_at
before update on public.purchase_order_items
for each row
execute function public.set_updated_at();

drop trigger if exists recalculate_purchase_order_totals_after_item_change on public.purchase_order_items;

create trigger recalculate_purchase_order_totals_after_item_change
after insert or update or delete on public.purchase_order_items
for each row
execute function public.update_purchase_order_totals_from_item();

create or replace function public.receive_purchase_order(target_purchase_order_id uuid)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.purchase_orders%rowtype;
  item_record public.purchase_order_items%rowtype;
  current_profile_id uuid;
begin
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

  if not exists (
    select 1
    from public.purchase_order_items
    where purchase_order_items.purchase_order_id = order_record.id
  ) then
    raise exception 'Purchase order must have at least one item before receiving'
      using errcode = '23514';
  end if;

  if not public.is_super_admin() then
    if order_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot receive purchase orders for another organization'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('inventory', 'create')
    ) then
      raise exception 'Missing inventory create/update permission'
        using errcode = '42501';
    end if;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  for item_record in
    select *
    from public.purchase_order_items
    where purchase_order_items.purchase_order_id = order_record.id
  loop
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
      item_record.organization_id,
      item_record.item_id,
      'stock_in',
      item_record.quantity,
      current_date,
      'purchase_order',
      order_record.id,
      'Received from purchase order ' || coalesce(order_record.purchase_code, order_record.id::text),
      current_profile_id
    );
  end loop;

  update public.purchase_orders
  set status = 'received'
  where purchase_orders.id = order_record.id
  returning * into order_record;

  return order_record;
end;
$$;

grant execute on function public.receive_purchase_order(uuid) to authenticated;

create or replace function public.purchase_vendor_options()
returns table (
  id uuid,
  vendor_code text,
  vendor_name text,
  contact_person text,
  phone text
)
language sql
security definer
set search_path = public
as $$
  select
    vendors.id,
    vendors.vendor_code,
    vendors.vendor_name,
    vendors.contact_person,
    vendors.phone
  from public.vendors
  where (
      public.is_super_admin()
      or (
        vendors.organization_id = public.current_user_organization_id()
        and public.user_has_permission('inventory', 'view')
      )
    )
    and vendors.status = 'active'
  order by vendors.vendor_name;
$$;

grant execute on function public.purchase_vendor_options() to authenticated;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists "Super admins can manage purchase orders" on public.purchase_orders;
drop policy if exists "Organization users can view purchase orders" on public.purchase_orders;
drop policy if exists "Organization users can create purchase orders" on public.purchase_orders;
drop policy if exists "Organization users can update purchase orders" on public.purchase_orders;
drop policy if exists "Organization users can delete purchase orders" on public.purchase_orders;

create policy "Super admins can manage purchase orders"
on public.purchase_orders
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view purchase orders"
on public.purchase_orders
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create purchase orders"
on public.purchase_orders
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update purchase orders"
on public.purchase_orders
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

create policy "Organization users can delete purchase orders"
on public.purchase_orders
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

drop policy if exists "Super admins can manage purchase order items" on public.purchase_order_items;
drop policy if exists "Organization users can view purchase order items" on public.purchase_order_items;
drop policy if exists "Organization users can create purchase order items" on public.purchase_order_items;
drop policy if exists "Organization users can update purchase order items" on public.purchase_order_items;
drop policy if exists "Organization users can delete purchase order items" on public.purchase_order_items;

create policy "Super admins can manage purchase order items"
on public.purchase_order_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view purchase order items"
on public.purchase_order_items
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'view')
);

create policy "Organization users can create purchase order items"
on public.purchase_order_items
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'create')
);

create policy "Organization users can update purchase order items"
on public.purchase_order_items
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

create policy "Organization users can delete purchase order items"
on public.purchase_order_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);
