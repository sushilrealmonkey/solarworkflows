-- Extends quotations with editable commercial quote presentation fields.
-- These fields are nullable/defaulted so existing quotation workflows keep working.

alter table public.quotations add column if not exists company_name text;
alter table public.quotations add column if not exists company_gstin text;
alter table public.quotations add column if not exists company_mobile text;
alter table public.quotations add column if not exists tagline text;
alter table public.quotations add column if not exists certification_line text;

alter table public.quotations add column if not exists quotation_title text;
alter table public.quotations add column if not exists system_type text;
alter table public.quotations add column if not exists module_category text;

alter table public.quotations add column if not exists customer_type text;
alter table public.quotations add column if not exists customer_city_village text;
alter table public.quotations add column if not exists discom text;
alter table public.quotations add column if not exists consumer_number text;
alter table public.quotations add column if not exists customer_electricity_bill_url text;

alter table public.quotations add column if not exists material_items jsonb default '[]'::jsonb;

alter table public.quotations add column if not exists work_description text;
alter table public.quotations add column if not exists pricing_total_rate numeric;
alter table public.quotations add column if not exists pricing_tax_included boolean default true;
alter table public.quotations add column if not exists pricing_remarks text;

alter table public.quotations add column if not exists maintenance_duration text;
alter table public.quotations add column if not exists maintenance_included boolean default true;

alter table public.quotations add column if not exists payment_advance_percentage numeric default 70;
alter table public.quotations add column if not exists payment_installation_percentage numeric default 20;
alter table public.quotations add column if not exists payment_generation_percentage numeric default 10;

alter table public.quotations add column if not exists bank_company_name text;
alter table public.quotations add column if not exists bank_gst_number text;
alter table public.quotations add column if not exists bank_name text;
alter table public.quotations add column if not exists bank_ifsc_code text;
alter table public.quotations add column if not exists bank_account_number text;
alter table public.quotations add column if not exists bank_account_type text;

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
    where conname = 'quotations_material_items_array_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_material_items_array_check
    check (jsonb_typeof(material_items) = 'array');
  end if;
end;
$$;
