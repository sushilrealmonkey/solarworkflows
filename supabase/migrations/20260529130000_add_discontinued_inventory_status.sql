alter table public.inventory_items drop constraint if exists inventory_items_status_check;

alter table public.inventory_items
add constraint inventory_items_status_check
check (status in ('active', 'inactive', 'discontinued'));
