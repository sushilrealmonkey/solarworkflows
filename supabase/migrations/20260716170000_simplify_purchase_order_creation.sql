-- A created purchase order is immediately ready for material receiving.
-- The separate draft-to-ordered action is no longer part of the workflow.

alter table public.purchase_orders
alter column status set default 'ordered';

update public.purchase_orders
set status = 'ordered'
where status = 'draft';
