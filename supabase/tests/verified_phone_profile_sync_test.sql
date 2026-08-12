-- Security and behavior checks for email-signup tenant phone verification.

do $$
declare
  target_function regprocedure :=
    'public.sync_verified_phone_to_profile()'::regprocedure;
  function_is_security_definer boolean;
  function_search_path text[];
begin
  if not has_function_privilege('authenticated', target_function, 'execute') then
    raise exception 'authenticated must be allowed to sync its verified phone';
  end if;

  if has_function_privilege('anon', target_function, 'execute') then
    raise exception 'anon must not be allowed to sync a verified phone';
  end if;

  select pg_proc.prosecdef, pg_proc.proconfig
  into function_is_security_definer, function_search_path
  from pg_proc
  where pg_proc.oid = target_function;

  if not function_is_security_definer then
    raise exception 'sync_verified_phone_to_profile must be security definer';
  end if;

  if not coalesce(
    function_search_path @> array['search_path=public, auth']::text[],
    false
  ) then
    raise exception 'sync_verified_phone_to_profile must use a fixed search_path';
  end if;

  begin
    perform public.sync_verified_phone_to_profile();
    raise exception 'Unauthenticated phone sync was unexpectedly allowed';
  exception
    when sqlstate '42501' then
      null;
  end;
end;
$$;

begin;

do $$
declare
  candidate_user_id uuid;
  candidate_phone text;
  synced_profile public.users_profile%rowtype;
begin
  select users.id, users.phone
  into candidate_user_id, candidate_phone
  from auth.users
  join public.users_profile
    on users_profile.auth_user_id = users.id
  where users.phone is not null
    and users.phone_confirmed_at is not null
    and users_profile.status = 'active'
    and users_profile.is_super_admin = false
  order by users.updated_at desc
  limit 1;

  if candidate_user_id is null then
    raise notice 'Skipping verified-phone success path: no eligible Auth user is available';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', candidate_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', candidate_user_id, 'role', 'authenticated')::text,
    true
  );

  synced_profile := public.sync_verified_phone_to_profile();

  if synced_profile.phone is distinct from candidate_phone
    or synced_profile.phone_verified is not true then
    raise exception 'Verified Auth phone was not copied to the tenant profile';
  end if;
end;
$$;

rollback;
