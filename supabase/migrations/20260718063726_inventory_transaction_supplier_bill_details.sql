-- Store receipt-specific supplier and bill details on the inventory ledger.
-- Item-level supplier and bill fields remain only for legacy compatibility.

alter table public.inventory_transactions
add column if not exists company_id uuid references public.companies(id) on delete set null;

alter table public.inventory_transactions
add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

alter table public.inventory_transactions
add column if not exists bill_no text;

create index if not exists inventory_transactions_company_id_idx
on public.inventory_transactions (company_id);

create index if not exists inventory_transactions_vendor_id_idx
on public.inventory_transactions (vendor_id);

update public.inventory_transactions
set company_id = organizations.company_id
from public.organizations
where organizations.id = inventory_transactions.organization_id
  and inventory_transactions.company_id is null;

-- Backfill receipt details already captured in inventory_batches.
update public.inventory_transactions as ledger
set
  vendor_id = coalesce(
    ledger.vendor_id,
    (
      select batch.vendor_id
      from public.inventory_batches as batch
      where batch.organization_id = ledger.organization_id
        and batch.inventory_item_id = ledger.item_id
        and batch.purchase_order_id = ledger.reference_id
        and batch.received_date = ledger.transaction_date
        and batch.received_quantity = ledger.quantity
        and batch.created_at <= ledger.created_at
      order by batch.created_at desc, batch.id desc
      limit 1
    )
  ),
  bill_no = coalesce(
    ledger.bill_no,
    (
      select batch.bill_no
      from public.inventory_batches as batch
      where batch.organization_id = ledger.organization_id
        and batch.inventory_item_id = ledger.item_id
        and batch.purchase_order_id = ledger.reference_id
        and batch.received_date = ledger.transaction_date
        and batch.received_quantity = ledger.quantity
        and batch.created_at <= ledger.created_at
      order by batch.created_at desc, batch.id desc
      limit 1
    )
  )
where ledger.transaction_type = 'stock_in'
  and ledger.reference_type = 'purchase_order'
  and ledger.reference_id is not null;

create or replace function public.set_inventory_transactions_receipt_details()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  organization_company_id uuid;
  receipt_vendor_id uuid;
  receipt_bill_no text;
begin
  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = new.organization_id;

  if not found then
    raise exception 'organization_id must reference an existing organization'
      using errcode = '23503';
  end if;

  if new.company_id is null then
    new.company_id := organization_company_id;
  elsif new.company_id is distinct from organization_company_id then
    raise exception 'company_id must match the inventory transaction organization'
      using errcode = '23503';
  end if;

  if new.transaction_type = 'stock_in'
    and new.reference_type = 'purchase_order'
    and new.reference_id is not null then
    select batch.vendor_id, batch.bill_no
    into receipt_vendor_id, receipt_bill_no
    from public.inventory_batches as batch
    where batch.organization_id = new.organization_id
      and batch.inventory_item_id = new.item_id
      and batch.purchase_order_id = new.reference_id
      and batch.received_date = coalesce(new.transaction_date, current_date)
      and batch.received_quantity = new.quantity
    order by batch.created_at desc, batch.id desc
    limit 1;

    new.vendor_id := coalesce(new.vendor_id, receipt_vendor_id);
    new.bill_no := coalesce(new.bill_no, receipt_bill_no);
  end if;

  if new.vendor_id is not null and not exists (
    select 1
    from public.vendors
    where vendors.id = new.vendor_id
      and vendors.organization_id = new.organization_id
  ) then
    raise exception 'vendor_id must belong to the same organization as the inventory transaction'
      using errcode = '23503';
  end if;

  new.bill_no := nullif(btrim(coalesce(new.bill_no, '')), '');

  return new;
end;
$$;

drop trigger if exists set_inventory_transactions_receipt_details
on public.inventory_transactions;

create trigger set_inventory_transactions_receipt_details
before insert on public.inventory_transactions
for each row
execute function public.set_inventory_transactions_receipt_details();
