-- Keep generated document history when its purchase order is deleted.

alter table public.documents
drop constraint if exists documents_purchase_order_id_fkey;

alter table public.documents
add constraint documents_purchase_order_id_fkey
foreign key (purchase_order_id)
references public.purchase_orders(id)
on delete set null;
