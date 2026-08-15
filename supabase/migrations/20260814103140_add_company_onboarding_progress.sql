-- Post-workspace Bizlee onboarding state.
--
-- Rollout order is intentional:
--   1. Create the table.
--   2. Prepare the enrichment triggers and tenant-scoped RPCs.
--   3. Under one short companies-table lock, mark every existing company as
--      completed and install the future-company initializer.
-- This prevents existing tenants from entering the new onboarding flow and
-- leaves no company-provisioning gap between the backfill and initializer.

create table public.company_onboarding_progress (
  company_id uuid primary key references public.companies(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  -- SET NULL intentionally avoids blocking profile deletion. The separate
  -- assignment timestamp survives that deletion and prevents a later Admin
  -- from being captured automatically as a replacement owner.
  setup_owner_profile_id uuid references public.users_profile(id) on delete set null,
  setup_owner_assigned_at timestamptz,
  onboarding_version integer not null default 1 check (onboarding_version > 0),
  status text not null check (
    status in ('pending', 'in_progress', 'deferred', 'completed')
  ),
  current_step text not null check (
    current_step in ('welcome', 'company', 'products', 'product_entry', 'team', 'ready')
  ),
  started_at timestamptz,
  deferred_at timestamptz,
  completed_at timestamptz,
  completed_by_profile_id uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_onboarding_setup_owner_assignment_consistent check (
    setup_owner_profile_id is null or setup_owner_assigned_at is not null
  )
);

create index company_onboarding_progress_organization_id_idx
on public.company_onboarding_progress (organization_id)
where organization_id is not null;

create index company_onboarding_progress_setup_owner_profile_id_idx
on public.company_onboarding_progress (setup_owner_profile_id)
where setup_owner_profile_id is not null;

create index company_onboarding_progress_completed_by_profile_id_idx
on public.company_onboarding_progress (completed_by_profile_id)
where completed_by_profile_id is not null;

create trigger set_company_onboarding_progress_updated_at
before update on public.company_onboarding_progress
for each row execute function public.set_updated_at();

create schema if not exists private;

-- Every company provisioned after this migration starts pending. Provisioning
-- RPCs create their company, organization, profile, and role in one transaction;
-- the following triggers enrich this row as those records become available.
create or replace function private.initialize_company_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_onboarding_progress (
    company_id,
    onboarding_version,
    status,
    current_step
  )
  values (new.id, 1, 'pending', 'welcome')
  on conflict (company_id) do nothing;

  return new;
end;
$$;

create or replace function private.attach_onboarding_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is not null then
    update public.company_onboarding_progress
    set organization_id = new.id
    where company_id = new.company_id
      and organization_id is distinct from new.id;
  end if;

  return new;
end;
$$;

create or replace function private.capture_onboarding_setup_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_profile public.users_profile%rowtype;
  assigned_role public.roles%rowtype;
begin
  if new.user_profile_id is null then
    return new;
  end if;

  select *
  into assigned_profile
  from public.users_profile
  where users_profile.id = new.user_profile_id;

  select *
  into assigned_role
  from public.roles
  where roles.id = new.role_id;

  if assigned_profile.company_id is not null
    and assigned_role.role_key = 'admin'
    and assigned_role.company_id = assigned_profile.company_id then
    update public.company_onboarding_progress
    set
      organization_id = coalesce(
        company_onboarding_progress.organization_id,
        assigned_profile.organization_id
      ),
      setup_owner_profile_id = assigned_profile.id,
      setup_owner_assigned_at = statement_timestamp()
    where company_id = assigned_profile.company_id
      -- Before first assignment both values are NULL, so the first compatible
      -- Admin role wins atomically. After owner deletion the FK becomes NULL
      -- but setup_owner_assigned_at remains set, so no later role can win.
      and setup_owner_profile_id is null
      and setup_owner_assigned_at is null
      and status in ('pending', 'in_progress', 'deferred');
  end if;

  return new;
end;
$$;

revoke all on function private.initialize_company_onboarding() from public, anon, authenticated;
revoke all on function private.attach_onboarding_organization() from public, anon, authenticated;
revoke all on function private.capture_onboarding_setup_owner() from public, anon, authenticated;

create trigger attach_onboarding_organization
after insert or update of company_id on public.organizations
for each row execute function private.attach_onboarding_organization();

create trigger capture_onboarding_setup_owner
after insert or update of role_id, user_profile_id on public.user_roles
for each row execute function private.capture_onboarding_setup_owner();

alter table public.company_onboarding_progress enable row level security;

create policy "Active company members can read onboarding progress"
on public.company_onboarding_progress
for select
to authenticated
using (
  exists (
    select 1
    from public.users_profile
    where users_profile.auth_user_id = (select auth.uid())
      and users_profile.status = 'active'
      and users_profile.company_id = company_onboarding_progress.company_id
  )
);

revoke all on table public.company_onboarding_progress from anon, authenticated;
grant select on table public.company_onboarding_progress to authenticated;

create or replace function public.get_current_company_onboarding_progress()
returns public.company_onboarding_progress
language sql
stable
security invoker
set search_path = ''
as $$
  select progress.*
  from public.company_onboarding_progress as progress
  join public.users_profile as profile
    on profile.company_id = progress.company_id
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;
$$;

create or replace function public.start_current_company_onboarding()
returns public.company_onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_progress public.company_onboarding_progress%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to start onboarding'
      using errcode = '42501';
  end if;

  update public.company_onboarding_progress as progress
  set
    status = 'in_progress',
    current_step = 'company',
    started_at = coalesce(progress.started_at, statement_timestamp()),
    deferred_at = null
  from public.users_profile as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.id = progress.setup_owner_profile_id
    and profile.company_id = progress.company_id
    and progress.status in ('pending', 'in_progress', 'deferred')
  returning progress.* into updated_progress;

  if not found then
    raise exception 'Only the active setup owner can start company onboarding'
      using errcode = '42501';
  end if;

  return updated_progress;
end;
$$;

create or replace function public.advance_current_company_onboarding(next_step text)
returns public.company_onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_step text := nullif(btrim(next_step), '');
  updated_progress public.company_onboarding_progress%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to advance onboarding'
      using errcode = '42501';
  end if;

  if normalized_step is null or normalized_step not in (
    'welcome', 'company', 'products', 'product_entry', 'team', 'ready'
  ) then
    raise exception 'Unsupported onboarding step'
      using errcode = '22023';
  end if;

  update public.company_onboarding_progress as progress
  set
    status = 'in_progress',
    current_step = normalized_step,
    started_at = coalesce(progress.started_at, statement_timestamp()),
    deferred_at = null
  from public.users_profile as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.id = progress.setup_owner_profile_id
    and profile.company_id = progress.company_id
    and progress.status in ('pending', 'in_progress', 'deferred')
  returning progress.* into updated_progress;

  if not found then
    raise exception 'Only the active setup owner can advance company onboarding'
      using errcode = '42501';
  end if;

  return updated_progress;
end;
$$;

create or replace function public.defer_current_company_onboarding()
returns public.company_onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_progress public.company_onboarding_progress%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to defer onboarding'
      using errcode = '42501';
  end if;

  update public.company_onboarding_progress as progress
  set
    status = 'deferred',
    deferred_at = statement_timestamp()
  from public.users_profile as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.id = progress.setup_owner_profile_id
    and profile.company_id = progress.company_id
    and progress.status in ('pending', 'in_progress', 'deferred')
  returning progress.* into updated_progress;

  if not found then
    raise exception 'Only the active setup owner can defer company onboarding'
      using errcode = '42501';
  end if;

  return updated_progress;
end;
$$;

create or replace function public.complete_current_company_onboarding()
returns public.company_onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_progress public.company_onboarding_progress%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to complete onboarding'
      using errcode = '42501';
  end if;

  update public.company_onboarding_progress as progress
  set
    status = 'completed',
    current_step = 'ready',
    started_at = coalesce(progress.started_at, statement_timestamp()),
    completed_at = statement_timestamp(),
    completed_by_profile_id = profile.id,
    deferred_at = null
  from public.users_profile as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.id = progress.setup_owner_profile_id
    and profile.company_id = progress.company_id
    and progress.status in ('pending', 'in_progress', 'deferred')
  returning progress.* into updated_progress;

  if not found then
    raise exception 'Only the active setup owner can complete company onboarding'
      using errcode = '42501';
  end if;

  return updated_progress;
end;
$$;

revoke all on function public.get_current_company_onboarding_progress() from public, anon;
revoke all on function public.start_current_company_onboarding() from public, anon;
revoke all on function public.advance_current_company_onboarding(text) from public, anon;
revoke all on function public.defer_current_company_onboarding() from public, anon;
revoke all on function public.complete_current_company_onboarding() from public, anon;

grant execute on function public.get_current_company_onboarding_progress() to authenticated;
grant execute on function public.start_current_company_onboarding() to authenticated;
grant execute on function public.advance_current_company_onboarding(text) to authenticated;
grant execute on function public.defer_current_company_onboarding() to authenticated;
grant execute on function public.complete_current_company_onboarding() to authenticated;

-- Atomic provisioning cutover.
--
-- SHARE ROW EXCLUSIVE blocks INSERT/UPDATE/DELETE on companies while allowing
-- ordinary reads. The lock, backfill, verification, and trigger installation
-- all run inside this single DO statement and therefore a single PostgreSQL
-- transaction even if a migration runner executes statements one at a time.
--
-- Companies committed before the lock is acquired are visible to the backfill
-- and become completed/ready. Company writes that arrive after the lock wait;
-- when they resume, the initialization trigger is already committed and creates
-- pending/welcome progress. There is no snapshot-to-trigger gap.
--
-- A short local lock timeout makes a busy deployment fail cleanly instead of
-- blocking company provisioning indefinitely. Retrying through migration
-- history is safe after the failed statement rolls back.
do $onboarding_cutover$
begin
  perform set_config('lock_timeout', '10s', true);
  lock table public.companies in share row exclusive mode;

  -- Explicit existing-company backfill. The lateral lookup selects at most one
  -- compatibility organization while still inserting one completed row for
  -- every company, including legacy companies with no organization row.
  insert into public.company_onboarding_progress (
    company_id,
    organization_id,
    onboarding_version,
    status,
    current_step,
    completed_at
  )
  select
    companies.id,
    existing_organization.id,
    1,
    'completed',
    'ready',
    statement_timestamp()
  from public.companies
  left join lateral (
    select organizations.id
    from public.organizations
    where organizations.company_id = companies.id
    order by organizations.created_at nulls last, organizations.id
    limit 1
  ) as existing_organization on true;

  -- Abort the same transaction rather than permit a partial backfill.
  if exists (
    select 1
    from public.companies
    left join public.company_onboarding_progress as progress
      on progress.company_id = companies.id
    where progress.company_id is null
      or progress.status <> 'completed'
      or progress.current_step <> 'ready'
  ) then
    raise exception 'Existing-company onboarding backfill verification failed';
  end if;

  execute $trigger$
    create trigger initialize_company_onboarding
    after insert on public.companies
    for each row execute function private.initialize_company_onboarding()
  $trigger$;
end;
$onboarding_cutover$;

notify pgrst, 'reload schema';
