-- Allows a verified, authenticated user without tenant access to create one EPC
-- workspace and become its locked Admin. All tenant records are created in one
-- transaction and include both organization_id and company_id.

create or replace function public.self_create_epc_workspace(
  workspace_name text,
  admin_full_name text,
  admin_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_auth_user_id uuid := auth.uid();
  current_auth_email text;
  current_email_confirmed_at timestamptz;
  normalized_workspace_name text;
  normalized_admin_name text;
  normalized_admin_phone text;
  slug_base text;
  workspace_slug text;
  new_company_id uuid := gen_random_uuid();
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to create a workspace'
      using errcode = '42501';
  end if;

  -- Lock the Auth user so concurrent onboarding requests for the same identity
  -- cannot create more than one tenant.
  select
    nullif(lower(trim(users.email)), ''),
    users.email_confirmed_at
  into
    current_auth_email,
    current_email_confirmed_at
  from auth.users
  where users.id = current_auth_user_id
  for update;

  if current_auth_email is null or current_email_confirmed_at is null then
    raise exception 'A verified email address is required to create a workspace'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.users_profile
    where users_profile.auth_user_id = current_auth_user_id
  ) or exists (
    select 1
    from public.profiles
    where profiles.id = current_auth_user_id
  ) then
    raise exception 'This account already has workspace access'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = current_auth_email
  ) then
    raise exception 'This email is already assigned to a workspace'
      using errcode = '23505';
  end if;

  normalized_workspace_name := nullif(
    regexp_replace(trim(workspace_name), '[[:space:]]+', ' ', 'g'),
    ''
  );
  normalized_admin_name := nullif(
    regexp_replace(trim(admin_full_name), '[[:space:]]+', ' ', 'g'),
    ''
  );
  normalized_admin_phone := nullif(trim(admin_phone), '');

  if normalized_workspace_name is null
    or char_length(normalized_workspace_name) < 2
    or char_length(normalized_workspace_name) > 120 then
    raise exception 'Workspace name must be between 2 and 120 characters'
      using errcode = '23514';
  end if;

  if normalized_admin_name is null
    or char_length(normalized_admin_name) < 2
    or char_length(normalized_admin_name) > 120 then
    raise exception 'Full name must be between 2 and 120 characters'
      using errcode = '23514';
  end if;

  if normalized_admin_phone is not null and (
    char_length(normalized_admin_phone) < 6
    or char_length(normalized_admin_phone) > 20
    or normalized_admin_phone !~ '^[0-9+() -]+$'
  ) then
    raise exception 'Enter a valid phone number'
      using errcode = '23514';
  end if;

  if normalized_admin_phone is not null and (
    exists (
      select 1
      from public.users_profile
      where users_profile.phone = normalized_admin_phone
    )
    or exists (
      select 1
      from public.profiles
      where profiles.phone = normalized_admin_phone
    )
  ) then
    raise exception 'This phone number is already assigned to an account'
      using errcode = '23505';
  end if;

  slug_base := trim(
    both '-'
    from regexp_replace(lower(normalized_workspace_name), '[^a-z0-9]+', '-', 'g')
  );
  slug_base := coalesce(nullif(left(slug_base, 80), ''), 'workspace');
  workspace_slug := slug_base || '-' || left(replace(new_company_id::text, '-', ''), 8);

  insert into public.companies (
    id,
    company_name,
    company_slug,
    owner_name,
    owner_phone,
    owner_email,
    status
  )
  values (
    new_company_id,
    normalized_workspace_name,
    workspace_slug,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active'
  );

  insert into public.organizations (
    name,
    slug,
    subdomain,
    status,
    company_id
  )
  values (
    normalized_workspace_name,
    workspace_slug,
    workspace_slug,
    'active',
    new_company_id
  )
  returning id into new_organization_id;

  insert into public.organization_settings (
    organization_id,
    contact_email,
    contact_phone
  )
  values (
    new_organization_id,
    current_auth_email,
    normalized_admin_phone
  )
  on conflict (organization_id) do nothing;

  perform public.seed_epc_standard_roles(new_organization_id);

  update public.roles
  set company_id = new_company_id
  where roles.organization_id = new_organization_id
    and roles.company_id is distinct from new_company_id;

  select roles.id
  into admin_role_id
  from public.roles
  where roles.organization_id = new_organization_id
    and roles.role_key = 'admin'
  limit 1;

  if admin_role_id is null then
    raise exception 'Admin role could not be created'
      using errcode = 'P0002';
  end if;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    onboarded_at,
    phone_verified,
    email_verified
  )
  values (
    current_auth_user_id,
    new_organization_id,
    new_company_id,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active',
    false,
    now(),
    false,
    true
  )
  returning id into admin_profile_id;

  insert into public.profiles (
    id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    created_at,
    updated_at
  )
  values (
    current_auth_user_id,
    new_organization_id,
    new_company_id,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active',
    false,
    now(),
    now()
  );

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, current_auth_user_id, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'company_id', new_company_id,
    'workspace_slug', workspace_slug,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id
  );
end;
$$;

revoke execute on function public.self_create_epc_workspace(text, text, text) from public;
revoke execute on function public.self_create_epc_workspace(text, text, text) from anon;
grant execute on function public.self_create_epc_workspace(text, text, text) to authenticated;

notify pgrst, 'reload schema';
