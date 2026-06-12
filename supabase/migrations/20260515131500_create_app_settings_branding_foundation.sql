-- Step 18 app settings and branding foundation.
-- Adds organization-level branding/system preference fields and platform-level
-- settings storage. No frontend screens or business workflows are added here.

alter table public.organization_settings add column if not exists favicon_url text;
alter table public.organization_settings add column if not exists accent_color text;
alter table public.organization_settings add column if not exists font_family text;
alter table public.organization_settings add column if not exists invoice_prefix text default 'INV';
alter table public.organization_settings add column if not exists quotation_prefix text default 'QUO';
alter table public.organization_settings add column if not exists customer_prefix text default 'CUS';
alter table public.organization_settings add column if not exists project_prefix text default 'PROJ';
alter table public.organization_settings add column if not exists lead_prefix text default 'LEAD';
alter table public.organization_settings add column if not exists timezone text default 'Asia/Kolkata';
alter table public.organization_settings add column if not exists currency text default 'INR';
alter table public.organization_settings add column if not exists date_format text default 'DD/MM/YYYY';

alter table public.organization_settings add column if not exists company_logo_url text;
alter table public.organization_settings add column if not exists primary_color text;
alter table public.organization_settings add column if not exists secondary_color text;
alter table public.organization_settings add column if not exists address text;
alter table public.organization_settings add column if not exists contact_email text;
alter table public.organization_settings add column if not exists contact_phone text;
alter table public.organization_settings add column if not exists gst_number text;
alter table public.organization_settings add column if not exists updated_at timestamptz default now();

alter table public.organization_settings alter column invoice_prefix set default 'INV';
alter table public.organization_settings alter column quotation_prefix set default 'QUO';
alter table public.organization_settings alter column customer_prefix set default 'CUS';
alter table public.organization_settings alter column project_prefix set default 'PROJ';
alter table public.organization_settings alter column lead_prefix set default 'LEAD';
alter table public.organization_settings alter column timezone set default 'Asia/Kolkata';
alter table public.organization_settings alter column currency set default 'INR';
alter table public.organization_settings alter column date_format set default 'DD/MM/YYYY';
alter table public.organization_settings alter column updated_at set default now();

update public.organization_settings
set
  invoice_prefix = coalesce(invoice_prefix, 'INV'),
  quotation_prefix = coalesce(quotation_prefix, 'QUO'),
  customer_prefix = coalesce(customer_prefix, 'CUS'),
  project_prefix = coalesce(project_prefix, 'PROJ'),
  lead_prefix = coalesce(lead_prefix, 'LEAD'),
  timezone = coalesce(timezone, 'Asia/Kolkata'),
  currency = coalesce(currency, 'INR'),
  date_format = coalesce(date_format, 'DD/MM/YYYY'),
  updated_at = coalesce(updated_at, now());

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  setting_value jsonb,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.system_settings add column if not exists id uuid default gen_random_uuid();
alter table public.system_settings add column if not exists setting_key text;
alter table public.system_settings add column if not exists setting_value jsonb;
alter table public.system_settings add column if not exists description text;
alter table public.system_settings add column if not exists created_at timestamptz default now();
alter table public.system_settings add column if not exists updated_at timestamptz default now();

update public.system_settings
set id = gen_random_uuid()
where id is null;

update public.system_settings
set setting_key = 'legacy_setting_' || id::text
where setting_key is null;

alter table public.system_settings alter column id set default gen_random_uuid();
alter table public.system_settings alter column id set not null;
alter table public.system_settings alter column setting_key set not null;
alter table public.system_settings alter column created_at set default now();
alter table public.system_settings alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.system_settings'::regclass
      and contype = 'p'
  ) then
    alter table public.system_settings
    add constraint system_settings_pkey primary key (id);
  end if;
end;
$$;

create unique index if not exists system_settings_setting_key_unique
on public.system_settings (setting_key);

create unique index if not exists organization_settings_organization_id_unique
on public.organization_settings (organization_id);

drop trigger if exists set_organization_settings_updated_at on public.organization_settings;

create trigger set_organization_settings_updated_at
before update on public.organization_settings
for each row
execute function public.set_updated_at();

drop trigger if exists set_system_settings_updated_at on public.system_settings;

create trigger set_system_settings_updated_at
before update on public.system_settings
for each row
execute function public.set_updated_at();

-- Returns organization settings for the current user. Super admins may pass a
-- target organization id for support/admin workflows.
create or replace function public.get_organization_settings(target_organization_id uuid default null)
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_organization_id uuid;
  settings_record public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read organization settings'
      using errcode = '42501';
  end if;

  requested_organization_id := coalesce(target_organization_id, public.current_user_organization_id());

  if requested_organization_id is null then
    raise exception 'organization_id is required to read organization settings'
      using errcode = '23502';
  end if;

  if not public.is_super_admin() then
    if target_organization_id is not null
      and target_organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot read settings for another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('settings', 'view') then
      raise exception 'Missing permission to read organization settings'
        using errcode = '42501';
    end if;
  end if;

  select *
  into settings_record
  from public.organization_settings
  where organization_settings.organization_id = requested_organization_id
  limit 1;

  return settings_record;
end;
$$;

-- Updates only the authenticated user's current organization settings. Unknown
-- JSON keys are ignored so callers cannot write unrelated columns.
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
    company_logo_url = case when incoming_settings ? 'company_logo_url' then incoming_settings ->> 'company_logo_url' else organization_settings.company_logo_url end,
    favicon_url = case when incoming_settings ? 'favicon_url' then incoming_settings ->> 'favicon_url' else organization_settings.favicon_url end,
    primary_color = case when incoming_settings ? 'primary_color' then incoming_settings ->> 'primary_color' else organization_settings.primary_color end,
    secondary_color = case when incoming_settings ? 'secondary_color' then incoming_settings ->> 'secondary_color' else organization_settings.secondary_color end,
    accent_color = case when incoming_settings ? 'accent_color' then incoming_settings ->> 'accent_color' else organization_settings.accent_color end,
    font_family = case when incoming_settings ? 'font_family' then incoming_settings ->> 'font_family' else organization_settings.font_family end,
    address = case when incoming_settings ? 'address' then incoming_settings ->> 'address' else organization_settings.address end,
    contact_email = case when incoming_settings ? 'contact_email' then incoming_settings ->> 'contact_email' else organization_settings.contact_email end,
    contact_phone = case when incoming_settings ? 'contact_phone' then incoming_settings ->> 'contact_phone' else organization_settings.contact_phone end,
    gst_number = case when incoming_settings ? 'gst_number' then incoming_settings ->> 'gst_number' else organization_settings.gst_number end,
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

grant execute on function public.get_organization_settings(uuid) to authenticated;
grant execute on function public.update_organization_settings(jsonb) to authenticated;

alter table public.organization_settings enable row level security;
alter table public.system_settings enable row level security;

drop policy if exists "Super admins can manage organization settings" on public.organization_settings;
drop policy if exists "Organization users can view own organization settings" on public.organization_settings;
drop policy if exists "Organization admins can create own organization settings" on public.organization_settings;
drop policy if exists "Organization admins can update own organization settings" on public.organization_settings;
drop policy if exists "Organization admins can delete own organization settings" on public.organization_settings;
drop policy if exists "Organization users can view permitted organization settings" on public.organization_settings;
drop policy if exists "Organization users can create own organization settings" on public.organization_settings;
drop policy if exists "Organization users can update own organization settings" on public.organization_settings;
drop policy if exists "Organization users can delete own organization settings" on public.organization_settings;

-- Super admins can read and write organization settings across tenants.
create policy "Super admins can manage organization settings"
on public.organization_settings
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization admins and permitted staff can view only their own organization settings.
create policy "Organization users can view permitted organization settings"
on public.organization_settings
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'view')
);

-- Organization admins can create settings only for their own organization.
create policy "Organization users can create own organization settings"
on public.organization_settings
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'create')
);

-- Organization admins can update settings only for their own organization.
create policy "Organization users can update own organization settings"
on public.organization_settings
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
);

-- Organization settings deletion remains explicit and tenant-scoped.
create policy "Organization users can delete own organization settings"
on public.organization_settings
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'delete')
);

drop policy if exists "Super admins can manage system settings" on public.system_settings;

-- Platform-level settings are only available to super admins.
create policy "Super admins can manage system settings"
on public.system_settings
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());
