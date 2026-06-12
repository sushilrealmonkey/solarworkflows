-- Ensures every quotation detail field edited by the proposal form exists before saving.
-- This catches environments that applied only part of the proposal-field migrations.

alter table public.quotations add column if not exists quotation_detail_snapshot jsonb default '{}'::jsonb;

alter table public.quotations add column if not exists customer_type text;
alter table public.quotations add column if not exists customer_city_village text;
alter table public.quotations add column if not exists discom text;
alter table public.quotations add column if not exists consumer_number text;
alter table public.quotations add column if not exists customer_electricity_bill_url text;
alter table public.quotations add column if not exists installation_location text;
alter table public.quotations add column if not exists site_type text;
alter table public.quotations add column if not exists expected_annual_generation_kwh numeric;
alter table public.quotations add column if not exists generation_notes text;
alter table public.quotations add column if not exists material_items jsonb default '[]'::jsonb;

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

alter table public.quotations add column if not exists work_description text;
alter table public.quotations add column if not exists pricing_total_rate numeric;
alter table public.quotations add column if not exists pricing_tax_included boolean default true;
alter table public.quotations add column if not exists pricing_remarks text;
alter table public.quotations add column if not exists maintenance_duration text;
alter table public.quotations add column if not exists maintenance_included boolean default true;
alter table public.quotations add column if not exists payment_advance_percentage numeric default 70;
alter table public.quotations add column if not exists payment_installation_percentage numeric default 20;
alter table public.quotations add column if not exists payment_generation_percentage numeric default 10;

alter table public.quotations add column if not exists commercial_price_basis text;
alter table public.quotations add column if not exists commercial_gst_terms text;
alter table public.quotations add column if not exists commercial_security_deposit_terms text;
alter table public.quotations add column if not exists commercial_transit_insurance text;
alter table public.quotations add column if not exists commercial_site_storage_insurance text;
alter table public.quotations add column if not exists commercial_project_initiation text;
alter table public.quotations add column if not exists commercial_warranty_applicability text;

alter table public.quotations add column if not exists proposal_important_considerations text;
alter table public.quotations add column if not exists proposal_client_responsibilities text;
alter table public.quotations add column if not exists proposal_exclusions text;
alter table public.quotations add column if not exists proposal_included_scope text;

alter table public.quotations alter column quotation_detail_snapshot set default '{}'::jsonb;
alter table public.quotations alter column material_items set default '[]'::jsonb;
alter table public.quotations alter column pricing_tax_included set default true;
alter table public.quotations alter column maintenance_included set default true;
alter table public.quotations alter column payment_advance_percentage set default 70;
alter table public.quotations alter column payment_installation_percentage set default 20;
alter table public.quotations alter column payment_generation_percentage set default 10;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_detail_snapshot_object_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_detail_snapshot_object_check
    check (quotation_detail_snapshot is null or jsonb_typeof(quotation_detail_snapshot) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_material_items_array_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_material_items_array_check
    check (material_items is null or jsonb_typeof(material_items) = 'array');
  end if;
end;
$$;

notify pgrst, 'reload schema';
