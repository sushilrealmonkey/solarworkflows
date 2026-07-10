-- Read-only guardrail checks for verified-user self-service onboarding.

do $$
declare
  target_function regprocedure :=
    'public.self_create_epc_workspace(text,text,text)'::regprocedure;
  function_is_security_definer boolean;
  function_search_path text[];
begin
  if not has_function_privilege('authenticated', target_function, 'execute') then
    raise exception 'authenticated must be allowed to execute self_create_epc_workspace';
  end if;

  if has_function_privilege('anon', target_function, 'execute') then
    raise exception 'anon must not be allowed to execute self_create_epc_workspace';
  end if;

  select
    pg_proc.prosecdef,
    pg_proc.proconfig
  into
    function_is_security_definer,
    function_search_path
  from pg_proc
  where pg_proc.oid = target_function;

  if not function_is_security_definer then
    raise exception 'self_create_epc_workspace must be security definer';
  end if;

  if not coalesce(
    function_search_path @> array['search_path=public, auth']::text[],
    false
  ) then
    raise exception 'self_create_epc_workspace must use a fixed search_path';
  end if;

  begin
    perform public.self_create_epc_workspace(
      'Unauthenticated Test Workspace',
      'Unauthenticated Test User',
      null
    );

    raise exception 'Unauthenticated workspace creation was unexpectedly allowed';
  exception
    when sqlstate '42501' then
      null;
  end;
end;
$$;

-- Exercise the complete verified-email or verified-phone path without
-- persisting test data.
begin;

do $$
declare
  candidate_user_id uuid;
  candidate_email text;
  candidate_phone text;
  onboarding_result jsonb;
  created_organization_id uuid;
  created_company_id uuid;
  created_admin_role_id uuid;
  created_admin_profile_id uuid;
begin
  select
    users.id,
    lower(users.email),
    users.phone
  into
    candidate_user_id,
    candidate_email,
    candidate_phone
  from auth.users
  where (
      (users.email_confirmed_at is not null and users.email is not null)
      or (users.phone_confirmed_at is not null and users.phone is not null)
    )
    and not exists (
      select 1
      from public.users_profile
      where users_profile.auth_user_id = users.id
        or (
          users.email is not null
          and lower(users_profile.email) = lower(users.email)
        )
        or (
          users.phone is not null
          and users_profile.phone = users.phone
        )
    )
    and not exists (
      select 1
      from public.profiles
      where profiles.id = users.id
    )
  order by users.created_at desc
  limit 1;

  if candidate_user_id is null then
    raise notice 'Skipping success-path onboarding test: no verified unassigned Auth identity is available';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', candidate_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', candidate_user_id,
      'email', candidate_email,
      'phone', candidate_phone,
      'role', 'authenticated'
    )::text,
    true
  );

  onboarding_result := public.self_create_epc_workspace(
    'Onboarding Verification Workspace',
    'Onboarding Verification Admin',
    null
  );

  created_organization_id := (onboarding_result ->> 'organization_id')::uuid;
  created_company_id := (onboarding_result ->> 'company_id')::uuid;
  created_admin_role_id := (onboarding_result ->> 'admin_role_id')::uuid;
  created_admin_profile_id := (onboarding_result ->> 'admin_profile_id')::uuid;

  if not exists (
    select 1
    from public.organizations
    where organizations.id = created_organization_id
      and organizations.company_id = created_company_id
      and organizations.status = 'active'
  ) then
    raise exception 'Onboarding did not create the active organization/company link';
  end if;

  if not exists (
    select 1
    from public.users_profile
    where users_profile.id = created_admin_profile_id
      and users_profile.auth_user_id = candidate_user_id
      and users_profile.organization_id = created_organization_id
      and users_profile.company_id = created_company_id
      and users_profile.status = 'active'
      and (
        users_profile.email_verified = true
        or users_profile.phone_verified = true
      )
  ) then
    raise exception 'Onboarding did not create the active verified admin profile';
  end if;

  if not exists (
    select 1
    from public.roles
    join public.user_roles on user_roles.role_id = roles.id
    where roles.id = created_admin_role_id
      and roles.organization_id = created_organization_id
      and roles.company_id = created_company_id
      and roles.role_key = 'admin'
      and user_roles.user_profile_id = created_admin_profile_id
      and user_roles.user_id = candidate_user_id
  ) then
    raise exception 'Onboarding did not assign the locked Admin role';
  end if;

  if not exists (
    select 1
    from public.role_permissions
    where role_permissions.role_id = created_admin_role_id
  ) then
    raise exception 'Onboarding Admin role has no permissions';
  end if;
end;
$$;

rollback;
