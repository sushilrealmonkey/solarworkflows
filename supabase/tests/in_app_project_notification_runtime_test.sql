-- Transactional smoke test: exercises the real project trigger and rolls back.

begin;

insert into public.companies (id, company_name, company_slug, status)
values (
  'b1000000-0000-0000-0000-000000000001',
  'Project Notification Test Company',
  'project-notification-test-company',
  'active'
);

insert into public.organizations (id, name, slug, status, company_id)
values (
  'b2000000-0000-0000-0000-000000000001',
  'Project Notification Test Organization',
  'project-notification-test-org',
  'active',
  'b1000000-0000-0000-0000-000000000001'
);

select public.seed_epc_standard_roles('b2000000-0000-0000-0000-000000000001');

update public.roles
set company_id = 'b1000000-0000-0000-0000-000000000001'
where organization_id = 'b2000000-0000-0000-0000-000000000001';

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'b3000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'project-notification-user@example.invalid',
  '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now()
);

insert into public.profiles (
  id, organization_id, company_id, full_name, email, status, is_super_admin
)
values (
  'b3000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'Project Notification User', 'project-notification-user@example.invalid',
  'active', false
);

insert into public.users_profile (
  id, auth_user_id, organization_id, company_id, full_name, email,
  status, email_verified, is_super_admin
)
values (
  'b4000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'Project Notification User', 'project-notification-user@example.invalid',
  'active', true, false
);

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  'b4000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-000000000001',
  roles.id
from public.roles
where roles.organization_id = 'b2000000-0000-0000-0000-000000000001'
  and roles.role_key = 'admin';

insert into public.customers (
  id, organization_id, full_name, phone, status
)
values (
  'b5000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'Project Notification Customer', '9000000001', 'active'
);

insert into public.projects (
  id, organization_id, company_id, customer_id, project_name, project_status
)
values (
  'b6000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001',
  'b5000000-0000-0000-0000-000000000001',
  'Project Notification Test Project', 'created'
);

do $$
declare
  target_project public.projects%rowtype;
  target_company_id uuid;
  target_event_id uuid;
  expected_recipients integer;
  actual_recipients integer;
begin
  select projects.* into target_project
  from public.projects projects
  join public.organizations organizations on organizations.id = projects.organization_id
  where organizations.company_id is not null
  order by projects.created_at desc
  limit 1;

  if not found then
    raise notice 'No project is available; runtime notification smoke test skipped.';
    return;
  end if;

  select organizations.company_id into target_company_id
  from public.organizations organizations
  where organizations.id = target_project.organization_id;

  select count(*) into expected_recipients
  from public.users_profile profiles
  where profiles.company_id = target_company_id
    and profiles.status = 'active'
    and profiles.auth_user_id is not null;

  update public.projects
  set project_status = case
    when target_project.project_status = 'on_hold' then 'created'
    else 'on_hold'
  end
  where id = target_project.id;

  select events.id into target_event_id
  from public.notification_events events
  where events.company_id = target_company_id
    and events.event_type = 'project_status_changed'
    and events.source_type = 'projects'
    and events.source_record_id = target_project.id::text
    and events.created_at >= transaction_timestamp()
  order by events.created_at desc
  limit 1;

  if target_event_id is null then
    raise exception 'Project status update did not create an in-app notification event';
  end if;

  select count(*) into actual_recipients
  from public.in_app_notification_receipts receipts
  where receipts.company_id = target_company_id
    and receipts.event_id = target_event_id;

  if actual_recipients <> expected_recipients then
    raise exception 'Expected % notification receipts, created %',
      expected_recipients, actual_recipients;
  end if;
end;
$$;

rollback;
