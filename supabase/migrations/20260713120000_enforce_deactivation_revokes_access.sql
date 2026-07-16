-- Security fix: deactivating a tenant user must actually revoke access.
--
-- Previously the legacy RBAC helpers (get_current_user_company_id / has_permission)
-- ignored profile status, and staff deactivation only touched users_profile.status.
-- A deactivated user whose profiles row stayed 'active' therefore kept access to the
-- legacy-path tables (roles, user_roles, company_settings, ...) for as long as their
-- session token kept refreshing. This migration:
--   1. Makes the legacy helpers deny inactive profiles.
--   2. Propagates status changes to the profiles row on staff deactivation.
--   3. Terminates the auth sessions of a staff member when they are deactivated.

-- Legacy tenant lookup now returns a company only for active profiles, so an
-- inactive user resolves to NULL and fails every company-scoped legacy policy.
create or replace function public.get_current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profiles.company_id
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.status = 'active'
  limit 1;
$$;

-- Legacy permission check now requires an active profile, mirroring the newer
-- user_has_permission() which already gates on users_profile.status = 'active'.
create or replace function public.has_permission(module_key text, action_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.profiles caller
      join public.user_roles on user_roles.user_id = caller.id
      join public.roles on roles.id = user_roles.role_id
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where caller.id = auth.uid()
        and caller.status = 'active'
        and roles.company_id = caller.company_id
        and modules.module_key = $1
        and permissions.action_key = $2
        and modules.is_active = true
    );
$$;

-- Staff create/update RPC: keep users_profile and profiles status in sync and
-- kill live sessions when a staff member is deactivated.
create or replace function public.update_settings_staff(
  target_profile_id uuid,
  full_name text,
  phone text,
  email text,
  role_id uuid,
  status text
)
returns public.users_profile
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_organization_id uuid;
  target_profile public.users_profile%rowtype;
  normalized_status text := coalesce(nullif(trim(update_settings_staff.status), ''), 'invited');
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_profile
  from public.users_profile
  where users_profile.id = update_settings_staff.target_profile_id
  for update;

  if not found then
    raise exception 'Staff profile not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_profile.organization_id <> current_organization_id then
    raise exception 'Cannot update staff for another organization'
      using errcode = '42501';
  end if;

  if target_profile.auth_user_id = auth.uid()
    and normalized_status <> 'active' then
    raise exception 'You cannot deactivate your own account'
      using errcode = '42501';
  end if;

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status'
      using errcode = '22023';
  end if;

  if target_profile.organization_id is not null then
    perform public.seed_epc_standard_roles(target_profile.organization_id);
  end if;

  if update_settings_staff.role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = update_settings_staff.role_id
      and roles.organization_id = target_profile.organization_id
      and coalesce(roles.is_system_role, false)
      and roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  ) then
    raise exception 'Role must be a standard role in the staff organization'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    full_name = nullif(trim(update_settings_staff.full_name), ''),
    phone = nullif(trim(update_settings_staff.phone), ''),
    email = nullif(lower(trim(update_settings_staff.email)), ''),
    status = normalized_status,
    is_super_admin = target_profile.is_super_admin,
    updated_at = now()
  where users_profile.id = update_settings_staff.target_profile_id
  returning * into target_profile;

  -- Keep the legacy profiles row aligned so status-aware policies see the change.
  if target_profile.auth_user_id is not null then
    update public.profiles
    set
      status = normalized_status,
      updated_at = now()
    where profiles.id = target_profile.auth_user_id;
  end if;

  delete from public.user_roles
  where user_roles.user_profile_id = update_settings_staff.target_profile_id
     or user_roles.user_id = target_profile.auth_user_id;

  if update_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id, user_id, role_id)
    values (
      update_settings_staff.target_profile_id,
      target_profile.auth_user_id,
      update_settings_staff.role_id
    )
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  -- Force logout on deactivation: remove active sessions (refresh tokens cascade).
  if normalized_status = 'inactive' and target_profile.auth_user_id is not null then
    delete from auth.sessions
    where sessions.user_id = target_profile.auth_user_id;
  end if;

  return target_profile;
end;
$$;

-- Terminates all auth sessions for a user. Used by the service-role admin-status
-- edge function, which cannot reach the auth schema through PostgREST directly.
-- Restricted to service_role so it can only be invoked from trusted server code.
create or replace function public.revoke_tenant_user_sessions(target_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_auth_user_id is null then
    return;
  end if;

  delete from auth.sessions
  where sessions.user_id = target_auth_user_id;
end;
$$;

revoke execute on function public.revoke_tenant_user_sessions(uuid) from public;
revoke execute on function public.revoke_tenant_user_sessions(uuid) from anon;
revoke execute on function public.revoke_tenant_user_sessions(uuid) from authenticated;
grant execute on function public.revoke_tenant_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
