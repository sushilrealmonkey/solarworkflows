-- Transactional hosted check that subscription read-only mode preserves
-- tenant-scoped settings and staff reads without restoring write access.
begin;

insert into public.companies (id, company_name, company_slug, status)
values (
  '71000000-0000-0000-0000-000000000001',
  'Read Only Settings Test Company',
  'read-only-settings-test-company',
  'active'
);

insert into public.organizations (id, name, slug, status, company_id)
values (
  '72000000-0000-0000-0000-000000000001',
  'Read Only Settings Test Organization',
  'read-only-settings-test-org',
  'active',
  '71000000-0000-0000-0000-000000000001'
);

select public.seed_epc_standard_roles('72000000-0000-0000-0000-000000000001');

update public.roles
set company_id = '71000000-0000-0000-0000-000000000001'
where organization_id = '72000000-0000-0000-0000-000000000001';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '73000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'read-only-settings-admin@example.invalid',
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
  '73000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'Read Only Settings Admin',
  'read-only-settings-admin@example.invalid',
  'active',
  false
);

insert into public.users_profile (
  id, auth_user_id, organization_id, company_id, full_name, email,
  status, email_verified, is_super_admin
)
values (
  '74000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'Read Only Settings Admin',
  'read-only-settings-admin@example.invalid',
  'active',
  true,
  false
);

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  '74000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000001',
  roles.id
from public.roles
where roles.organization_id = '72000000-0000-0000-0000-000000000001'
  and roles.role_key = 'admin';

do $$
declare
  admin_profile public.users_profile%rowtype;
  settings_update_blocked boolean := false;
begin
  select users_profile.*
  into admin_profile
  from public.users_profile
  join public.user_roles
    on user_roles.user_profile_id = users_profile.id
      or user_roles.user_id = users_profile.auth_user_id
  join public.roles
    on roles.id = user_roles.role_id
      and roles.organization_id = users_profile.organization_id
  join public.company_subscriptions
    on company_subscriptions.company_id = users_profile.company_id
  where users_profile.status = 'active'
    and users_profile.auth_user_id is not null
    and roles.role_key = 'admin'
  limit 1;

  if admin_profile.id is null then
    raise exception 'No active tenant admin with a subscription is available for verification';
  end if;

  update public.company_subscriptions
  set status = 'expired', updated_at = now()
  where company_id = admin_profile.company_id;

  perform set_config('request.jwt.claim.sub', admin_profile.auth_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', admin_profile.auth_user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  if not public.user_has_permission('settings', 'view') then
    raise exception 'Read-only tenant admin lost settings:view access';
  end if;

  if public.user_has_permission('settings', 'update') then
    raise exception 'Read-only tenant admin unexpectedly retained settings:update access';
  end if;

  if exists (
    select 1
    from public.get_settings_staff()
    where organization_id is distinct from admin_profile.organization_id
  ) then
    raise exception 'Read-only staff results escaped the current tenant';
  end if;

  if not exists (
    select 1
    from public.get_settings_staff()
    where id = admin_profile.id
  ) then
    raise exception 'Read-only staff results did not include the current tenant admin';
  end if;

  begin
    perform public.require_settings_update();
  exception
    when insufficient_privilege then
      settings_update_blocked := true;
  end;

  if not settings_update_blocked then
    raise exception 'Read-only tenant admin could still enter a settings mutation';
  end if;

  raise notice 'Read-only settings visibility verification passed for profile %',
    admin_profile.id;
end;
$$;

rollback;
