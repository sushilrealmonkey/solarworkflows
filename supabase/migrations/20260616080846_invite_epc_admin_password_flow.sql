-- Keep EPC company admins in invited status after Supabase Auth invitation.
-- The admin becomes active only after accepting the invite and setting a password
-- through the app's create-password screen, which calls sync_auth_user_profile().

create or replace function public.create_organization_with_admin(
  organization_name text,
  organization_slug text,
  admin_full_name text,
  admin_phone text,
  admin_email text default null,
  admin_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
  normalized_slug text;
  normalized_admin_email text;
  normalized_admin_phone text;
  admin_profile_status text := 'pending_auth_invite';
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can create organizations'
      using errcode = '42501';
  end if;

  normalized_slug := lower(trim(organization_slug));
  normalized_admin_email := nullif(lower(trim(admin_email)), '');
  normalized_admin_phone := nullif(trim(admin_phone), '');

  if normalized_admin_email is null then
    raise exception 'Primary admin email is required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = normalized_admin_email
  ) then
    raise exception 'A user profile already exists for this admin email'
      using errcode = '23505';
  end if;

  if normalized_admin_phone is not null and exists (
    select 1
    from public.users_profile
    where users_profile.phone = normalized_admin_phone
  ) then
    raise exception 'A user profile already exists for this admin phone'
      using errcode = '23505';
  end if;

  insert into public.organizations (name, slug, subdomain, status)
  values (organization_name, normalized_slug, normalized_slug, 'active')
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, normalized_admin_email, normalized_admin_phone)
  on conflict (organization_id) do nothing;

  insert into public.roles (organization_id, role_name, description, is_system_role)
  values (
    new_organization_id,
    'Admin',
    'Default organization admin role with all permissions',
    true
  )
  returning id into admin_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select admin_role_id, permissions.id
  from public.permissions
  on conflict (role_id, permission_id) do nothing;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at,
    phone_verified,
    email_verified
  )
  values (
    admin_auth_user_id,
    new_organization_id,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'invited',
    false,
    now(),
    false,
    false
  )
  on conflict (phone) where phone is not null do update
  set
    auth_user_id = coalesce(public.users_profile.auth_user_id, excluded.auth_user_id),
    organization_id = excluded.organization_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = 'invited',
    is_super_admin = false,
    updated_at = now()
  returning id into admin_profile_id;

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, null, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  if admin_auth_user_id is not null then
    admin_profile_status := 'invite_sent_pending_password';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$$;

grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid) to authenticated;
