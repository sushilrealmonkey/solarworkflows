-- Transactional smoke test: exercises the real project trigger and rolls back.

begin;

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
