-- Material receiving updates both receipt progress and its audit timestamp.
-- Keep purchase-line identity, ordered quantity, and pricing immutable after the
-- first receipt while allowing those two receipt bookkeeping fields to advance.
create or replace function public.protect_received_purchase_order_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_order_id uuid;
  order_has_receipt boolean;
begin
  target_order_id := case
    when tg_op = 'DELETE' then old.purchase_order_id
    else new.purchase_order_id
  end;

  select exists (
    select 1 from public.purchase_order_items
    where purchase_order_items.purchase_order_id = target_order_id
      and coalesce(purchase_order_items.received_quantity, 0) > 0
  ) or exists (
    select 1 from public.inventory_batches
    where inventory_batches.purchase_order_id = target_order_id
  ) into order_has_receipt;

  if not order_has_receipt then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'Purchase-order lines cannot be added or removed after material is received.'
      using errcode = '23514';
  end if;

  if (to_jsonb(new) - array['received_quantity', 'last_received_at', 'updated_at']) is distinct from
     (to_jsonb(old) - array['received_quantity', 'last_received_at', 'updated_at']) then
    raise exception 'Purchase-order line identity, quantity, and pricing are locked after material is received.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_received_purchase_order_item() from public, authenticated;
