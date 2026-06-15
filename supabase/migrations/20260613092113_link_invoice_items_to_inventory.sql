-- Link invoice line snapshots to inventory items without adding stock movement.

alter table public.invoice_items
add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

create index if not exists invoice_items_inventory_item_id_idx
on public.invoice_items (inventory_item_id);

create or replace function public.set_invoice_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_organization_id uuid;
begin
  select invoices.organization_id
  into parent_organization_id
  from public.invoices
  where invoices.id = new.invoice_id;

  if parent_organization_id is null then
    raise exception 'invoice_id must reference an existing invoice'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := parent_organization_id;
  end if;

  if new.organization_id <> parent_organization_id then
    raise exception 'invoice item organization_id must match the invoice organization_id'
      using errcode = '23503';
  end if;

  if new.inventory_item_id is not null and not exists (
    select 1
    from public.inventory_items
    where inventory_items.id = new.inventory_item_id
      and inventory_items.organization_id = new.organization_id
  ) then
    raise exception 'inventory_item_id must belong to the same organization as the invoice item'
      using errcode = '23503';
  end if;

  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.line_total := new.quantity * new.unit_price;
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;
