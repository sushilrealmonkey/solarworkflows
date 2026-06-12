-- Adds nullable proposal scope fields used only by Technical & Commercial Proposal quotations.
-- Basic/standard quotation records keep these fields empty.

alter table public.quotations add column if not exists proposal_important_considerations text;
alter table public.quotations add column if not exists proposal_client_responsibilities text;
alter table public.quotations add column if not exists proposal_exclusions text;
alter table public.quotations add column if not exists proposal_included_scope text;
