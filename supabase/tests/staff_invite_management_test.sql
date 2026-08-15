-- Transactional hosted check for the invitation-time role FK regression and
-- the server-side staff lifecycle guards.
begin;

insert into public.companies (id, company_name, company_slug, status)
values (
  '81000000-0000-0000-0000-000000000001',
  'Staff Invite Test Company',
  'staff-invite-test-company',
  'active'
);

insert into public.organizations (id, name, slug, status, company_id)
values (
  '82000000-0000-0000-0000-000000000001',
  'Staff Invite Test Organization',
  'staff-invite-test-org',
  'active',
  '81000000-0000-0000-0000-000000000001'
);

select public.seed_epc_standard_roles('82000000-0000-0000-0000-000000000001');

update public.roles
set company_id = '81000000-0000-0000-0000-000000000001'
where organization_id = '82000000-0000-0000-0000-000000000001';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '83000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'staff-invite-admin@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '83000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'staff-invite-pending@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  '83000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'Staff Invite Admin',
  'staff-invite-admin@example.invalid',
  'active',
  false
);

insert into public.users_profile (
  id, auth_user_id, organization_id, company_id, full_name, email,
  status, email_verified, is_super_admin
)
values
  (
    '84000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'Staff Invite Admin',
    'staff-invite-admin@example.invalid',
    'active',
    true,
    false
  ),
  (
    '84000000-0000-0000-0000-000000000002',
    '83000000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'Pending Staff Invite',
    'staff-invite-pending@example.invalid',
    'invited',
    true,
    false
  );

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  '84000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001',
  roles.id
from public.roles
where roles.organization_id = '82000000-0000-0000-0000-000000000001'
  and roles.role_key = 'admin';

insert into public.user_roles (user_profile_id, role_id)
select
  '84000000-0000-0000-0000-000000000002',
  roles.id
from public.roles
where roles.organization_id = '82000000-0000-0000-0000-000000000001'
  and roles.role_key = 'sales_team';

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
