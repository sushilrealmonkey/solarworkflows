-- Remove intermediate project statuses while retaining an accurate workflow
-- position for existing projects. These data changes are system migrations,
-- not user actions, so they must not create staff notifications.
alter table public.projects disable trigger notify_project_workflow;

update public.projects
set
  project_status = case project_status
    when 'material_pending' then 'created'
    when 'installation_in_progress' then 'installation_scheduled'
    when 'inspection_pending' then 'installation_completed'
    else project_status
  end,
  completed_at = case
    when project_status = 'inspection_pending' then coalesce(completed_at, now())
    else completed_at
  end,
  updated_at = now()
where project_status in (
  'material_pending',
  'installation_in_progress',
  'inspection_pending'
);

alter table public.projects enable trigger notify_project_workflow;

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
add constraint projects_status_check
check (project_status in (
  'created',
  'material_dispatched',
  'installation_scheduled',
  'installation_completed',
  'inspection_completed',
  'net_metering_pending',
  'commissioned',
  'cancelled',
  'on_hold'
));

create or replace function public.update_field_project_status(
  target_project_id uuid,
  new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare project_record public.projects%rowtype;
begin
  if not public.user_has_permission('projects','update_status') then
    raise exception 'Installation status permission is required' using errcode = '42501';
  end if;

  select * into project_record from public.projects where id = target_project_id for update;

  if not found or not private.is_assigned_released_field_project(target_project_id) then
    raise exception 'Assigned released project not found' using errcode = '42501';
  end if;

  if not (
    project_record.project_status = 'installation_scheduled'
    and new_status = 'installation_completed'
  ) then
    raise exception 'Unsupported Field Staff installation transition: % -> %', project_record.project_status, new_status
      using errcode = '23514';
  end if;

  update public.projects
  set
    project_status = new_status,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = target_project_id
  returning * into project_record;

  return jsonb_build_object(
    'id', project_record.id,
    'project_status', project_record.project_status,
    'completed_at', project_record.completed_at,
    'updated_at', project_record.updated_at
  );
end;
$$;
