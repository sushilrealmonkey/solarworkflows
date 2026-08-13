-- Keep settings reads available when a tenant's subscription is read-only.
-- Mutations continue to use require_settings_update() and therefore remain
-- protected by both role permissions and subscription write access.

create or replace function public.require_settings_view()
returns uuid
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

  if not public.is_super_admin()
    and not public.user_has_permission('settings', 'view') then
    raise exception 'Missing settings:view permission'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null and not public.is_super_admin() then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  return current_organization_id;
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
  current_organization_id := public.require_settings_view();

  return query
  select
    users_profile.id,
    users_profile.organization_id,
    users_profile.full_name,
    users_profile.phone,
    users_profile.email,
    users_profile.status,
    users_profile.last_login_at,
    roles.id as role_id,
    roles.role_name
  from public.users_profile
  left join lateral (
    select user_roles.role_id
    from public.user_roles
    where user_roles.user_profile_id = users_profile.id
       or user_roles.user_id = users_profile.auth_user_id
    order by user_roles.id
    limit 1
  ) assigned_role on true
  left join public.roles on roles.id = assigned_role.role_id
  where (
    current_organization_id is null
    or users_profile.organization_id = current_organization_id
  )
  order by users_profile.full_name nulls last, users_profile.email nulls last;
end;
$$;

revoke execute on function public.require_settings_view()
  from PUBLIC, anon;
grant execute on function public.require_settings_view()
  to authenticated, service_role;

revoke execute on function public.get_settings_staff()
  from PUBLIC, anon;
grant execute on function public.get_settings_staff()
  to authenticated, service_role;
