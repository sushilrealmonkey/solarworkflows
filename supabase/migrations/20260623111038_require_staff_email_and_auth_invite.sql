-- Staff creation is now invite-first: every staff profile must have an email
-- address suitable for Supabase Auth invitation and password setup.

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
