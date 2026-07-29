create or replace function public.get_whatsapp_worker_health()
returns table (
  cron_active boolean,
  last_run_at timestamptz,
  last_run_status text,
  last_http_status integer,
  last_response text,
  next_run_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    jobs.active,
    runs.start_time,
    runs.status,
    responses.status_code,
    responses.content,
    date_trunc('minute', now()) + interval '1 minute'
  from cron.job as jobs
  left join lateral (
    select details.start_time, details.status
    from cron.job_run_details as details
    where details.jobid = jobs.jobid
    order by details.runid desc
    limit 1
  ) as runs on true
  left join lateral (
    select response.status_code, response.content
    from net._http_response as response
    order by response.created desc
    limit 1
  ) as responses on true
  where jobs.jobname = 'process-whatsapp-campaigns-every-minute'
  limit 1;
$$;

revoke all on function public.get_whatsapp_worker_health()
from public, anon, authenticated;
grant execute on function public.get_whatsapp_worker_health()
to service_role;
