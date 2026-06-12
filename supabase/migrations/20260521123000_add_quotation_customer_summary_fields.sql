-- Adds nullable customer-facing commercial summary fields for technical and
-- commercial proposal PDFs. Existing quotations and item tables remain intact.

alter table public.quotations add column if not exists summary_module_brand text;
alter table public.quotations add column if not exists summary_module_wattage numeric;
alter table public.quotations add column if not exists summary_plant_size_kw numeric;
alter table public.quotations add column if not exists summary_inverter_brand text;
alter table public.quotations add column if not exists summary_structure_type text;
alter table public.quotations add column if not exists summary_dcdb_included boolean;
alter table public.quotations add column if not exists summary_acdb_included boolean;
alter table public.quotations add column if not exists summary_earthing_count numeric;
alter table public.quotations add column if not exists summary_lightning_arrestor_included boolean;
alter table public.quotations add column if not exists summary_remote_monitoring_included boolean;
alter table public.quotations add column if not exists summary_total_turnkey_cost numeric;
alter table public.quotations add column if not exists summary_amount_in_words text;
