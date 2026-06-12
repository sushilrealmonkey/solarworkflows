create or replace function public.prevent_inactive_project_inventory_issue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.inventory_items%rowtype;
begin
  if new.transaction_type <> 'project_issue'
    and not (new.transaction_type = 'stock_out' and new.project_id is not null) then
    return new;
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = new.item_id;

  if not found then
    raise exception 'Inventory item not found'
      using errcode = 'P0002';
  end if;

  if item_record.status <> 'active' then
    raise exception '% is %. Only active inventory items can be issued or dispatched to projects.',
      coalesce(
        nullif(concat_ws(' / ', item_record.item_name, item_record.brand, item_record.model), ''),
        item_record.item_code,
        'Inventory item'
      ),
      item_record.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_inactive_project_inventory_issue on public.inventory_transactions;

create trigger prevent_inactive_project_inventory_issue
before insert on public.inventory_transactions
for each row
execute function public.prevent_inactive_project_inventory_issue();
