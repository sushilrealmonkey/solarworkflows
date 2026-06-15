-- Allow invoices to be deleted even when generated document records reference them.
-- The document row and stored file remain attached to the customer/project history,
-- while the invoice-specific link is cleared by Postgres.
alter table public.documents
drop constraint if exists documents_invoice_id_fkey;

alter table public.documents
add constraint documents_invoice_id_fkey
foreign key (invoice_id)
references public.invoices(id)
on delete set null;
