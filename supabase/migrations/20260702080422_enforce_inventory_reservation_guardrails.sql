-- Enforce accepted-quotation inventory reservations at the database boundary.
-- Reservations are soft holds: they reduce available stock, but physical stock
-- is still reduced only when dispatch creates stock-out ledger rows.

create or replace function public.lock_inventory_item_available_quantity(
  target_item_id uuid,
  excluded_reservation_id uuid default null
)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  physical_stock numeric := 0;
  reserved_stock numeric := 0;
begin
  select coalesce(inventory_items.current_stock, 0)
  into physical_stock
  from public.inventory_items
  where inventory_items.id = target_item_id
  for update;

  if not found then
    return 0;
  end if;

  select coalesce(sum(inventory_reservations.reserved_qty), 0)
  into reserved_stock
  from public.inventory_reservations
  where inventory_reservations.inventory_item_id = target_item_id
    and inventory_reservations.status in ('active', 'partial')
    and (
      excluded_reservation_id is null
      or inventory_reservations.id <> excluded_reservation_id
    );

  return greatest(physical_stock - reserved_stock, 0);
end;
$$;

create or replace function public.enforce_inventory_reservation_stock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.inventory_items%rowtype;
  already_reserved_qty numeric := 0;
  available_qty numeric := 0;
  expected_shortage_qty numeric := 0;
begin
  new.required_qty := coalesce(new.required_qty, 0);
  new.reserved_qty := coalesce(new.reserved_qty, 0);
  new.shortage_qty := coalesce(new.shortage_qty, 0);
  new.status := coalesce(nullif(btrim(new.status), ''), 'active');

  if new.required_qty < 0
    or new.reserved_qty < 0
    or new.shortage_qty < 0 then
    raise exception 'Reservation quantities cannot be negative'
      using errcode = '23514';
  end if;

  if new.reserved_qty > new.required_qty then
    raise exception 'Reserved quantity cannot exceed required quantity'
      using errcode = '23514';
  end if;

  if new.status in ('active', 'partial', 'shortage') then
    expected_shortage_qty := greatest(new.required_qty - new.reserved_qty, 0);

    if new.shortage_qty <> expected_shortage_qty then
      raise exception 'Reservation shortage quantity must equal required quantity minus reserved quantity'
        using errcode = '23514';
    end if;

    if new.status = 'active'
      and (new.reserved_qty <> new.required_qty or new.shortage_qty <> 0) then
      raise exception 'Active reservations must reserve the full required quantity'
        using errcode = '23514';
    end if;

    if new.status = 'partial'
      and not (new.reserved_qty > 0 and new.shortage_qty > 0) then
      raise exception 'Partial reservations must include both reserved and shortage quantities'
        using errcode = '23514';
    end if;

    if new.status = 'shortage'
      and new.reserved_qty <> 0 then
      raise exception 'Shortage reservations cannot hold reserved quantity'
        using errcode = '23514';
    end if;
  end if;

  if new.status not in ('active', 'partial') or new.reserved_qty = 0 then
    return new;
  end if;

  if new.inventory_item_id is null then
    raise exception 'Reserved quantity requires an inventory item'
      using errcode = '23514';
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = new.inventory_item_id
  for update;

  if not found then
    raise exception 'Reserved inventory item was not found'
      using errcode = '23503';
  end if;

  if item_record.organization_id <> new.organization_id then
    raise exception 'Reserved inventory item must belong to the reservation organization'
      using errcode = '23503';
  end if;

  if item_record.status <> 'active' then
    raise exception 'Reserved inventory item must be active'
      using errcode = '23514';
  end if;

  select coalesce(sum(inventory_reservations.reserved_qty), 0)
  into already_reserved_qty
  from public.inventory_reservations
  where inventory_reservations.inventory_item_id = new.inventory_item_id
    and inventory_reservations.status in ('active', 'partial')
    and inventory_reservations.id is distinct from new.id;

  available_qty := greatest(coalesce(item_record.current_stock, 0) - already_reserved_qty, 0);

  if new.reserved_qty > available_qty then
    raise exception 'Cannot reserve % units for %. Only % units are available after existing reservations.',
      new.reserved_qty,
      coalesce(
        nullif(concat_ws(' / ', item_record.item_name, item_record.brand, item_record.model), ''),
        item_record.item_code,
        'inventory item'
      ),
      available_qty
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_inventory_reservation_stock_guard on public.inventory_reservations;

create trigger enforce_inventory_reservation_stock_guard
before insert or update of organization_id, inventory_item_id, required_qty, reserved_qty, shortage_qty, status
on public.inventory_reservations
for each row
execute function public.enforce_inventory_reservation_stock_guard();

create or replace function public.sync_inventory_reservations_for_quotation(
  target_quotation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  reservation_company_id uuid;
  current_profile_id uuid;
  source_row record;
  selected_inventory_item_id uuid;
  available_qty numeric;
  next_reserved_qty numeric;
  next_shortage_qty numeric;
  next_status text;
  inserted_count integer := 0;
  bom_source_count integer := 0;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is not null and not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot reserve inventory for another organization quotation'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('quotations', 'update')
      or public.user_has_permission('inventory', 'update')
    ) then
      raise exception 'Missing permission to reserve inventory'
        using errcode = '42501';
    end if;
  end if;

  reservation_company_id := public.reservation_company_id_for_quotation(quotation_record);

  select profiles.id
  into current_profile_id
  from public.profiles
  where profiles.id = auth.uid();

  perform public.release_inventory_reservations_for_quotation(
    quotation_record.id,
    'quotation_reservation_refresh'
  );

  select count(*)
  into bom_source_count
  from public.quotation_bom_items
  where quotation_bom_items.quotation_id = quotation_record.id
    and quotation_bom_items.tenant_id = quotation_record.organization_id
    and quotation_bom_items.product_id is not null
    and coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) > 0;

  if bom_source_count > 0 then
    for source_row in
      select
        quotation_bom_items.id as quotation_bom_item_id,
        null::integer as material_item_index,
        quotation_bom_items.product_id as catalog_product_id,
        null::uuid as inventory_item_id,
        coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) as required_qty,
        coalesce(products.product_name, quotation_bom_items.item_name, 'Quotation BOM item') as item_label
      from public.quotation_bom_items
      left join public.products on products.id = quotation_bom_items.product_id
      where quotation_bom_items.quotation_id = quotation_record.id
        and quotation_bom_items.tenant_id = quotation_record.organization_id
        and quotation_bom_items.product_id is not null
        and coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) > 0
      order by quotation_bom_items.display_order, quotation_bom_items.created_at
    loop
      selected_inventory_item_id := public.find_inventory_item_for_reservation(
        quotation_record.organization_id,
        source_row.catalog_product_id,
        source_row.inventory_item_id
      );
      available_qty := case
        when selected_inventory_item_id is null then 0
        else public.lock_inventory_item_available_quantity(selected_inventory_item_id, null)
      end;
      next_reserved_qty := least(source_row.required_qty, greatest(coalesce(available_qty, 0), 0));
      next_shortage_qty := greatest(source_row.required_qty - next_reserved_qty, 0);
      next_status := case
        when next_reserved_qty >= source_row.required_qty then 'active'
        when next_reserved_qty > 0 then 'partial'
        else 'shortage'
      end;

      insert into public.inventory_reservations (
        company_id,
        organization_id,
        quotation_id,
        project_id,
        quotation_bom_item_id,
        material_item_index,
        catalog_product_id,
        inventory_item_id,
        required_qty,
        reserved_qty,
        shortage_qty,
        status,
        source_event,
        notes,
        created_by
      )
      values (
        reservation_company_id,
        quotation_record.organization_id,
        quotation_record.id,
        null,
        source_row.quotation_bom_item_id,
        null,
        source_row.catalog_product_id,
        selected_inventory_item_id,
        source_row.required_qty,
        next_reserved_qty,
        next_shortage_qty,
        next_status,
        'quotation_accepted',
        case
          when selected_inventory_item_id is null then 'No active inventory item is mapped to this quotation product.'
          when next_shortage_qty > 0 then 'Reservation created with a procurement shortage.'
          else null
        end,
        current_profile_id
      );

      update public.quotation_bom_items
      set reserved_qty = next_reserved_qty, updated_at = now()
      where quotation_bom_items.id = source_row.quotation_bom_item_id;

      inserted_count := inserted_count + 1;
    end loop;
  else
    for source_row in
      select
        (source_items.ordinality::integer - 1) as material_item_index,
        case
          when nullif(source_items.item ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then nullif(source_items.item ->> 'product_id', '')::uuid
          else null
        end as catalog_product_id,
        case
          when nullif(source_items.item ->> 'inventory_item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then nullif(source_items.item ->> 'inventory_item_id', '')::uuid
          else null
        end as inventory_item_id,
        case
          when nullif(source_items.item ->> 'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then nullif(source_items.item ->> 'quantity', '')::numeric
          else 0
        end as required_qty,
        coalesce(source_items.item ->> 'description', 'Quotation material item') as item_label
      from jsonb_array_elements(coalesce(quotation_record.material_items, '[]'::jsonb)) with ordinality as source_items(item, ordinality)
      where nullif(source_items.item ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and nullif(source_items.item ->> 'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
      order by source_items.ordinality
    loop
      if source_row.required_qty <= 0 then
        continue;
      end if;

      selected_inventory_item_id := public.find_inventory_item_for_reservation(
        quotation_record.organization_id,
        source_row.catalog_product_id,
        source_row.inventory_item_id
      );
      available_qty := case
        when selected_inventory_item_id is null then 0
        else public.lock_inventory_item_available_quantity(selected_inventory_item_id, null)
      end;
      next_reserved_qty := least(source_row.required_qty, greatest(coalesce(available_qty, 0), 0));
      next_shortage_qty := greatest(source_row.required_qty - next_reserved_qty, 0);
      next_status := case
        when next_reserved_qty >= source_row.required_qty then 'active'
        when next_reserved_qty > 0 then 'partial'
        else 'shortage'
      end;

      insert into public.inventory_reservations (
        company_id,
        organization_id,
        quotation_id,
        material_item_index,
        catalog_product_id,
        inventory_item_id,
        required_qty,
        reserved_qty,
        shortage_qty,
        status,
        source_event,
        notes,
        created_by
      )
      values (
        reservation_company_id,
        quotation_record.organization_id,
        quotation_record.id,
        source_row.material_item_index,
        source_row.catalog_product_id,
        selected_inventory_item_id,
        source_row.required_qty,
        next_reserved_qty,
        next_shortage_qty,
        next_status,
        'quotation_accepted',
        case
          when selected_inventory_item_id is null then 'No active inventory item is mapped to this quotation product.'
          when next_shortage_qty > 0 then 'Reservation created with a procurement shortage.'
          else null
        end,
        current_profile_id
      );

      inserted_count := inserted_count + 1;
    end loop;
  end if;

  return inserted_count;
end;
$$;

grant execute on function public.sync_inventory_reservations_for_quotation(uuid) to authenticated;

revoke execute on function public.lock_inventory_item_available_quantity(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.enforce_inventory_reservation_stock_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
