-- A trial can expire while the setup owner is still onboarding. Keep normal
-- Settings access subscription-gated, but allow that owner to complete the
-- narrow Team step (view roles/staff and add an invited team member).
create or replace function private.current_onboarding_team_setup_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select progress.organization_id
  from public.company_onboarding_progress as progress
  join public.users_profile as profile
    on profile.id = progress.setup_owner_profile_id
   and profile.organization_id = progress.organization_id
   and profile.company_id = progress.company_id
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'active'
    and progress.status = 'in_progress'
    and progress.current_step = 'team'
  limit 1;
$$;

create or replace function public.get_settings_roles()
returns table(
  id uuid,
  organization_id uuid,
  role_key text,
  role_name text,
  description text,
  is_system_role boolean,
  permission_count bigint,
  permission_ids uuid[]
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage settings'
      using errcode = '42501';
  end if;

  if public.user_has_permission('settings', 'update') then
    current_organization_id := public.current_user_organization_id();

    if current_organization_id is null and not public.is_super_admin() then
      raise exception 'Current user is not assigned to an active organization'
        using errcode = '23502';
    end if;
  else
    current_organization_id := private.current_onboarding_team_setup_organization_id();

    if current_organization_id is null then
      raise exception 'Missing settings:update permission'
        using errcode = '42501';
    end if;
  end if;

  if current_organization_id is not null then
    perform public.seed_epc_standard_roles(current_organization_id);
  end if;

  return query
  select
    r.id,
    r.organization_id,
    r.role_key,
    r.role_name,
    r.description,
    coalesce(r.is_system_role, false),
    count(rp.permission_id),
    coalesce(
      array_agg(rp.permission_id order by rp.permission_id)
        filter (where rp.permission_id is not null),
      array[]::uuid[]
    )
  from public.roles as r
  left join public.role_permissions as rp on rp.role_id = r.id
  where (current_organization_id is null or r.organization_id = current_organization_id)
    and (
      public.is_super_admin()
      or (
        coalesce(r.is_system_role, false)
        and r.role_key in ('admin', 'sales_team', 'backend_team', 'accounts', 'field_staff')
      )
    )
  group by r.id
  order by case r.role_key
    when 'admin' then 10
    when 'sales_team' then 20
    when 'backend_team' then 30
    when 'accounts' then 40
    when 'field_staff' then 50
    else 100
  end, r.role_name;
end;
$$;

create or replace function public.get_settings_staff()
returns table(
  id uuid,
  organization_id uuid,
  full_name text,
  phone text,
  email text,
  status text,
  last_login_at timestamptz,
  role_id uuid,
  role_name text
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  current_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read settings'
      using errcode = '42501';
  end if;

  if public.is_super_admin()
    or public.user_has_permission('settings', 'view') then
    current_organization_id := public.current_user_organization_id();

    if current_organization_id is null and not public.is_super_admin() then
      raise exception 'Current user is not assigned to an active organization'
        using errcode = '23502';
    end if;
  else
    current_organization_id := private.current_onboarding_team_setup_organization_id();

    if current_organization_id is null then
      raise exception 'Missing settings:view permission'
        using errcode = '42501';
    end if;
  end if;

  return query
  select
    profile.id,
    profile.organization_id,
    profile.full_name,
    profile.phone,
    profile.email,
    profile.status,
    profile.last_login_at,
    role.id as role_id,
    role.role_name
  from public.users_profile as profile
  left join lateral (
    select user_role.role_id
    from public.user_roles as user_role
    where user_role.user_profile_id = profile.id
       or user_role.user_id = profile.auth_user_id
    order by user_role.id
    limit 1
  ) as assigned_role on true
  left join public.roles as role on role.id = assigned_role.role_id
  where (
    current_organization_id is null
    or profile.organization_id = current_organization_id
  )
  order by profile.full_name nulls last, profile.email nulls last;
end;
$$;

create or replace function public.create_settings_staff(
  full_name text,
  phone text,
  email text,
  role_id uuid,
  status text default 'invited'
)
returns public.users_profile
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_organization_id uuid;
  normalized_status text := coalesce(nullif(trim(create_settings_staff.status), ''), 'invited');
  normalized_email text := nullif(lower(trim(create_settings_staff.email)), '');
  created_profile public.users_profile%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage settings'
      using errcode = '42501';
  end if;

  if public.user_has_permission('settings', 'update') then
    current_organization_id := public.current_user_organization_id();

    if current_organization_id is null and not public.is_super_admin() then
      raise exception 'Current user is not assigned to an active organization'
        using errcode = '23502';
    end if;
  else
    current_organization_id := private.current_onboarding_team_setup_organization_id();

    if current_organization_id is null then
      raise exception 'Missing settings:update permission'
        using errcode = '42501';
    end if;
  end if;

  if current_organization_id is null then
    raise exception 'organization_id is required to create staff'
      using errcode = '23502';
  end if;

  perform public.seed_epc_standard_roles(current_organization_id);

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status' using errcode = '22023';
  end if;

  if normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Staff email is required' using errcode = '23502';
  end if;

  if exists (
    select 1
    from public.users_profile
    where organization_id = current_organization_id
      and lower(users_profile.email) = normalized_email
  ) then
    raise exception 'A staff profile already exists for this email' using errcode = '23505';
  end if;

  if create_settings_staff.role_id is not null and not exists (
    select 1
    from public.roles as role
    where role.id = create_settings_staff.role_id
      and role.organization_id = current_organization_id
      and coalesce(role.is_system_role, false)
      and role.role_key in ('admin', 'sales_team', 'backend_team', 'accounts', 'field_staff')
  ) then
    raise exception 'Role must be a standard role in the current organization'
      using errcode = '42501';
  end if;

  insert into public.users_profile (
    company_id,
    organization_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at
  )
  select
    organization.company_id,
    current_organization_id,
    nullif(trim(create_settings_staff.full_name), ''),
    nullif(trim(create_settings_staff.phone), ''),
    normalized_email,
    normalized_status,
    false,
    now()
  from public.organizations as organization
  where organization.id = current_organization_id
  returning * into created_profile;

  if create_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id, role_id)
    values (created_profile.id, create_settings_staff.role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  return created_profile;
end;
$$;

revoke execute on function private.current_onboarding_team_setup_organization_id()
  from public, anon, authenticated;

revoke execute on function public.get_settings_roles() from public, anon;
grant execute on function public.get_settings_roles() to authenticated, service_role;

revoke execute on function public.get_settings_staff() from public, anon;
grant execute on function public.get_settings_staff() to authenticated, service_role;

revoke execute on function public.create_settings_staff(text, text, text, uuid, text)
  from public, anon;
grant execute on function public.create_settings_staff(text, text, text, uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
