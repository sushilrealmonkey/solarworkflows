begin;

select plan(9);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_current_onboarding_company_settings(jsonb)'::regprocedure,
    'execute'
  ),
  'authenticated setup owners can execute the onboarding company settings RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.update_current_onboarding_company_settings(jsonb)'::regprocedure,
    'execute'
  ),
  'anon users cannot execute the onboarding company settings RPC'
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
  '84400000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'expired-onboarding-setup-owner@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.companies (id, company_name, company_slug, status)
values (
  '81100000-0000-0000-0000-000000000001',
  'Expired Onboarding Company',
  'expired-onboarding-company-test',
  'active'
);

insert into public.organizations (id, name, slug, subdomain, status, company_id)
values (
  '82200000-0000-0000-0000-000000000001',
  'Expired Onboarding Organization',
  'expired-onboarding-organization-test',
  'expired-onboarding-organization-test',
  'active',
  '81100000-0000-0000-0000-000000000001'
);

select public.seed_epc_standard_roles('82200000-0000-0000-0000-000000000001');

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
  '83300000-0000-0000-0000-000000000001',
  '84400000-0000-0000-0000-000000000001',
  '82200000-0000-0000-0000-000000000001',
  '81100000-0000-0000-0000-000000000001',
  'Expired Onboarding Setup Owner',
  'expired-onboarding-setup-owner@example.invalid',
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
  '84400000-0000-0000-0000-000000000001',
  '82200000-0000-0000-0000-000000000001',
  '81100000-0000-0000-0000-000000000001',
  'Expired Onboarding Setup Owner',
  'expired-onboarding-setup-owner@example.invalid',
  'active',
  false,
  now(),
  now()
);

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  '83300000-0000-0000-0000-000000000001',
  '84400000-0000-0000-0000-000000000001',
  roles.id
from public.roles
where roles.organization_id = '82200000-0000-0000-0000-000000000001'
  and roles.company_id = '81100000-0000-0000-0000-000000000001'
  and roles.role_key = 'admin';

update public.company_subscriptions
set
  status = 'expired',
  trial_started_at = null,
  trial_ends_at = null,
  current_period_started_at = null,
  current_period_ends_at = null
where company_id = '81100000-0000-0000-0000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  '84400000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"84400000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

set local role authenticated;

select is(
  (
    select (public.start_current_company_onboarding()).current_step
  ),
  'company',
  'the setup owner can start company onboarding after the trial expires'
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
    select (public.update_current_onboarding_company_settings(
      '{
        "company_name":"Completed Onboarding Company",
        "gst_number":"03ABCDE1234F1Z5",
        "contact_phone":"+91 98765 43210",
        "contact_email":"owner@example.invalid",
        "address":"Chandigarh"
      }'::jsonb
    )).company_name
  ),
  'Completed Onboarding Company',
  'the setup owner can save the permitted company setup fields after the trial expires'
);

insert into storage.objects (bucket_id, name)
values (
  'company-branding',
  '82200000-0000-0000-0000-000000000001/logos/onboarding-logo.png'
);

select ok(
  exists (
    select 1
    from storage.objects
    where bucket_id = 'company-branding'
      and name = '82200000-0000-0000-0000-000000000001/logos/onboarding-logo.png'
  ),
  'the setup owner can upload a company logo during the company setup step'
);

select throws_ok(
  $$
    select public.update_current_onboarding_company_settings(
      '{"bank_name":"Not permitted during onboarding"}'::jsonb
    )
  $$,
  '42501',
  'Only company setup fields can be updated during onboarding',
  'the onboarding RPC rejects non-company-setup settings'
);

select is(
  (
    select (public.advance_current_company_onboarding('products')).current_step
  ),
  'products',
  'the setup owner can leave the company setup step'
);

select throws_ok(
  $$
    select public.update_current_onboarding_company_settings(
      '{"company_name":"Late update"}'::jsonb
    )
  $$,
  '42501',
  'Only the active setup owner can update onboarding company details',
  'the onboarding RPC closes when the company setup step ends'
);

reset role;
rollback;
