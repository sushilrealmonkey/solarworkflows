alter table public.site_surveys
  drop column if exists structure_type,
  drop column if exists existing_meter_type;

alter table public.quotations
  drop column if exists structure_type,
  drop column if exists summary_structure_type;
