-- Repairs the linked Supabase function used after email/password login.
-- The previously deployed function referenced sync_auth_user_profile.auth_user_id,
-- which is not a table alias and causes the profile sync RPC to fail.

create or replace function public.sync_auth_user_profile()
returns public.users_profile
language plpgsql
security definer
set search_path = public, auth
as $$
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
      and users_profile.phone = auth_phone
    )
    or (
      users_profile.auth_user_id is null
      and auth_email is not null
      and lower(users_profile.email) = auth_email
    )
  order by
    (users_profile.auth_user_id = current_auth_user_id) desc,
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
    phone_verified = users_profile.phone_verified or auth_phone_confirmed_at is not null,
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
$$;

grant execute on function public.sync_auth_user_profile() to authenticated;
