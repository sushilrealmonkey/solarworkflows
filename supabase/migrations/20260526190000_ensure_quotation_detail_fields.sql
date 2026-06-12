-- Ensures the quotation detail fields edited by the proposal form are present.
-- This is idempotent so environments that missed an earlier migration can catch up.

alter table public.quotations add column if not exists customer_type text;
alter table public.quotations add column if not exists customer_city_village text;
alter table public.quotations add column if not exists discom text;
alter table public.quotations add column if not exists installation_location text;

alter table public.quotations add column if not exists summary_dcdb_included boolean;
alter table public.quotations add column if not exists summary_acdb_included boolean;
alter table public.quotations add column if not exists summary_earthing_count numeric;
alter table public.quotations add column if not exists summary_lightning_arrestor_included boolean;
alter table public.quotations add column if not exists summary_remote_monitoring_included boolean;

notify pgrst, 'reload schema';
