-- Transactional hosted check for the invitation-time role FK regression and
-- the server-side staff lifecycle guards.
begin;

do $$
declare
  target_staff public.users_profile%rowtype;
  target_role_id uuid;
  admin_auth_user_id uuid;
  active_transition_blocked boolean := false;
begin
  select users_profile.*
  into target_staff
  from public.users_profile
  join public.user_roles
    on user_roles.user_profile_id = users_profile.id
  where users_profile.status = 'invited'
    and users_profile.auth_user_id is not null
    and not exists (
      select 1
      from public.profiles
      where profiles.id = users_profile.auth_user_id
    )
  order by users_profile.invited_at desc nulls last
  limit 1;

  if target_staff.id is null then
    raise exception 'No pending invited staff fixture is available for verification';
  end if;

  select user_roles.role_id
  into target_role_id
  from public.user_roles
  where user_roles.user_profile_id = target_staff.id
  order by user_roles.id
  limit 1;

  select users_profile.auth_user_id
  into admin_auth_user_id
  from public.users_profile
  join public.user_roles
    on user_roles.user_profile_id = users_profile.id
      or user_roles.user_id = users_profile.auth_user_id
  join public.roles
    on roles.id = user_roles.role_id
    and roles.organization_id = users_profile.organization_id
  where users_profile.organization_id = target_staff.organization_id
    and users_profile.status = 'active'
    and users_profile.auth_user_id is not null
    and roles.role_key = 'admin'
  limit 1;

  if admin_auth_user_id is null then
    raise exception 'No active tenant admin is available for verification';
  end if;

  perform set_config('request.jwt.claim.sub', admin_auth_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', admin_auth_user_id, 'role', 'authenticated')::text,
    true
  );

  perform public.update_settings_staff(
    target_staff.id,
    target_staff.full_name,
    target_staff.phone,
    target_staff.email,
    target_role_id,
    'invited'
  );

  if not exists (
    select 1
    from public.user_roles
    where user_roles.user_profile_id = target_staff.id
      and user_roles.role_id = target_role_id
      and user_roles.user_id is null
  ) then
    raise exception 'Invited role assignment was not preserved without the legacy user_id';
  end if;

  begin
    perform public.update_settings_staff(
      target_staff.id,
      target_staff.full_name,
      target_staff.phone,
      target_staff.email,
      target_role_id,
      'active'
    );
  exception
    when insufficient_privilege then
      active_transition_blocked := true;
  end;

  if not active_transition_blocked then
    raise exception 'Invited staff could be activated without accepting the invitation';
  end if;

  raise notice 'Staff invite management verification passed for profile %', target_staff.id;
end;
$$;

rollback;
