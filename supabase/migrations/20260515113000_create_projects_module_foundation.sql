-- Step 10 project / installation module foundation.
-- This migration creates confirmed solar installation projects only. No frontend
-- screens or project workflow UI are added here.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_code text,
  customer_id uuid not null references public.customers(id),
  lead_id uuid references public.leads(id),
  quotation_id uuid references public.quotations(id),
  site_survey_id uuid references public.site_surveys(id),
  project_name text,
  system_capacity_kw numeric,
  project_type text default 'residential',
  installation_address text,
  city text,
  district text,
  state text,
  pincode text,
  project_status text default 'created',
  priority text default 'medium',
  start_date date,
  expected_completion_date date,
  completed_at timestamptz,
  assigned_project_manager uuid references public.users_profile(id),
  assigned_installation_team jsonb default '[]'::jsonb,
  notes text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.projects add column if not exists id uuid default gen_random_uuid();
alter table public.projects add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.projects add column if not exists project_code text;
alter table public.projects add column if not exists customer_id uuid references public.customers(id);
alter table public.projects add column if not exists lead_id uuid references public.leads(id);
alter table public.projects add column if not exists quotation_id uuid references public.quotations(id);
alter table public.projects add column if not exists site_survey_id uuid references public.site_surveys(id);
alter table public.projects add column if not exists project_name text;
alter table public.projects add column if not exists system_capacity_kw numeric;
alter table public.projects add column if not exists project_type text default 'residential';
alter table public.projects add column if not exists installation_address text;
alter table public.projects add column if not exists city text;
alter table public.projects add column if not exists district text;
alter table public.projects add column if not exists state text;
alter table public.projects add column if not exists pincode text;
alter table public.projects add column if not exists project_status text default 'created';
alter table public.projects add column if not exists priority text default 'medium';
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists expected_completion_date date;
alter table public.projects add column if not exists completed_at timestamptz;
alter table public.projects add column if not exists assigned_project_manager uuid references public.users_profile(id);
alter table public.projects add column if not exists assigned_installation_team jsonb default '[]'::jsonb;
alter table public.projects add column if not exists notes text;
alter table public.projects add column if not exists created_by uuid references public.users_profile(id);
alter table public.projects add column if not exists created_at timestamptz default now();
alter table public.projects add column if not exists updated_at timestamptz default now();

alter table public.projects alter column id set default gen_random_uuid();
alter table public.projects alter column organization_id set not null;
alter table public.projects alter column customer_id set not null;
alter table public.projects alter column project_type set default 'residential';
alter table public.projects alter column project_status set default 'created';
alter table public.projects alter column priority set default 'medium';
alter table public.projects alter column assigned_installation_team set default '[]'::jsonb;
alter table public.projects alter column created_at set default now();
alter table public.projects alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_status_check
    check (project_status in (
      'created',
      'material_pending',
      'installation_scheduled',
      'installation_in_progress',
      'installation_completed',
      'inspection_pending',
      'inspection_completed',
      'net_metering_pending',
      'commissioned',
      'cancelled',
      'on_hold'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_type_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_type_check
    check (project_type in ('residential', 'commercial', 'industrial', 'government', 'other'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_priority_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_assigned_installation_team_array_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_assigned_installation_team_array_check
    check (jsonb_typeof(assigned_installation_team) = 'array');
  end if;
end;
$$;

create index if not exists projects_organization_id_idx
on public.projects (organization_id);

create index if not exists projects_project_code_idx
on public.projects (project_code);

create index if not exists projects_customer_id_idx
on public.projects (customer_id);

create index if not exists projects_quotation_id_idx
on public.projects (quotation_id);

create index if not exists projects_project_status_idx
on public.projects (project_status);

create index if not exists projects_assigned_project_manager_idx
on public.projects (assigned_project_manager);

create index if not exists projects_start_date_idx
on public.projects (start_date);

create index if not exists projects_expected_completion_date_idx
on public.projects (expected_completion_date);

create unique index if not exists projects_organization_project_code_unique
on public.projects (organization_id, project_code)
where project_code is not null;

-- One accepted quotation should normally create one installation project.
create unique index if not exists projects_quotation_id_unique
on public.projects (quotation_id)
where quotation_id is not null;

-- Generates the next project code inside one organization. The advisory lock
-- keeps PROJ-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_project_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a project code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('project:' || target_organization_id::text, 0));

  select coalesce(max(substring(projects.project_code from '^PROJ-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.projects
  where projects.organization_id = target_organization_id
    and projects.project_code ~ '^PROJ-[0-9]+$';

  return 'PROJ-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills project_code when the application does not provide one.
create or replace function public.set_project_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_code is null or trim(new.project_code) = '' then
    new.project_code := public.generate_project_code(new.organization_id);
  end if;

  return new;
end;
$$;

-- Ensures linked customers, leads, quotations, surveys, and users all belong to
-- the same organization as the project.
create or replace function public.set_project_tenant_links()
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

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
  ) then
    raise exception 'quotation_id must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  if new.site_survey_id is not null and not exists (
    select 1
    from public.site_surveys
    where site_surveys.id = new.site_survey_id
      and site_surveys.organization_id = new.organization_id
  ) then
    raise exception 'site_survey_id must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  if new.assigned_project_manager is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.assigned_project_manager
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'assigned_project_manager must belong to the same organization as the project'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_projects_project_code on public.projects;

create trigger set_projects_project_code
before insert on public.projects
for each row
execute function public.set_project_code();

drop trigger if exists set_projects_tenant_links on public.projects;

create trigger set_projects_tenant_links
before insert or update on public.projects
for each row
execute function public.set_project_tenant_links();

drop trigger if exists set_projects_updated_at on public.projects;

create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

-- Creates a project from an accepted quotation. It copies the customer, lead,
-- site survey, and system capacity from the quotation into a new project.
create or replace function public.create_project_from_quotation(target_quotation_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
  project_record public.projects%rowtype;
  current_profile_id uuid;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if quotation_record.status <> 'accepted' then
    raise exception 'Only accepted quotations can become projects'
      using errcode = '23514';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot create a project from another organization quotation'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('projects', 'create') then
      raise exception 'Missing projects create permission'
        using errcode = '42501';
    end if;
  end if;

  select *
  into customer_record
  from public.customers
  where customers.id = quotation_record.customer_id
    and customers.organization_id = quotation_record.organization_id;

  if not found then
    raise exception 'Quotation customer was not found in the same organization'
      using errcode = '23503';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  insert into public.projects (
    organization_id,
    customer_id,
    lead_id,
    quotation_id,
    site_survey_id,
    project_name,
    system_capacity_kw,
    project_type,
    installation_address,
    city,
    district,
    state,
    pincode,
    project_status,
    priority,
    notes,
    created_by
  )
  values (
    quotation_record.organization_id,
    quotation_record.customer_id,
    quotation_record.lead_id,
    quotation_record.id,
    quotation_record.site_survey_id,
    customer_record.full_name || ' Solar Installation - ' || coalesce(quotation_record.quotation_code, 'Quotation'),
    quotation_record.system_capacity_kw,
    coalesce(customer_record.customer_type, 'residential'),
    coalesce(customer_record.address_line_1, ''),
    customer_record.city,
    customer_record.district,
    customer_record.state,
    customer_record.pincode,
    'created',
    'medium',
    quotation_record.notes,
    current_profile_id
  )
  returning * into project_record;

  return project_record;
end;
$$;

-- Updates project_status after validating the requested status. Completion-like
-- statuses fill completed_at once.
create or replace function public.update_project_status(target_project_id uuid, new_status text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
begin
  if new_status not in (
    'created',
    'material_pending',
    'installation_scheduled',
    'installation_in_progress',
    'installation_completed',
    'inspection_pending',
    'inspection_completed',
    'net_metering_pending',
    'commissioned',
    'cancelled',
    'on_hold'
  ) then
    raise exception 'Unsupported project status: %', new_status
      using errcode = '23514';
  end if;

  select *
  into project_record
  from public.projects
  where projects.id = target_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if project_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot update a project from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('projects', 'update') then
      raise exception 'Missing projects update permission'
        using errcode = '42501';
    end if;
  end if;

  update public.projects
  set
    project_status = new_status,
    completed_at = case
      when new_status in ('installation_completed', 'commissioned')
        then coalesce(public.projects.completed_at, now())
      else public.projects.completed_at
    end,
    updated_at = now()
  where public.projects.id = target_project_id
  returning * into project_record;

  return project_record;
end;
$$;

grant execute on function public.create_project_from_quotation(uuid) to authenticated;
grant execute on function public.update_project_status(uuid, text) to authenticated;

alter table public.projects enable row level security;

-- Super admins can read and write every project across every organization.
create policy "Super admins can manage projects"
on public.projects
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view projects in their organization with projects view permission.
create policy "Organization users can view organization projects"
on public.projects
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects', 'view')
);

-- Organization users can create projects only inside their organization with projects create permission.
create policy "Organization users can create organization projects"
on public.projects
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects', 'create')
);

-- Organization users can update projects only inside their organization with projects update permission.
create policy "Organization users can update organization projects"
on public.projects
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects', 'update')
);

-- Project deletion requires explicit projects delete permission and never crosses organizations.
create policy "Organization users can delete organization projects"
on public.projects
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects', 'delete')
);
