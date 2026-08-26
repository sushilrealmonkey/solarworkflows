-- Allow manual uploads to use a non-empty, company-specific document type.
-- Generated document workflows continue to validate their own supported types.

alter table public.documents
drop constraint if exists documents_document_type_check;

alter table public.documents
add constraint documents_document_type_check
check (nullif(btrim(document_type), '') is not null);
