-- Onboarding rollout, provisioning, ownership, RPC, and tenant-isolation tests.
begin;

select plan(33);

select is(
  (
    select constraints.contype::text
    from pg_constraint as constraints
    where constraints.conrelid = 'public.company_onboarding_progress'::regclass
      and constraints.contype = 'p'
      and constraints.conkey = array[
        (
          select attributes.attnum
          from pg_attribute as attributes
          where attributes.attrelid = constraints.conrelid
            and attributes.attname = 'company_id'
        )
      ]::smallint[]
  ),
  'p',
  'company_id is the primary key and permits exactly one onboarding row per company'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.company_onboarding_progress'::regclass
  ),
  'company_onboarding_progress has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.company_onboarding_progress', 'select'),
  'anon cannot read company onboarding progress'
);

select ok(
  not has_table_privilege('authenticated', 'public.company_onboarding_progress', 'update'),
  'authenticated cannot update onboarding rows directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_current_company_onboarding_progress()'::regprocedure,
    'execute'
  ),
  'authenticated can fetch its tenant onboarding progress'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.start_current_company_onboarding()'::regprocedure,
    'execute'
  ),
  'anon cannot start onboarding'
);

-- Fixed transaction-local identifiers keep all assertions deterministic.
insert into public.companies (id, company_name, company_slug, status)
values
  ('10000000-0000-0000-0000-000000000001', 'Onboarding Owner RPC Test', 'onboarding-owner-rpc-test', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'Onboarding Cross Tenant Test', 'onboarding-cross-tenant-test', 'active'),
  ('10000000-0000-0000-0000-000000000003', 'Onboarding Owner Immutability Test', 'onboarding-owner-immutability-test', 'active');

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  'pending/welcome',
  'a future company initializes as pending/welcome'
);

insert into public.organizations (id, name, slug, subdomain, status, company_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'Onboarding Owner RPC Test',
    'onboarding-owner-rpc-test',
    'onboarding-owner-rpc-test',
    'active',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Onboarding Cross Tenant Test',
    'onboarding-cross-tenant-test',
    'onboarding-cross-tenant-test',
    'active',
    '10000000-0000-0000-0000-000000000002'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Onboarding Owner Immutability Test',
    'onboarding-owner-immutability-test',
    'onboarding-owner-immutability-test',
    'active',
    '10000000-0000-0000-0000-000000000003'
  );

do $$
begin
  perform public.seed_epc_standard_roles('20000000-0000-0000-0000-000000000001');
  perform public.seed_epc_standard_roles('20000000-0000-0000-0000-000000000002');
  perform public.seed_epc_standard_roles('20000000-0000-0000-0000-000000000003');
end;
$$;

update public.roles
set company_id = organizations.company_id
from public.organizations
where roles.organization_id = organizations.id
  and organizations.id in (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003'
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
values
  (
    '30000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'onboarding-owner@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'onboarding-cross-tenant-owner@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.users_profile (
  id,
  auth_user_id,
  organization_id,
  company_id,
  full_name,
  email,
  status,
  email_verified,
  is_super_admin
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Onboarding Valid Owner',
    'onboarding-owner@example.invalid',
    'active',
    true,
    false
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'Onboarding Cross Tenant Owner',
    'onboarding-cross-tenant-owner@example.invalid',
    'active',
    true,
    false
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    null,
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000003',
    'Onboarding Initial Invited Admin',
    'onboarding-initial-admin@example.invalid',
    'invited',
    false,
    false
  );

insert into public.user_roles (user_profile_id, role_id)
select profiles.id, roles.id
from public.users_profile as profiles
join public.roles as roles
  on roles.organization_id = profiles.organization_id
  and roles.company_id = profiles.company_id
  and roles.role_key = 'admin'
where profiles.id in (
  '40000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000003'
);

select is(
  (
    select setup_owner_profile_id
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  '40000000-0000-0000-0000-000000000003'::uuid,
  'the first invited tenant Admin is captured as setup owner'
);

select ok(
  (
    select setup_owner_assigned_at is not null
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  'automatic setup-owner assignment records its immutable sentinel'
);

-- A second invited Admin must not replace the original setup owner.
insert into public.users_profile (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  '40000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003',
  'Onboarding Second Invited Admin',
  'onboarding-second-admin@example.invalid',
  'invited',
  false
);

insert into public.user_roles (user_profile_id, role_id)
select
  '40000000-0000-0000-0000-000000000004',
  roles.id
from public.roles as roles
where roles.organization_id = '20000000-0000-0000-0000-000000000003'
  and roles.role_key = 'admin';

select is(
  (
    select setup_owner_profile_id
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  '40000000-0000-0000-0000-000000000003'::uuid,
  'a second invited Admin cannot replace the initial setup owner'
);

-- An invited non-Admin must never become setup owner.
insert into public.users_profile (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  '40000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003',
  'Onboarding Invited Sales User',
  'onboarding-invited-sales@example.invalid',
  'invited',
  false
);

insert into public.user_roles (user_profile_id, role_id)
select
  '40000000-0000-0000-0000-000000000005',
  roles.id
from public.roles as roles
where roles.organization_id = '20000000-0000-0000-0000-000000000003'
  and roles.role_key = 'sales_team';

select is(
  (
    select setup_owner_profile_id
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  '40000000-0000-0000-0000-000000000003'::uuid,
  'an invited non-Admin cannot become setup owner'
);

-- RLS and valid owner RPC behavior use the first active owner's JWT identity.
select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

set local role authenticated;

select is(
  (select count(*)::integer from public.company_onboarding_progress),
  1,
  'RLS exposes only the current active profile company onboarding row'
);

select is(
  (
    select company_id
    from public.get_current_company_onboarding_progress()
  ),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the fetch RPC returns only the current user company'
);

select throws_ok(
  $$
    update public.company_onboarding_progress
    set status = 'deferred'
    where company_id = '10000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table company_onboarding_progress',
  'authenticated users cannot bypass RPC checks with a direct update'
);

select lives_ok(
  $$ select public.start_current_company_onboarding() $$,
  'the valid setup owner can start onboarding'
);

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000001'
  ),
  'in_progress/company',
  'start persists in_progress/company'
);

select lives_ok(
  $$ select public.advance_current_company_onboarding('products') $$,
  'the valid setup owner can advance onboarding'
);

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000001'
  ),
  'in_progress/products',
  'advance persists the requested stable step'
);

select lives_ok(
  $$ select public.defer_current_company_onboarding() $$,
  'the valid setup owner can defer onboarding'
);

select is(
  (
    select status
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000001'
  ),
  'deferred',
  'defer persists deferred status'
);

select lives_ok(
  $$ select public.complete_current_company_onboarding() $$,
  'the valid setup owner can complete onboarding'
);

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000001'
  ),
  'completed/ready',
  'complete persists completed/ready'
);

reset role;

-- Deliberately point another company's pending row at the first profile. Even
-- under this adversarial database state, every RPC must reject the caller
-- because the profile company does not equal the progress company.
update public.company_onboarding_progress
set
  setup_owner_profile_id = '40000000-0000-0000-0000-000000000001',
  setup_owner_assigned_at = coalesce(setup_owner_assigned_at, statement_timestamp())
where company_id = '10000000-0000-0000-0000-000000000002';

set local role authenticated;

select throws_ok(
  $$ select public.start_current_company_onboarding() $$,
  '42501',
  'Only the active setup owner can start company onboarding',
  'a cross-tenant profile cannot start onboarding'
);

select throws_ok(
  $$ select public.advance_current_company_onboarding('team') $$,
  '42501',
  'Only the active setup owner can advance company onboarding',
  'a cross-tenant profile cannot advance onboarding'
);

select throws_ok(
  $$ select public.defer_current_company_onboarding() $$,
  '42501',
  'Only the active setup owner can defer company onboarding',
  'a cross-tenant profile cannot defer onboarding'
);

select throws_ok(
  $$ select public.complete_current_company_onboarding() $$,
  '42501',
  'Only the active setup owner can complete company onboarding',
  'a cross-tenant profile cannot complete onboarding'
);

select is(
  (select count(*)::integer from public.company_onboarding_progress),
  1,
  'cross-tenant onboarding remains unreadable after rejected RPC calls'
);

reset role;

-- Deleting an assigned owner clears the FK but not the assignment sentinel.
delete from public.users_profile
where id = '40000000-0000-0000-0000-000000000003';

select ok(
  (
    select setup_owner_profile_id is null
      and setup_owner_assigned_at is not null
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  'owner deletion clears the FK while preserving the immutable assignment sentinel'
);

insert into public.users_profile (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  '40000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003',
  'Onboarding Admin After Owner Deletion',
  'onboarding-admin-after-delete@example.invalid',
  'invited',
  false
);

insert into public.user_roles (user_profile_id, role_id)
select
  '40000000-0000-0000-0000-000000000006',
  roles.id
from public.roles as roles
where roles.organization_id = '20000000-0000-0000-0000-000000000003'
  and roles.role_key = 'admin';

select ok(
  (
    select setup_owner_profile_id is null
      and setup_owner_assigned_at is not null
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000003'
  ),
  'a later Admin cannot automatically claim ownership after assigned-owner deletion'
);

-- The normal test harness runs after all migrations, so it cannot literally
-- insert a company before this migration. The closest deterministic backfill
-- test creates a company, removes the row made by the future-company trigger,
-- then executes the migration's exact legacy backfill query for that company.
insert into public.companies (id, company_name, company_slug, status)
values (
  '10000000-0000-0000-0000-000000000004',
  'Onboarding Simulated Legacy Company',
  'onboarding-simulated-legacy-company',
  'active'
);

delete from public.company_onboarding_progress
where company_id = '10000000-0000-0000-0000-000000000004';

insert into public.company_onboarding_progress (
  company_id,
  organization_id,
  onboarding_version,
  status,
  current_step,
  completed_at
)
select
  companies.id,
  existing_organization.id,
  1,
  'completed',
  'ready',
  statement_timestamp()
from public.companies
left join lateral (
  select organizations.id
  from public.organizations
  where organizations.company_id = companies.id
  order by organizations.created_at nulls last, organizations.id
  limit 1
) as existing_organization on true
where companies.id = '10000000-0000-0000-0000-000000000004';

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000004'
  ),
  'completed/ready',
  'the deterministic legacy backfill produces completed/ready'
);

select is(
  (
    select count(*)::integer
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000004'
  ),
  1,
  'the simulated existing company has exactly one onboarding row'
);

-- Reuse the real initializer as a trigger on a transaction-local probe table
-- to prove ON CONFLICT DO NOTHING cannot overwrite completed onboarding.
create temp table onboarding_company_initializer_probe (id uuid not null);

create trigger replay_company_onboarding_initializer
after insert on onboarding_company_initializer_probe
for each row execute function private.initialize_company_onboarding();

insert into onboarding_company_initializer_probe (id)
values ('10000000-0000-0000-0000-000000000004');

select is(
  (
    select status || '/' || current_step
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000004'
  ),
  'completed/ready',
  'replayed company initialization cannot overwrite a completed row'
);

-- Later organization/Admin provisioning may attach compatible references, but
-- it must not change completed status or create a setup owner.
insert into public.organizations (
  id, name, slug, subdomain, status, company_id
)
values (
  '20000000-0000-0000-0000-000000000004',
  'Onboarding Simulated Legacy Company',
  'onboarding-simulated-legacy-company',
  'onboarding-simulated-legacy-company',
  'active',
  '10000000-0000-0000-0000-000000000004'
);

select public.seed_epc_standard_roles('20000000-0000-0000-0000-000000000004');

update public.roles
set company_id = '10000000-0000-0000-0000-000000000004'
where organization_id = '20000000-0000-0000-0000-000000000004';

insert into public.users_profile (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  '40000000-0000-0000-0000-000000000007',
  '20000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000004',
  'Onboarding Legacy Invited Admin',
  'onboarding-legacy-admin@example.invalid',
  'invited',
  false
);

insert into public.user_roles (user_profile_id, role_id)
select
  '40000000-0000-0000-0000-000000000007',
  roles.id
from public.roles as roles
where roles.organization_id = '20000000-0000-0000-0000-000000000004'
  and roles.role_key = 'admin';

select ok(
  (
    select status = 'completed'
      and current_step = 'ready'
      and setup_owner_profile_id is null
      and setup_owner_assigned_at is null
    from public.company_onboarding_progress
    where company_id = '10000000-0000-0000-0000-000000000004'
  ),
  'provisioning triggers cannot overwrite a completed existing-company row'
);

select * from finish();
rollback;
