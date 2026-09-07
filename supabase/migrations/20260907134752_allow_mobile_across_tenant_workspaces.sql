-- WhatsApp/mobile contacts may be reused in separate tenant workspaces.
-- Auth identities and email addresses retain their existing uniqueness.
alter table public.profiles drop constraint profiles_phone_key;
drop index public.users_profile_phone_unique;
create unique index profiles_company_phone_unique
  on public.profiles (company_id, phone) where phone is not null;
create unique index users_profile_company_phone_unique
  on public.users_profile (company_id, phone) where phone is not null;
create index users_profile_phone_idx
  on public.users_profile (phone) where phone is not null;

CREATE OR REPLACE FUNCTION public.create_organization_with_admin(organization_name text, organization_slug text, admin_full_name text, admin_phone text, admin_email text DEFAULT NULL::text, admin_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_company_id uuid := gen_random_uuid();
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

  if normalized_admin_phone is null then
    raise exception 'Primary admin WhatsApp number is required'
      using errcode = '23514';
  end if;

  if char_length(normalized_admin_phone) < 6
    or char_length(normalized_admin_phone) > 20
    or normalized_admin_phone !~ '^[0-9+() -]+$' then
    raise exception 'Enter a valid primary admin WhatsApp number'
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
    organization_name,
    'org-' || new_company_id::text,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'active'
  );

  insert into public.organizations (name, slug, subdomain, status, company_id)
  values (organization_name, normalized_slug, normalized_slug, 'active', new_company_id)
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, normalized_admin_email, normalized_admin_phone)
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
    invited_at,
    phone_verified,
    email_verified
  )
  values (
    admin_auth_user_id,
    new_organization_id,
    new_company_id,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'invited',
    false,
    now(),
    false,
    false
  )
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
    'company_id', new_company_id,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.self_create_epc_workspace(workspace_name text, admin_full_name text, admin_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_auth_user_id uuid := auth.uid();
  current_auth_email text;
  current_auth_phone text;
  current_email_confirmed_at timestamptz;
  current_phone_confirmed_at timestamptz;
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

  select
    nullif(lower(trim(users.email)), ''),
    nullif(trim(users.phone), ''),
    users.email_confirmed_at,
    users.phone_confirmed_at
  into
    current_auth_email,
    current_auth_phone,
    current_email_confirmed_at,
    current_phone_confirmed_at
  from auth.users
  where users.id = current_auth_user_id
  for update;

  if (current_auth_email is null or current_email_confirmed_at is null)
    and (current_auth_phone is null or current_phone_confirmed_at is null) then
    raise exception 'A verified email or phone number is required to create a workspace'
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

  if current_auth_email is not null and exists (
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
  normalized_admin_phone := coalesce(
    case
      when current_phone_confirmed_at is not null then current_auth_phone
      else null
    end,
    nullif(trim(admin_phone), '')
  );

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

  if normalized_admin_phone is null then
    raise exception 'A WhatsApp number is required to create a workspace'
      using errcode = '23514';
  end if;

  if char_length(normalized_admin_phone) < 6
    or char_length(normalized_admin_phone) > 20
    or normalized_admin_phone !~ '^[0-9+() -]+$' then
    raise exception 'Enter a valid WhatsApp number'
      using errcode = '23514';
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
    current_phone_confirmed_at is not null,
    current_email_confirmed_at is not null
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_auth_user_profile()
 RETURNS users_profile
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_auth_user_id uuid := auth.uid();
  auth_phone text;
  auth_email text;
  auth_phone_confirmed_at timestamptz;
  auth_email_confirmed_at timestamptz;
  matched_profile public.users_profile%rowtype;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to sync a user profile'
      using errcode = '42501';
  end if;

  select
    nullif(trim(users.phone), ''),
    nullif(lower(trim(users.email)), ''),
    users.phone_confirmed_at,
    users.email_confirmed_at
  into
    auth_phone,
    auth_email,
    auth_phone_confirmed_at,
    auth_email_confirmed_at
  from auth.users
  where users.id = current_auth_user_id;

  select *
  into matched_profile
  from public.users_profile
  where users_profile.auth_user_id = current_auth_user_id
    or (
      users_profile.auth_user_id is null
      and auth_phone is not null
      and auth_phone_confirmed_at is not null
      and users_profile.email is null
      and users_profile.phone = auth_phone
      -- A shared contact number must never choose between tenant invitations.
      and (select count(*) from public.users_profile candidates
           where candidates.phone = auth_phone) = 1
    )
    or (
      users_profile.auth_user_id is null
      and auth_email is not null
      and auth_email_confirmed_at is not null
      and lower(users_profile.email) = auth_email
    )
  order by
    (users_profile.auth_user_id = current_auth_user_id) desc nulls last,
    (auth_phone is not null and users_profile.phone = auth_phone) desc,
    users_profile.created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'No invited user profile found for this phone or email'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    auth_user_id = coalesce(users_profile.auth_user_id, current_auth_user_id),
    email = coalesce(users_profile.email, auth_email),
    phone = coalesce(users_profile.phone, auth_phone),
    status = case
      when users_profile.status = 'invited' then 'active'
      else users_profile.status
    end,
    last_login_at = now(),
    onboarded_at = coalesce(users_profile.onboarded_at, now()),
    phone_verified = coalesce(users_profile.phone_verified, false) or (auth_phone_confirmed_at is not null and coalesce(users_profile.phone, auth_phone) = auth_phone),
    email_verified = users_profile.email_verified or auth_email_confirmed_at is not null,
    updated_at = now()
  where users_profile.id = matched_profile.id
  returning * into matched_profile;

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
    matched_profile.organization_id,
    matched_profile.company_id,
    matched_profile.full_name,
    matched_profile.phone,
    matched_profile.email,
    matched_profile.status,
    matched_profile.is_super_admin,
    coalesce(matched_profile.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    company_id = excluded.company_id,
    full_name = excluded.full_name,
    phone = excluded.phone,
    email = excluded.email,
    status = excluded.status,
    is_super_admin = excluded.is_super_admin,
    updated_at = now();

  update public.user_roles target_user_roles
  set user_id = current_auth_user_id
  where target_user_roles.user_profile_id = matched_profile.id
    and target_user_roles.user_id is null
    and not exists (
      select 1
      from public.user_roles existing_user_roles
      where existing_user_roles.user_id = current_auth_user_id
        and existing_user_roles.role_id = target_user_roles.role_id
    );

  return matched_profile;
end;
$function$;

revoke all on function public.sync_auth_user_profile() from public, anon;
grant execute on function public.sync_auth_user_profile() to authenticated;

