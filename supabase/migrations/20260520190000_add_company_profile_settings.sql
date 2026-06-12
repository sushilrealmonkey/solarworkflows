-- Adds reusable company, contact, and bank details to organization settings.
-- These values are tenant-scoped and are used by generated business documents.

alter table public.organization_settings add column if not exists company_name text;
alter table public.organization_settings add column if not exists company_details text;
alter table public.organization_settings add column if not exists contact_person text;
alter table public.organization_settings add column if not exists bank_account_holder_name text;
alter table public.organization_settings add column if not exists bank_name text;
alter table public.organization_settings add column if not exists bank_ifsc_code text;
alter table public.organization_settings add column if not exists bank_account_number text;
alter table public.organization_settings add column if not exists bank_account_type text;

update public.organization_settings
set company_name = organizations.name
from public.organizations
where organization_settings.organization_id = organizations.id
  and nullif(trim(coalesce(organization_settings.company_name, '')), '') is null;

create or replace function public.update_organization_settings(settings jsonb)
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  incoming_settings jsonb := coalesce(settings, '{}'::jsonb);
  updated_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update organization settings'
      using errcode = '42501';
  end if;

  if jsonb_typeof(incoming_settings) <> 'object' then
    raise exception 'settings must be a JSON object'
      using errcode = '22023';
  end if;

  if not public.user_has_permission('settings', 'update') then
    raise exception 'Missing permission to update organization settings'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  update public.organization_settings as organization_settings
  set
    company_name = case when incoming_settings ? 'company_name' then incoming_settings ->> 'company_name' else organization_settings.company_name end,
    company_details = case when incoming_settings ? 'company_details' then incoming_settings ->> 'company_details' else organization_settings.company_details end,
    company_logo_url = case when incoming_settings ? 'company_logo_url' then incoming_settings ->> 'company_logo_url' else organization_settings.company_logo_url end,
    favicon_url = case when incoming_settings ? 'favicon_url' then incoming_settings ->> 'favicon_url' else organization_settings.favicon_url end,
    primary_color = case when incoming_settings ? 'primary_color' then incoming_settings ->> 'primary_color' else organization_settings.primary_color end,
    secondary_color = case when incoming_settings ? 'secondary_color' then incoming_settings ->> 'secondary_color' else organization_settings.secondary_color end,
    accent_color = case when incoming_settings ? 'accent_color' then incoming_settings ->> 'accent_color' else organization_settings.accent_color end,
    font_family = case when incoming_settings ? 'font_family' then incoming_settings ->> 'font_family' else organization_settings.font_family end,
    address = case when incoming_settings ? 'address' then incoming_settings ->> 'address' else organization_settings.address end,
    contact_person = case when incoming_settings ? 'contact_person' then incoming_settings ->> 'contact_person' else organization_settings.contact_person end,
    contact_email = case when incoming_settings ? 'contact_email' then incoming_settings ->> 'contact_email' else organization_settings.contact_email end,
    contact_phone = case when incoming_settings ? 'contact_phone' then incoming_settings ->> 'contact_phone' else organization_settings.contact_phone end,
    gst_number = case when incoming_settings ? 'gst_number' then incoming_settings ->> 'gst_number' else organization_settings.gst_number end,
    bank_account_holder_name = case when incoming_settings ? 'bank_account_holder_name' then incoming_settings ->> 'bank_account_holder_name' else organization_settings.bank_account_holder_name end,
    bank_name = case when incoming_settings ? 'bank_name' then incoming_settings ->> 'bank_name' else organization_settings.bank_name end,
    bank_ifsc_code = case when incoming_settings ? 'bank_ifsc_code' then incoming_settings ->> 'bank_ifsc_code' else organization_settings.bank_ifsc_code end,
    bank_account_number = case when incoming_settings ? 'bank_account_number' then incoming_settings ->> 'bank_account_number' else organization_settings.bank_account_number end,
    bank_account_type = case when incoming_settings ? 'bank_account_type' then incoming_settings ->> 'bank_account_type' else organization_settings.bank_account_type end,
    invoice_prefix = case when incoming_settings ? 'invoice_prefix' then incoming_settings ->> 'invoice_prefix' else organization_settings.invoice_prefix end,
    quotation_prefix = case when incoming_settings ? 'quotation_prefix' then incoming_settings ->> 'quotation_prefix' else organization_settings.quotation_prefix end,
    customer_prefix = case when incoming_settings ? 'customer_prefix' then incoming_settings ->> 'customer_prefix' else organization_settings.customer_prefix end,
    project_prefix = case when incoming_settings ? 'project_prefix' then incoming_settings ->> 'project_prefix' else organization_settings.project_prefix end,
    lead_prefix = case when incoming_settings ? 'lead_prefix' then incoming_settings ->> 'lead_prefix' else organization_settings.lead_prefix end,
    timezone = case when incoming_settings ? 'timezone' then incoming_settings ->> 'timezone' else organization_settings.timezone end,
    currency = case when incoming_settings ? 'currency' then incoming_settings ->> 'currency' else organization_settings.currency end,
    date_format = case when incoming_settings ? 'date_format' then incoming_settings ->> 'date_format' else organization_settings.date_format end
  where organization_settings.organization_id = current_organization_id
  returning * into updated_settings;

  return updated_settings;
end;
$$;

grant execute on function public.update_organization_settings(jsonb) to authenticated;
