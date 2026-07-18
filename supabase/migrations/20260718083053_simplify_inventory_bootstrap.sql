-- Product Master owns inventory identity. Inventory owns stock and stock alerts.
-- Active products automatically receive one active, zero-stock inventory row.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.sync_product_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item_id uuid;
begin
  if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id then
    raise exception 'Product Master records cannot be moved between organizations'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product_inventory:' || new.id::text, 0)
  );

  select inventory_items.id
  into target_item_id
  from public.inventory_items
  where inventory_items.organization_id = new.tenant_id
    and inventory_items.catalog_product_id = new.id
  order by
    (inventory_items.status = 'active') desc,
    (inventory_items.archived_at is null) desc,
    inventory_items.updated_at desc,
    inventory_items.created_at desc
  limit 1
  for update;

  if new.status = 'active' then
    if target_item_id is null then
      insert into public.inventory_items (
        organization_id,
        catalog_product_id,
        current_stock,
        opening_stock,
        minimum_stock,
        status,
        inventory_date
      )
      values (
        new.tenant_id,
        new.id,
        0,
        0,
        coalesce(new.minimum_stock_alert, 0),
        'active',
        current_date
      );
    else
      -- The inventory defaults trigger refreshes the denormalized product
      -- snapshot while this update preserves all stock and history fields.
      update public.inventory_items
      set
        status = 'active',
        archived_at = null,
        archived_by = null,
        archive_reason = null
      where inventory_items.id = target_item_id;
    end if;
  elsif target_item_id is not null then
    update public.inventory_items
    set status = new.status
    where inventory_items.id = target_item_id;
  end if;

  return new;
end;
$$;

revoke execute on function private.sync_product_inventory_item()
from public, anon, authenticated;

drop trigger if exists sync_product_inventory_item on public.products;
create trigger sync_product_inventory_item
after insert or update of
  tenant_id,
  product_name,
  category_id,
  category_type,
  brand,
  model_number,
  specifications,
  unit,
  gst_percent,
  minimum_stock_alert,
  status
on public.products
for each row
execute function private.sync_product_inventory_item();

-- Reuse one existing linked row per product before inserting any missing rows.
with ranked_inventory as (
  select
    inventory_items.id,
    products.status as product_status,
    row_number() over (
      partition by products.id
      order by
        (inventory_items.status = 'active') desc,
        (inventory_items.archived_at is null) desc,
        inventory_items.updated_at desc,
        inventory_items.created_at desc
    ) as item_rank
  from public.products
  join public.inventory_items
    on inventory_items.organization_id = products.tenant_id
   and inventory_items.catalog_product_id = products.id
)
update public.inventory_items
set
  status = ranked_inventory.product_status,
  archived_at = case
    when ranked_inventory.product_status = 'active' then null
    else inventory_items.archived_at
  end,
  archived_by = case
    when ranked_inventory.product_status = 'active' then null
    else inventory_items.archived_by
  end,
  archive_reason = case
    when ranked_inventory.product_status = 'active' then null
    else inventory_items.archive_reason
  end
from ranked_inventory
where inventory_items.id = ranked_inventory.id
  and ranked_inventory.item_rank = 1;

insert into public.inventory_items (
  organization_id,
  catalog_product_id,
  current_stock,
  opening_stock,
  minimum_stock,
  status,
  inventory_date
)
select
  products.tenant_id,
  products.id,
  0,
  0,
  coalesce(products.minimum_stock_alert, 0),
  'active',
  current_date
from public.products
where products.status = 'active'
  and not exists (
    select 1
    from public.inventory_items
    where inventory_items.organization_id = products.tenant_id
      and inventory_items.catalog_product_id = products.id
      and inventory_items.status = 'active'
  );

create or replace function public.inventory_opening_balance_candidates()
returns table (
  inventory_item_id uuid,
  product_id uuid,
  item_code text,
  product_code text,
  product_name text,
  unit text,
  current_stock numeric,
  opening_stock numeric,
  minimum_stock numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.current_user_company_id();
  organization_company_id uuid;
begin
  if target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = target_organization_id;

  if organization_company_id is null
    or (
      not public.is_super_admin()
      and target_company_id is distinct from organization_company_id
    ) then
    raise exception 'Organization and company access do not match'
      using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or public.user_has_permission('inventory', 'view')
  ) then
    raise exception 'Inventory view permission is required'
      using errcode = '42501';
  end if;

  return query
  select
    inventory_items.id,
    products.id,
    inventory_items.item_code,
    products.product_code,
    products.product_name,
    inventory_items.unit,
    coalesce(inventory_items.current_stock, 0),
    coalesce(inventory_items.opening_stock, 0),
    coalesce(inventory_items.minimum_stock, 0)
  from public.inventory_items
  join public.products
    on products.id = inventory_items.catalog_product_id
   and products.tenant_id = inventory_items.organization_id
  where inventory_items.organization_id = target_organization_id
    and inventory_items.status = 'active'
    and inventory_items.archived_at is null
    and products.status = 'active'
    and products.archived_at is null
    and coalesce(inventory_items.current_stock, 0) = 0
    and coalesce(inventory_items.opening_stock, 0) = 0
    and not exists (
      select 1
      from public.inventory_transactions
      where inventory_transactions.item_id = inventory_items.id
    )
    and not exists (
      select 1
      from public.inventory_batches
      where inventory_batches.inventory_item_id = inventory_items.id
    )
    and not exists (
      select 1
      from public.inventory_reservations
      where inventory_reservations.inventory_item_id = inventory_items.id
        and inventory_reservations.status in ('active', 'partial', 'shortage')
    )
  order by products.product_name, products.product_code;
end;
$$;

create or replace function public.set_inventory_opening_balances(
  entries jsonb,
  balance_date date default current_date,
  notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.current_user_company_id();
  organization_company_id uuid;
  current_profile_id uuid := public.current_user_profile_id();
  entry jsonb;
  item_record public.inventory_items%rowtype;
  product_record public.products%rowtype;
  opening_quantity numeric;
  transaction_record public.inventory_transactions%rowtype;
  transaction_ids jsonb := '[]'::jsonb;
  clean_notes text := nullif(btrim(coalesce(notes, '')), '');
  processed_count integer := 0;
begin
  if target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = target_organization_id;

  if organization_company_id is null
    or (
      not public.is_super_admin()
      and target_company_id is distinct from organization_company_id
    ) then
    raise exception 'Organization and company access do not match'
      using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or (
      public.user_has_permission('inventory', 'create')
      and public.user_has_permission('inventory', 'update')
    )
  ) then
    raise exception 'Inventory create and update permissions are required'
      using errcode = '42501';
  end if;

  if entries is null
    or jsonb_typeof(entries) <> 'array'
    or jsonb_array_length(entries) = 0 then
    raise exception 'At least one opening balance entry is required'
      using errcode = '23514';
  end if;

  if balance_date is null then
    raise exception 'Opening balance date is required'
      using errcode = '23502';
  end if;

  for entry in
    select value from jsonb_array_elements(entries)
  loop
    if nullif(entry ->> 'inventory_item_id', '') is null then
      raise exception 'inventory_item_id is required for every opening balance'
        using errcode = '23502';
    end if;

    opening_quantity := nullif(entry ->> 'quantity', '')::numeric;
    if opening_quantity is null or opening_quantity <= 0 then
      raise exception 'Opening balance quantities must be greater than zero'
        using errcode = '23514';
    end if;

    select *
    into item_record
    from public.inventory_items
    where inventory_items.id = (entry ->> 'inventory_item_id')::uuid
    for update;

    if not found then
      raise exception 'Inventory item not found'
        using errcode = 'P0002';
    end if;

    if item_record.organization_id <> target_organization_id then
      raise exception 'Inventory item belongs to another organization'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.organizations
      where organizations.id = item_record.organization_id
        and organizations.company_id = organization_company_id
    ) then
      raise exception 'Inventory item belongs to another company'
        using errcode = '42501';
    end if;

    select *
    into product_record
    from public.products
    where products.id = item_record.catalog_product_id
      and products.tenant_id = item_record.organization_id;

    if not found
      or product_record.status <> 'active'
      or item_record.status <> 'active'
      or item_record.archived_at is not null then
      raise exception 'Opening stock can only be set for active Product Master items'
        using errcode = '23514';
    end if;

    if coalesce(item_record.current_stock, 0) <> 0
      or coalesce(item_record.opening_stock, 0) <> 0
      or exists (
        select 1 from public.inventory_transactions
        where inventory_transactions.item_id = item_record.id
      )
      or exists (
        select 1 from public.inventory_batches
        where inventory_batches.inventory_item_id = item_record.id
      )
      or exists (
        select 1 from public.inventory_reservations
        where inventory_reservations.inventory_item_id = item_record.id
          and inventory_reservations.status in ('active', 'partial', 'shortage')
      ) then
      raise exception 'Opening stock is available only before the first stock movement or reservation'
        using errcode = '23514';
    end if;

    update public.inventory_items
    set
      opening_stock = opening_quantity,
      inventory_date = balance_date
    where inventory_items.id = item_record.id;

    insert into public.inventory_transactions (
      company_id,
      organization_id,
      item_id,
      transaction_type,
      quantity,
      transaction_date,
      reference_type,
      notes,
      created_by
    )
    values (
      organization_company_id,
      item_record.organization_id,
      item_record.id,
      'stock_in',
      opening_quantity,
      balance_date,
      'opening_balance',
      coalesce(clean_notes, 'Opening balance'),
      current_profile_id
    )
    returning * into transaction_record;

    transaction_ids := transaction_ids || jsonb_build_array(transaction_record.id);
    processed_count := processed_count + 1;
  end loop;

  return jsonb_build_object(
    'processed_count', processed_count,
    'transaction_ids', transaction_ids
  );
end;
$$;

create or replace function public.correct_inventory_stock(
  target_item_id uuid,
  counted_quantity numeric,
  correction_date date,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.current_user_company_id();
  organization_company_id uuid;
  current_profile_id uuid := public.current_user_profile_id();
  item_record public.inventory_items%rowtype;
  transaction_record public.inventory_transactions%rowtype;
  reserved_quantity numeric := 0;
  adjustment_quantity numeric;
  clean_reason text := nullif(btrim(coalesce(reason, '')), '');
begin
  if target_item_id is null then
    raise exception 'target_item_id is required'
      using errcode = '23502';
  end if;

  if counted_quantity is null or counted_quantity < 0 then
    raise exception 'Counted quantity must be zero or greater'
      using errcode = '23514';
  end if;

  if correction_date is null then
    raise exception 'Correction date is required'
      using errcode = '23502';
  end if;

  if clean_reason is null then
    raise exception 'Correction reason is required'
      using errcode = '23514';
  end if;

  if target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = target_organization_id;

  if organization_company_id is null
    or (
      not public.is_super_admin()
      and target_company_id is distinct from organization_company_id
    ) then
    raise exception 'Organization and company access do not match'
      using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or (
      public.user_has_permission('inventory', 'create')
      and public.user_has_permission('inventory', 'update')
    )
  ) then
    raise exception 'Inventory create and update permissions are required'
      using errcode = '42501';
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = target_item_id
  for update;

  if not found then
    raise exception 'Inventory item not found'
      using errcode = 'P0002';
  end if;

  if item_record.organization_id <> target_organization_id
    or not exists (
      select 1
      from public.organizations
      where organizations.id = item_record.organization_id
        and organizations.company_id = organization_company_id
    ) then
    raise exception 'Inventory item belongs to another tenant'
      using errcode = '42501';
  end if;

  select coalesce(sum(inventory_reservations.reserved_qty), 0)
  into reserved_quantity
  from public.inventory_reservations
  where inventory_reservations.inventory_item_id = item_record.id
    and inventory_reservations.status in ('active', 'partial');

  if counted_quantity < reserved_quantity then
    raise exception 'Counted stock cannot be lower than the actively reserved quantity (%)', reserved_quantity
      using errcode = '23514';
  end if;

  adjustment_quantity := counted_quantity - coalesce(item_record.current_stock, 0);
  if adjustment_quantity = 0 then
    raise exception 'Counted stock already matches the current physical stock'
      using errcode = '23514';
  end if;

  insert into public.inventory_transactions (
    company_id,
    organization_id,
    item_id,
    transaction_type,
    quantity,
    transaction_date,
    reference_type,
    notes,
    created_by
  )
  values (
    organization_company_id,
    item_record.organization_id,
    item_record.id,
    'adjustment',
    adjustment_quantity,
    correction_date,
    'stock_correction',
    clean_reason,
    current_profile_id
  )
  returning * into transaction_record;

  perform public.create_activity_log(
    'inventory_transactions',
    transaction_record.id,
    'stock_correction',
    jsonb_build_object('current_stock', item_record.current_stock),
    jsonb_build_object(
      'counted_stock', counted_quantity,
      'adjustment', adjustment_quantity,
      'reason', clean_reason,
      'transaction', to_jsonb(transaction_record)
    )
  );

  return to_jsonb(transaction_record);
end;
$$;

revoke execute on function public.inventory_opening_balance_candidates()
from public, anon, authenticated;
revoke execute on function public.set_inventory_opening_balances(jsonb, date, text)
from public, anon, authenticated;
revoke execute on function public.correct_inventory_stock(uuid, numeric, date, text)
from public, anon, authenticated;

grant execute on function public.inventory_opening_balance_candidates()
to authenticated;
grant execute on function public.set_inventory_opening_balances(jsonb, date, text)
to authenticated;
grant execute on function public.correct_inventory_stock(uuid, numeric, date, text)
to authenticated;

-- Product sync and approved RPCs are now the only inventory creation and
-- ledger-insert paths available to the browser client.
revoke insert on table public.inventory_items from authenticated;
revoke delete on table public.inventory_items from authenticated;
revoke insert on table public.inventory_transactions from authenticated;
revoke update, delete on table public.inventory_transactions from authenticated;
revoke update on table public.inventory_items from authenticated;
grant update (minimum_stock, notes) on table public.inventory_items to authenticated;

notify pgrst, 'reload schema';
