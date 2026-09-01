-- Add stock directly from Inventory for receipts that are not linked to a PO.
-- The operation records both the stock batch and append-only ledger entry in
-- one transaction. Product identity remains owned by Product Master.

create or replace function public.add_inventory_stock(
  target_item_id uuid,
  add_quantity numeric,
  stock_date date,
  stock_reason text,
  target_vendor_id uuid default null,
  stock_bill_no text default null,
  unit_purchase_price numeric default null,
  stock_gst_percent numeric default null,
  stock_notes text default null
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
  product_record public.products%rowtype;
  vendor_record public.vendors%rowtype;
  batch_record public.inventory_batches%rowtype;
  transaction_record public.inventory_transactions%rowtype;
  clean_reason text := nullif(pg_catalog.btrim(coalesce(stock_reason, '')), '');
  clean_bill_no text := nullif(pg_catalog.btrim(coalesce(stock_bill_no, '')), '');
  clean_notes text := nullif(pg_catalog.btrim(coalesce(stock_notes, '')), '');
  ledger_notes text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if target_item_id is null then
    raise exception 'target_item_id is required'
      using errcode = '23502';
  end if;

  if add_quantity is null or add_quantity <= 0 then
    raise exception 'Stock quantity must be greater than zero'
      using errcode = '23514';
  end if;

  if stock_date is null then
    raise exception 'Stock date is required'
      using errcode = '23502';
  end if;

  if stock_date > current_date then
    raise exception 'Stock date cannot be in the future'
      using errcode = '23514';
  end if;

  if clean_reason is null then
    raise exception 'Stock reason is required'
      using errcode = '23514';
  end if;

  if unit_purchase_price is not null and unit_purchase_price < 0 then
    raise exception 'Unit purchase price cannot be negative'
      using errcode = '23514';
  end if;

  if stock_gst_percent is not null
    and (stock_gst_percent < 0 or stock_gst_percent > 100) then
    raise exception 'GST percentage must be between 0 and 100'
      using errcode = '23514';
  end if;

  if target_organization_id is null or target_company_id is null then
    raise exception 'No active organization and company are assigned to this user'
      using errcode = '42501';
  end if;

  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = target_organization_id;

  if organization_company_id is null
    or organization_company_id is distinct from target_company_id then
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

  if (unit_purchase_price is not null or stock_gst_percent is not null)
    and not (
      public.is_super_admin()
      or public.user_has_permission('product_pricing', 'update')
    ) then
    raise exception 'Product pricing update permission is required for cost details'
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

  if item_record.organization_id <> target_organization_id then
    raise exception 'Inventory item belongs to another organization'
      using errcode = '42501';
  end if;

  if item_record.status <> 'active' or item_record.archived_at is not null then
    raise exception 'Stock can only be added to an active inventory item'
      using errcode = '23514';
  end if;

  select *
  into product_record
  from public.products
  where products.id = item_record.catalog_product_id
    and products.tenant_id = item_record.organization_id
  for share;

  if not found
    or product_record.status <> 'active'
    or product_record.archived_at is not null then
    raise exception 'Stock can only be added to an active Product Master item'
      using errcode = '23514';
  end if;

  if target_vendor_id is not null then
    select *
    into vendor_record
    from public.vendors
    where vendors.id = target_vendor_id
      and vendors.organization_id = target_organization_id
      and vendors.status = 'active'
      and vendors.archived_at is null;

    if not found then
      raise exception 'Supplier must be an active supplier in this organization'
        using errcode = '23503';
    end if;
  end if;

  ledger_notes := 'Reason: ' || clean_reason;
  if clean_notes is not null then
    ledger_notes := ledger_notes || pg_catalog.chr(10) || 'Notes: ' || clean_notes;
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
    organization_company_id,
    item_record.organization_id,
    item_record.id,
    item_record.catalog_product_id,
    null,
    null,
    target_vendor_id,
    add_quantity,
    add_quantity,
    coalesce(unit_purchase_price, 0),
    coalesce(stock_gst_percent, 0),
    clean_bill_no,
    stock_date,
    ledger_notes,
    current_profile_id
  )
  returning * into batch_record;

  insert into public.inventory_transactions (
    company_id,
    organization_id,
    item_id,
    transaction_type,
    quantity,
    transaction_date,
    vendor_id,
    bill_no,
    reference_type,
    notes,
    created_by
  )
  values (
    organization_company_id,
    item_record.organization_id,
    item_record.id,
    'stock_in',
    add_quantity,
    stock_date,
    target_vendor_id,
    clean_bill_no,
    'manual_stock_in',
    ledger_notes,
    current_profile_id
  )
  returning * into transaction_record;

  perform public.create_activity_log(
    'inventory_transactions',
    transaction_record.id,
    'manual_stock_in',
    null,
    jsonb_build_object(
      'organization_id', item_record.organization_id,
      'inventory_item_id', item_record.id,
      'batch_id', batch_record.id,
      'quantity', add_quantity,
      'stock_date', stock_date,
      'reason', clean_reason
    )
  );

  return jsonb_build_object(
    'transaction_id', transaction_record.id,
    'batch_id', batch_record.id,
    'item_id', item_record.id,
    'quantity', add_quantity,
    'current_stock', coalesce(item_record.current_stock, 0) + add_quantity
  );
end;
$$;

revoke execute on function public.add_inventory_stock(uuid, numeric, date, text, uuid, text, numeric, numeric, text)
from public, anon;
grant execute on function public.add_inventory_stock(uuid, numeric, date, text, uuid, text, numeric, numeric, text)
to authenticated;

notify pgrst, 'reload schema';
