-- Step 32 settings management RPCs.
-- These functions keep settings/staff/role management tenant-scoped while using
-- settings:update as the single administrative gate for this module.

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

    if not (
      public.user_has_permission('settings', 'view')
      or public.user_has_permission('settings', 'update')
    ) then
      raise exception 'Missing permission to read organization settings'
        using errcode = '42501';
    end if;
  end if;

  insert into public.organization_settings (organization_id)
  values (requested_organization_id)
  on conflict (organization_id) do nothing;

  select *
  into settings_record
  from public.organization_settings
  where organization_settings.organization_id = requested_organization_id
  limit 1;

  return settings_record;
end;
$$;

create or replace function public.require_settings_update()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage settings'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('settings', 'update') then
    raise exception 'Missing settings:update permission'
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

create or replace function public.settings_critical_permission_ids()
returns table(permission_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select permissions.id
  from public.permissions
  join public.modules on modules.id = permissions.module_id
  where modules.module_key in ('settings', 'staff')
    and permissions.action_key in ('view', 'create', 'update');
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
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
begin
  current_organization_id := public.require_settings_update();

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

create or replace function public.get_settings_roles()
returns table(
  id uuid,
  organization_id uuid,
  role_name text,
  description text,
  is_system_role boolean,
  permission_count bigint,
  permission_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
begin
  current_organization_id := public.require_settings_update();

  return query
  select
    roles.id,
    roles.organization_id,
    roles.role_name,
    roles.description,
    coalesce(roles.is_system_role, false) as is_system_role,
    count(role_permissions.permission_id) as permission_count,
    coalesce(
      array_agg(role_permissions.permission_id order by role_permissions.permission_id)
        filter (where role_permissions.permission_id is not null),
      array[]::uuid[]
    ) as permission_ids
  from public.roles
  left join public.role_permissions on role_permissions.role_id = roles.id
  where (
    current_organization_id is null
    or roles.organization_id = current_organization_id
  )
  group by roles.id
  order by coalesce(roles.is_system_role, false) desc, roles.role_name;
end;
$$;

create or replace function public.apply_role_permissions(
  target_role_id uuid,
  selected_permission_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  target_role public.roles%rowtype;
  next_permission_ids uuid[];
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_role
  from public.roles
  where roles.id = target_role_id
  for update;

  if not found then
    raise exception 'Role not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_role.organization_id <> current_organization_id then
    raise exception 'Cannot update permissions for a role in another organization'
      using errcode = '42501';
  end if;

  next_permission_ids := coalesce(selected_permission_ids, array[]::uuid[]);

  if coalesce(target_role.is_system_role, false) then
    select array(
      select distinct permission_id
      from (
        select unnest(next_permission_ids) as permission_id
        union
        select settings_critical_permission_ids.permission_id
        from public.settings_critical_permission_ids()
      ) critical_permissions
      where permission_id is not null
    )
    into next_permission_ids;
  end if;

  delete from public.role_permissions
  where role_permissions.role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, permissions.id
  from public.permissions
  where permissions.id = any(next_permission_ids)
  on conflict (role_id, permission_id) do nothing;
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
set search_path = public
as $$
declare
  current_organization_id uuid;
  normalized_status text := coalesce(nullif(trim(status), ''), 'invited');
  created_profile public.users_profile%rowtype;
begin
  current_organization_id := public.require_settings_update();

  if current_organization_id is null then
    raise exception 'organization_id is required to create staff'
      using errcode = '23502';
  end if;

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status'
      using errcode = '22023';
  end if;

  if role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = role_id
      and roles.organization_id = current_organization_id
  ) then
    raise exception 'Role must belong to the current organization'
      using errcode = '42501';
  end if;

  insert into public.users_profile (
    organization_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at
  )
  values (
    current_organization_id,
    nullif(trim(full_name), ''),
    nullif(trim(phone), ''),
    nullif(lower(trim(email)), ''),
    normalized_status,
    false,
    now()
  )
  returning * into created_profile;

  if role_id is not null then
    insert into public.user_roles (user_profile_id, role_id)
    values (created_profile.id, role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  return created_profile;
end;
$$;

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
declare
  current_organization_id uuid;
  target_profile public.users_profile%rowtype;
  normalized_status text := coalesce(nullif(trim(status), ''), 'invited');
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_profile
  from public.users_profile
  where users_profile.id = target_profile_id
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

  if role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = role_id
      and roles.organization_id = target_profile.organization_id
  ) then
    raise exception 'Role must belong to the staff organization'
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
  where users_profile.id = target_profile_id
  returning * into target_profile;

  delete from public.user_roles
  where user_roles.user_profile_id = target_profile_id
     or user_roles.user_id = target_profile.auth_user_id;

  if role_id is not null then
    insert into public.user_roles (user_profile_id, user_id, role_id)
    values (target_profile_id, target_profile.auth_user_id, role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  return target_profile;
end;
$$;

create or replace function public.create_settings_role(
  role_name text,
  description text,
  permission_ids uuid[] default array[]::uuid[]
)
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  created_role public.roles%rowtype;
begin
  current_organization_id := public.require_settings_update();

  if current_organization_id is null then
    raise exception 'organization_id is required to create a role'
      using errcode = '23502';
  end if;

  if nullif(trim(role_name), '') is null then
    raise exception 'Role name is required'
      using errcode = '23502';
  end if;

  insert into public.roles (organization_id, role_name, description, is_system_role)
  values (
    current_organization_id,
    trim(role_name),
    nullif(trim(description), ''),
    false
  )
  returning * into created_role;

  perform public.apply_role_permissions(created_role.id, permission_ids);

  return created_role;
end;
$$;

create or replace function public.update_settings_role(
  target_role_id uuid,
  role_name text,
  description text,
  permission_ids uuid[] default array[]::uuid[]
)
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  updated_role public.roles%rowtype;
begin
  current_organization_id := public.require_settings_update();

  select *
  into updated_role
  from public.roles
  where roles.id = target_role_id
  for update;

  if not found then
    raise exception 'Role not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and updated_role.organization_id <> current_organization_id then
    raise exception 'Cannot update a role for another organization'
      using errcode = '42501';
  end if;

  if nullif(trim(role_name), '') is null then
    raise exception 'Role name is required'
      using errcode = '23502';
  end if;

  update public.roles
  set
    role_name = trim(update_settings_role.role_name),
    description = nullif(trim(update_settings_role.description), ''),
    updated_at = now()
  where roles.id = target_role_id
  returning * into updated_role;

  perform public.apply_role_permissions(target_role_id, permission_ids);

  return updated_role;
end;
$$;

create or replace function public.delete_settings_role(target_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  target_role public.roles%rowtype;
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_role
  from public.roles
  where roles.id = target_role_id
  for update;

  if not found then
    raise exception 'Role not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_role.organization_id <> current_organization_id then
    raise exception 'Cannot delete a role for another organization'
      using errcode = '42501';
  end if;

  if coalesce(target_role.is_system_role, false) then
    raise exception 'System roles cannot be deleted'
      using errcode = '42501';
  end if;

  delete from public.roles
  where roles.id = target_role_id;
end;
$$;

grant execute on function public.require_settings_update() to authenticated;
grant execute on function public.settings_critical_permission_ids() to authenticated;
grant execute on function public.get_settings_staff() to authenticated;
grant execute on function public.get_settings_roles() to authenticated;
grant execute on function public.apply_role_permissions(uuid, uuid[]) to authenticated;
grant execute on function public.create_settings_staff(text, text, text, uuid, text) to authenticated;
grant execute on function public.update_settings_staff(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.create_settings_role(text, text, uuid[]) to authenticated;
grant execute on function public.update_settings_role(uuid, text, text, uuid[]) to authenticated;
grant execute on function public.delete_settings_role(uuid) to authenticated;
