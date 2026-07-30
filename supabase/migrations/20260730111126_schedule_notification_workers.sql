-- Schedule notification workers only when their Vault secrets are provisioned.
-- Required Vault entries:
--   notification_worker_project_url
--   notification_worker_secret
--   daily_summary_worker_secret

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
  project_url_exists boolean;
  notification_secret_exists boolean;
  summary_secret_exists boolean;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-tenant-notifications-every-minute';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-daily-summaries-every-15-minutes';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_worker_project_url'
  ) into project_url_exists;
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_worker_secret'
  ) into notification_secret_exists;
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'daily_summary_worker_secret'
  ) into summary_secret_exists;

  if project_url_exists and notification_secret_exists then
    perform cron.schedule(
      'process-tenant-notifications-every-minute',
      '* * * * *',
      $cron$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'notification_worker_project_url'
          ) || '/functions/v1/process-notifications?limit=25',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'notification_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
      $cron$
    );
  else
    raise notice
      'Notification delivery Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;

  if project_url_exists and summary_secret_exists then
    perform cron.schedule(
      'process-daily-summaries-every-15-minutes',
      '*/15 * * * *',
      $cron$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'notification_worker_project_url'
          ) || '/functions/v1/process-daily-summaries',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'daily_summary_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
      $cron$
    );
  else
    raise notice
      'Daily summary Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;
