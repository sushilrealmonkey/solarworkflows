-- A utility-agnostic DISCOM workflow is tracked independently from the
-- installation project status. This keeps operational delivery and regulatory
-- progress visible without tying a tenant to a particular DISCOM's terminology.
alter table public.projects
add column if not exists discom_status text;

alter table public.projects
drop constraint if exists projects_discom_status_check;

alter table public.projects
add constraint projects_discom_status_check
check (
  discom_status is null or discom_status in (
    'application_submitted',
    'feasibility_approved',
    'inspection_scheduled',
    'inspection_completed',
    'net_meter_installed',
    'completed',
    'on_hold',
    'rejected'
  )
);

create index if not exists projects_company_discom_status_idx
on public.projects (company_id, discom_status)
where discom_status is not null;

notify pgrst, 'reload schema';
