-- Keep invitation-time role assignments anchored to users_profile. Invited
-- users have an auth.users row but do not receive a legacy public.profiles row
-- until onboarding, so writing auth_user_id to user_roles.user_id violates the
-- legacy foreign key.
create or replace function public.update_settings_staff(
  target_profile_id uuid, full_name text, phone text, email text,
  role_id uuid, status text
)
returns public.users_profile
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_organization_id uuid;
  target_profile public.users_profile%rowtype;
  normalized_status text := coalesce(nullif(trim(update_settings_staff.status), ''), 'invited');
  normalized_email text := nullif(lower(trim(update_settings_staff.email)), '');
  legacy_profile_id uuid;
begin
  current_organization_id := public.require_settings_update();

  select * into target_profile
  from public.users_profile
  where id = update_settings_staff.target_profile_id
  for update;

  if not found then
    raise exception 'Staff profile not found' using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_profile.organization_id <> current_organization_id then
    raise exception 'Cannot update staff for another organization' using errcode = '42501';
  end if;

  if normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Staff email is required' using errcode = '23502';
  end if;

  if target_profile.status <> 'invited'
    and normalized_email is distinct from lower(target_profile.email) then
    raise exception 'Email can only be changed while the staff invitation is pending'
      using errcode = '42501';
  end if;

  if target_profile.status = 'invited' and normalized_status <> 'invited' then
    raise exception 'Invited staff become active only after accepting their invitation'
      using errcode = '42501';
  end if;

  if target_profile.status <> 'invited' and normalized_status = 'invited' then
    raise exception 'An existing staff account cannot be changed back to invited'
      using errcode = '42501';
  end if;

  if target_profile.auth_user_id = auth.uid() and normalized_status <> 'active' then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
  end if;

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status' using errcode = '22023';
  end if;

  perform public.seed_epc_standard_roles(target_profile.organization_id);

  if update_settings_staff.role_id is not null and not exists (
    select 1
    from public.roles r
    where r.id = update_settings_staff.role_id
      and r.organization_id = target_profile.organization_id
      and coalesce(r.is_system_role, false)
      and r.role_key in ('admin', 'sales_team', 'backend_team', 'accounts', 'field_staff')
  ) then
    raise exception 'Role must be a standard role in the staff organization'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    full_name = nullif(trim(update_settings_staff.full_name), ''),
    phone = nullif(trim(update_settings_staff.phone), ''),
    email = normalized_email,
    status = normalized_status,
    is_super_admin = target_profile.is_super_admin,
    updated_at = now()
  where id = update_settings_staff.target_profile_id
  returning * into target_profile;

  if target_profile.auth_user_id is not null then
    update public.profiles
    set
      full_name = target_profile.full_name,
      phone = target_profile.phone,
      email = target_profile.email,
      status = normalized_status,
      updated_at = now()
    where id = target_profile.auth_user_id;
  end if;

  delete from public.user_roles
  where user_profile_id = update_settings_staff.target_profile_id
     or user_id = target_profile.auth_user_id;

  if target_profile.auth_user_id is not null
    and exists (
      select 1 from public.profiles p where p.id = target_profile.auth_user_id
    ) then
    legacy_profile_id := target_profile.auth_user_id;
  end if;

  if update_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id, user_id, role_id)
    values (
      update_settings_staff.target_profile_id,
      legacy_profile_id,
      update_settings_staff.role_id
    )
    on conflict (user_profile_id, role_id)
      where user_profile_id is not null do nothing;
  end if;

  if normalized_status = 'inactive' and target_profile.auth_user_id is not null then
    delete from auth.sessions where user_id = target_profile.auth_user_id;
  end if;

  return target_profile;
end;
$$;

revoke execute on function public.update_settings_staff(uuid, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.update_settings_staff(uuid, text, text, text, uuid, text)
  to authenticated;
