-- The Staff RPCs intentionally keep a public argument named role_id for
-- PostgREST/Supabase RPC calls. Inside SQL statements, conflict targets also
-- contain a role_id column. Prefer table columns for unresolved SQL names and
-- keep function arguments explicitly qualified to avoid PL/pgSQL ambiguity.

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
#variable_conflict use_column
declare
  current_organization_id uuid;
  normalized_status text := coalesce(nullif(trim(create_settings_staff.status), ''), 'invited');
  normalized_email text := nullif(lower(trim(create_settings_staff.email)), '');
  created_profile public.users_profile%rowtype;
begin
  current_organization_id := public.require_settings_update();

  if current_organization_id is null then
    raise exception 'organization_id is required to create staff'
      using errcode = '23502';
  end if;

  perform public.seed_epc_standard_roles(current_organization_id);

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status'
      using errcode = '22023';
  end if;

  if normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Staff email is required'
      using errcode = '23502';
  end if;

  if exists (
    select 1
    from public.users_profile
    where users_profile.organization_id = current_organization_id
      and lower(users_profile.email) = normalized_email
  ) then
    raise exception 'A staff profile already exists for this email'
      using errcode = '23505';
  end if;

  if create_settings_staff.role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = create_settings_staff.role_id
      and roles.organization_id = current_organization_id
      and coalesce(roles.is_system_role, false)
      and roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  ) then
    raise exception 'Role must be a standard role in the current organization'
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
    nullif(trim(create_settings_staff.full_name), ''),
    nullif(trim(create_settings_staff.phone), ''),
    normalized_email,
    normalized_status,
    false,
    now()
  )
  returning * into created_profile;

  if create_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id, role_id)
    values (created_profile.id, create_settings_staff.role_id)
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

  return target_profile;
end;
$$;
