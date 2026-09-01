-- Platform staff can read the explicitly curated company directory and detail
-- RPCs, but cannot use them as a path to general tenant access or mutations.
begin;

select plan(8);

insert into public.companies (id, company_name, company_slug, status)
values (
  'd1000000-0000-0000-0000-000000000001',
  'Platform Staff View Test Company',
  'platform-staff-view-test-company',
  'active'
);

insert into public.organizations (id, name, slug, status, company_id)
values (
  'd2000000-0000-0000-0000-000000000001',
  'Platform Staff View Test Workspace',
  'platform-staff-view-test-workspace',
  'active',
  'd1000000-0000-0000-0000-000000000001'
);

insert into public.organization_settings (
  organization_id, company_name, contact_email, contact_person
)
values (
  'd2000000-0000-0000-0000-000000000001',
  'Platform Staff View Test Company',
  'owner@example.invalid',
  'Workspace Owner'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'd3000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'platform-staff-viewer@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'd3000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'platform-staff-tenant@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.users_profile (
  id, auth_user_id, organization_id, company_id, full_name, email, status,
  is_super_admin, platform_role
)
values
  (
    'd4000000-0000-0000-0000-000000000001',
    'd3000000-0000-0000-0000-000000000001',
    null,
    null,
    'Platform Staff Viewer',
    'platform-staff-viewer@example.invalid',
    'active',
    false,
    'backend_staff'
  ),
  (
    'd4000000-0000-0000-0000-000000000002',
    'd3000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'Tenant User',
    'platform-staff-tenant@example.invalid',
    'active',
    false,
    null
  );

select set_config(
  'request.jwt.claim.sub',
  'd3000000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

set local role authenticated;

select ok(
  public.can_view_epc_companies(),
  'an active backend platform staff member has the company-view capability'
);

select is(
  (
    select count(*)::integer
    from public.platform_epc_company_directory()
    where company ->> 'id' = 'd2000000-0000-0000-0000-000000000001'
  ),
  1,
  'platform staff can find an EPC company in the curated directory'
);

select is(
  public.platform_epc_company_detail('d2000000-0000-0000-0000-000000000001') ->> 'name',
  'Platform Staff View Test Workspace',
  'platform staff can view the selected EPC company detail'
);

select is(
  jsonb_array_length(
    public.platform_epc_company_detail('d2000000-0000-0000-0000-000000000001')
      -> 'tenant_users'
  ),
  1,
  'company detail includes the tenant users associated with that workspace'
);

select is(
  (
    select count(*)::integer
    from public.organizations
    where id = 'd2000000-0000-0000-0000-000000000001'
  ),
  0,
  'platform staff cannot read organization records outside the curated RPC'
);

update public.organizations
set name = 'Unapproved change'
where id = 'd2000000-0000-0000-0000-000000000001';

reset role;

select is(
  (select name from public.organizations where id = 'd2000000-0000-0000-0000-000000000001'),
  'Platform Staff View Test Workspace',
  'platform staff cannot modify the EPC workspace through direct table access'
);

select set_config(
  'request.jwt.claim.sub',
  'd3000000-0000-0000-0000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

set local role authenticated;

select ok(
  not public.can_view_epc_companies(),
  'a tenant user does not receive the company-view capability'
);

select throws_ok(
  $$
    select public.platform_epc_company_detail(
      'd2000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  'Only super admins and active platform staff can view EPC companies',
  'a tenant user cannot invoke the cross-tenant company-detail RPC'
);

reset role;

select * from finish();
rollback;
