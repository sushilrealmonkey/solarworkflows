-- Allow inventory staff to receive purchase stock without product pricing access.
-- Pricing users may still edit received cost and update Product Master pricing.

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
  can_manage_pricing boolean := public.is_super_admin()
    or public.user_has_permission('product_pricing', 'update');
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

  if received_items is null
    or jsonb_typeof(received_items) <> 'array'
    or jsonb_array_length(received_items) = 0 then
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
    ) then
      raise exception 'Missing inventory receiving permission'
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

    receive_quantity := coalesce(nullif(receive_row ->> 'received_quantity', '')::numeric, 0);

    if receive_quantity <= 0 then
      continue;
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

    if can_manage_pricing then
      actual_unit_price := coalesce(
        nullif(receive_row ->> 'actual_unit_purchase_price', '')::numeric,
        coalesce(item_record.unit_price, 0)
      );
      receive_gst_percent := coalesce(
        nullif(receive_row ->> 'gst_percent', '')::numeric,
        coalesce(item_record.gst_percent, 0)
      );
      update_current_price := coalesce(
        nullif(receive_row ->> 'update_current_purchase_price', '')::boolean,
        false
      );
    else
      actual_unit_price := coalesce(item_record.unit_price, 0);
      receive_gst_percent := coalesce(item_record.gst_percent, 0);
      update_current_price := false;
    end if;

    if actual_unit_price < 0 or receive_gst_percent < 0 then
      raise exception 'Received price and GST cannot be negative'
        using errcode = '23514';
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

grant execute on function public.receive_purchase_order_items(uuid, jsonb, text, date, text) to authenticated;

notify pgrst, 'reload schema';
