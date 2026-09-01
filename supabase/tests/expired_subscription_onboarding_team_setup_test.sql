begin;

select plan(11);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_settings_roles()'::regprocedure,
    'execute'
  ),
  'authenticated users can load onboarding team roles'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_settings_roles()'::regprocedure,
    'execute'
  ),
  'anonymous users cannot load onboarding team roles'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '94400000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'expired-onboarding-team-owner@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.companies (id, company_name, company_slug, status)
values (
  '91100000-0000-0000-0000-000000000001',
  'Expired Team Onboarding Company',
  'expired-team-onboarding-company-test',
  'active'
);

insert into public.organizations (id, name, slug, subdomain, status, company_id)
values (
  '92200000-0000-0000-0000-000000000001',
  'Expired Team Onboarding Organization',
  'expired-team-onboarding-organization-test',
  'expired-team-onboarding-organization-test',
  'active',
  '91100000-0000-0000-0000-000000000001'
);

select public.seed_epc_standard_roles('92200000-0000-0000-0000-000000000001');

insert into public.users_profile (
  id,
  auth_user_id,
  organization_id,
  company_id,
  full_name,
  email,
  status,
  is_super_admin
)
values (
  '93300000-0000-0000-0000-000000000001',
  '94400000-0000-0000-0000-000000000001',
  '92200000-0000-0000-0000-000000000001',
  '91100000-0000-0000-0000-000000000001',
  'Expired Team Onboarding Owner',
  'expired-onboarding-team-owner@example.invalid',
  'active',
  false
);

insert into public.profiles (
  id,
  organization_id,
  company_id,
  full_name,
  email,
  status,
  is_super_admin,
  created_at,
  updated_at
)
values (
  '94400000-0000-0000-0000-000000000001',
  '92200000-0000-0000-0000-000000000001',
  '91100000-0000-0000-0000-000000000001',
  'Expired Team Onboarding Owner',
  'expired-onboarding-team-owner@example.invalid',
  'active',
  false,
  now(),
  now()
);

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  '93300000-0000-0000-0000-000000000001',
  '94400000-0000-0000-0000-000000000001',
  role.id
from public.roles as role
where role.organization_id = '92200000-0000-0000-0000-000000000001'
  and role.company_id = '91100000-0000-0000-0000-000000000001'
  and role.role_key = 'admin';

update public.company_subscriptions
set
  status = 'expired',
  trial_started_at = null,
  trial_ends_at = null,
  current_period_started_at = null,
  current_period_ends_at = null
where company_id = '91100000-0000-0000-0000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  '94400000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"94400000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

set local role authenticated;

select is(
  (
    select (public.start_current_company_onboarding()).current_step
  ),
  'company',
  'the setup owner can start onboarding after the trial expires'
);

select is(
  (
    select (public.advance_current_company_onboarding('team')).current_step
  ),
  'team',
  'the setup owner can reach the Team step after the trial expires'
);

select throws_ok(
  $$
    select public.update_organization_settings(
      '{"company_name":"Blocked generic update"}'::jsonb
    )
  $$,
  '42501',
  'Missing permission to update organization settings',
  'expired subscriptions remain blocked from the general settings RPC'
);

select is(
  (
    select count(*)::integer
    from public.get_settings_roles()
  ),
  5,
  'the setup owner can load the five standard roles during Team setup'
);

select is(
  (
    select count(*)::integer
    from public.get_settings_staff()
  ),
  1,
  'the setup owner can load staff in their organization during Team setup'
);

select lives_ok(
  $$
    select public.create_settings_staff(
      'Invited Team Member',
      null,
      'invited-team-member@example.invalid',
      (
        select role.id
        from public.roles as role
        where role.organization_id = '92200000-0000-0000-0000-000000000001'
          and role.role_key = 'sales_team'
      ),
      'invited'
    )
  $$,
  'the setup owner can invite a staff member during Team setup'
);

select ok(
  exists (
    select 1
    from public.users_profile
    where organization_id = '92200000-0000-0000-0000-000000000001'
      and email = 'invited-team-member@example.invalid'
      and status = 'invited'
  ),
  'the invited team member is restricted to the setup owner organization'
);

select is(
  (
    select (public.advance_current_company_onboarding('products')).current_step
  ),
  'products',
  'the setup owner can leave the Team step'
);

select throws_ok(
  $$ select public.get_settings_roles() $$,
  '42501',
  'Missing settings:update permission',
  'the Team setup exception closes as soon as the step changes'
);

reset role;
rollback;
