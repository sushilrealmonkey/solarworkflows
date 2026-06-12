-- Step 8 site survey module foundation.
-- This creates the database layer for solar site surveys only. No frontend
-- screens or survey UI are added here.

create table if not exists public.site_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id),
  customer_id uuid references public.customers(id),
  survey_code text,
  scheduled_date date,
  scheduled_time time,
  completed_at timestamptz,
  survey_status text default 'scheduled',
  assigned_to uuid references public.users_profile(id),
  roof_type text,
  roof_area_sqft numeric,
  shadow_free_area_sqft numeric,
  structure_type text,
  electricity_bill_url text,
  site_photos jsonb default '[]'::jsonb,
  latitude numeric,
  longitude numeric,
  address_notes text,
  recommended_capacity_kw numeric,
  existing_meter_type text,
  sanctioned_load_kw numeric,
  phase_type text,
  remarks text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.site_surveys add column if not exists id uuid default gen_random_uuid();
alter table public.site_surveys add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.site_surveys add column if not exists lead_id uuid references public.leads(id);
alter table public.site_surveys add column if not exists customer_id uuid references public.customers(id);
alter table public.site_surveys add column if not exists survey_code text;
alter table public.site_surveys add column if not exists scheduled_date date;
alter table public.site_surveys add column if not exists scheduled_time time;
alter table public.site_surveys add column if not exists completed_at timestamptz;
alter table public.site_surveys add column if not exists survey_status text default 'scheduled';
alter table public.site_surveys add column if not exists assigned_to uuid references public.users_profile(id);
alter table public.site_surveys add column if not exists roof_type text;
alter table public.site_surveys add column if not exists roof_area_sqft numeric;
alter table public.site_surveys add column if not exists shadow_free_area_sqft numeric;
alter table public.site_surveys add column if not exists structure_type text;
alter table public.site_surveys add column if not exists electricity_bill_url text;
alter table public.site_surveys add column if not exists site_photos jsonb default '[]'::jsonb;
alter table public.site_surveys add column if not exists latitude numeric;
alter table public.site_surveys add column if not exists longitude numeric;
alter table public.site_surveys add column if not exists address_notes text;
alter table public.site_surveys add column if not exists recommended_capacity_kw numeric;
alter table public.site_surveys add column if not exists existing_meter_type text;
alter table public.site_surveys add column if not exists sanctioned_load_kw numeric;
alter table public.site_surveys add column if not exists phase_type text;
alter table public.site_surveys add column if not exists remarks text;
alter table public.site_surveys add column if not exists created_by uuid references public.users_profile(id);
alter table public.site_surveys add column if not exists created_at timestamptz default now();
alter table public.site_surveys add column if not exists updated_at timestamptz default now();

alter table public.site_surveys alter column id set default gen_random_uuid();
alter table public.site_surveys alter column organization_id set not null;
alter table public.site_surveys alter column survey_status set default 'scheduled';
alter table public.site_surveys alter column site_photos set default '[]'::jsonb;
alter table public.site_surveys alter column created_at set default now();
alter table public.site_surveys alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_surveys_status_check'
      and conrelid = 'public.site_surveys'::regclass
  ) then
    alter table public.site_surveys
    add constraint site_surveys_status_check
    check (survey_status in (
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
      'rescheduled'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_surveys_site_photos_array_check'
      and conrelid = 'public.site_surveys'::regclass
  ) then
    alter table public.site_surveys
    add constraint site_surveys_site_photos_array_check
    check (jsonb_typeof(site_photos) = 'array');
  end if;
end;
$$;

create index if not exists site_surveys_organization_id_idx
on public.site_surveys (organization_id);

create index if not exists site_surveys_survey_code_idx
on public.site_surveys (survey_code);

create index if not exists site_surveys_lead_id_idx
on public.site_surveys (lead_id);

create index if not exists site_surveys_customer_id_idx
on public.site_surveys (customer_id);

create index if not exists site_surveys_assigned_to_idx
on public.site_surveys (assigned_to);

create index if not exists site_surveys_survey_status_idx
on public.site_surveys (survey_status);

create index if not exists site_surveys_scheduled_date_idx
on public.site_surveys (scheduled_date);

create unique index if not exists site_surveys_organization_survey_code_unique
on public.site_surveys (organization_id, survey_code)
where survey_code is not null;

-- Generates the next site survey code inside one organization. The advisory
-- lock keeps SURV-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_site_survey_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a site survey code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('site_survey:' || target_organization_id::text, 0));

  select coalesce(max(substring(site_surveys.survey_code from '^SURV-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.site_surveys
  where site_surveys.organization_id = target_organization_id
    and site_surveys.survey_code ~ '^SURV-[0-9]+$';

  return 'SURV-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills survey_code when the application does not provide one.
create or replace function public.set_site_survey_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.survey_code is null or trim(new.survey_code) = '' then
    new.survey_code := public.generate_site_survey_code(new.organization_id);
  end if;

  return new;
end;
$$;

-- Ensures linked users, leads, and customers belong to the same organization as
-- the survey. This blocks accidental cross-tenant references.
create or replace function public.set_site_survey_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the site survey'
      using errcode = '23503';
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.assigned_to
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'assigned_to must belong to the same organization as the site survey'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the site survey'
      using errcode = '23503';
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the site survey'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_site_surveys_survey_code on public.site_surveys;

create trigger set_site_surveys_survey_code
before insert on public.site_surveys
for each row
execute function public.set_site_survey_code();

drop trigger if exists set_site_surveys_tenant_links on public.site_surveys;

create trigger set_site_surveys_tenant_links
before insert or update on public.site_surveys
for each row
execute function public.set_site_survey_tenant_links();

drop trigger if exists set_site_surveys_updated_at on public.site_surveys;

create trigger set_site_surveys_updated_at
before update on public.site_surveys
for each row
execute function public.set_updated_at();

-- Marks a site survey complete. The caller must have site_surveys update access
-- inside the survey organization unless they are a super admin.
create or replace function public.complete_site_survey(survey_id uuid)
returns public.site_surveys
language plpgsql
security definer
set search_path = public
as $$
declare
  survey_record public.site_surveys%rowtype;
begin
  select *
  into survey_record
  from public.site_surveys
  where site_surveys.id = survey_id
  for update;

  if not found then
    raise exception 'Site survey not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if survey_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot complete a site survey from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('site_surveys', 'update') then
      raise exception 'Missing site_surveys update permission'
        using errcode = '42501';
    end if;
  end if;

  update public.site_surveys
  set
    survey_status = 'completed',
    completed_at = coalesce(public.site_surveys.completed_at, now()),
    updated_at = now()
  where public.site_surveys.id = survey_record.id
  returning * into survey_record;

  return survey_record;
end;
$$;

grant execute on function public.complete_site_survey(uuid) to authenticated;

alter table public.site_surveys enable row level security;

-- Super admins can read and write every site survey across every organization.
create policy "Super admins can manage site surveys"
on public.site_surveys
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view site surveys in their organization with site_surveys view permission.
create policy "Organization users can view organization site surveys"
on public.site_surveys
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys', 'view')
);

-- Organization users can create site surveys only inside their organization with site_surveys create permission.
create policy "Organization users can create organization site surveys"
on public.site_surveys
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys', 'create')
);

-- Organization users can update site surveys only inside their organization with site_surveys update permission.
create policy "Organization users can update organization site surveys"
on public.site_surveys
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys', 'update')
);

-- Site survey deletion requires explicit site_surveys delete permission and never crosses organizations.
create policy "Organization users can delete organization site surveys"
on public.site_surveys
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys', 'delete')
);
