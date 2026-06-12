-- Adds nullable commercial terms used only by Technical & Commercial Proposal quotations.
-- Keeping these fields nullable preserves Basic/standard quotation behavior.

alter table public.quotations add column if not exists commercial_price_basis text;
alter table public.quotations add column if not exists commercial_gst_terms text;
alter table public.quotations add column if not exists commercial_security_deposit_terms text;
alter table public.quotations add column if not exists commercial_transit_insurance text;
alter table public.quotations add column if not exists commercial_site_storage_insurance text;
alter table public.quotations add column if not exists commercial_project_initiation text;
alter table public.quotations add column if not exists commercial_warranty_applicability text;
