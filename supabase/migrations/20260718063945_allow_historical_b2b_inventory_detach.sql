-- Historical B2B line items retain their item-name, description, quantity,
-- unit, pricing, tax, and discount snapshots after an administrative
-- inventory reset. New and edited sales still require an inventory item
-- through the existing form validation and line-item trigger.
alter table public.b2b_sale_items
alter column inventory_item_id drop not null;

notify pgrst, 'reload schema';
