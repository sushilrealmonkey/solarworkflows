-- Allow receipt paperwork to be corrected from PO edit without reopening
-- supplier, item, quantity, pricing, or stock mutations.

create or replace function public.prevent_inventory_transaction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.transaction_type = 'stock_in'
    and old.reference_type = 'purchase_order'
    and (to_jsonb(new) - array['bill_no', 'updated_at']) =
        (to_jsonb(old) - array['bill_no', 'updated_at']) then
    return new;
  end if;

  raise exception 'Inventory transactions are append-only. Create a reversal transaction instead.'
    using errcode = '23514';
end;
$$;

create or replace function public.purchase_order_bill_invoice_no(
  target_purchase_order_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  order_organization_id uuid;
  result text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or (
      public.user_has_permission('inventory', 'view')
      and public.user_has_permission('product_pricing', 'view')
    )
  ) then
    raise exception 'Inventory and purchase pricing view permissions are required'
      using errcode = '42501';
  end if;

  select organization_id
  into order_organization_id
  from public.purchase_orders
  where id = target_purchase_order_id;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and order_organization_id <> public.current_user_organization_id() then
    raise exception 'Purchase order belongs to another tenant' using errcode = '42501';
  end if;

  select bill_no
  into result
  from public.inventory_batches
  where purchase_order_id = target_purchase_order_id
    and organization_id = order_organization_id
    and bill_no is not null
  order by created_at desc, id desc
  limit 1;

  return result;
end;
$$;

create or replace function public.update_received_purchase_order(
  target_purchase_order_id uuid,
  bill_invoice_no text default null,
  target_expected_delivery_date date default null,
  target_notes text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.purchase_orders%rowtype;
  clean_bill_invoice_no text := nullif(btrim(coalesce(bill_invoice_no, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  ) then
    raise exception 'Inventory and purchase pricing update permissions are required'
      using errcode = '42501';
  end if;

  select *
  into order_record
  from public.purchase_orders
  where id = target_purchase_order_id
  for update;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and order_record.organization_id <> public.current_user_organization_id() then
    raise exception 'Purchase order belongs to another tenant' using errcode = '42501';
  end if;

  if order_record.archived_at is not null then
    raise exception 'Archived purchase orders are read-only. Restore the order before editing it.'
      using errcode = '23514';
  end if;

  if order_record.status = 'cancelled' then
    raise exception 'Cancelled purchase orders are read-only.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.inventory_batches
    where purchase_order_id = target_purchase_order_id
      and organization_id = order_record.organization_id
  ) then
    raise exception 'Bill / invoice details can be updated here only after material is received.'
      using errcode = '23514';
  end if;

  update public.inventory_batches
  set bill_no = clean_bill_invoice_no
  where purchase_order_id = target_purchase_order_id
    and organization_id = order_record.organization_id;

  update public.inventory_transactions
  set bill_no = clean_bill_invoice_no
  where organization_id = order_record.organization_id
    and transaction_type = 'stock_in'
    and reference_type = 'purchase_order'
    and reference_id = target_purchase_order_id;

  update public.purchase_orders
  set
    expected_delivery_date = target_expected_delivery_date,
    notes = nullif(btrim(coalesce(target_notes, '')), ''),
    updated_at = now()
  where id = target_purchase_order_id
  returning * into order_record;

  return order_record;
end;
$$;

revoke execute on function public.update_received_purchase_order(uuid, text, date, text)
from public, anon;
grant execute on function public.update_received_purchase_order(uuid, text, date, text)
to authenticated;

revoke execute on function public.purchase_order_bill_invoice_no(uuid)
from public, anon;
grant execute on function public.purchase_order_bill_invoice_no(uuid)
to authenticated;

revoke execute on function public.prevent_inventory_transaction_mutation()
from public, authenticated;

notify pgrst, 'reload schema';
