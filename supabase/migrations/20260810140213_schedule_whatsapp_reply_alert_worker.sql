-- Re-run notification-worker scheduling after provisioning the Vault entries
-- required by the original notification rollout migration.

do $migration$
declare
  existing_job_id bigint;
  project_url_exists boolean;
  worker_secret_exists boolean;
begin
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_worker_project_url'
  ) into project_url_exists;
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_worker_secret'
  ) into worker_secret_exists;

  if not project_url_exists or not worker_secret_exists then
    raise exception 'Notification worker Vault secrets must be provisioned before scheduling';
  end if;

  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-tenant-notifications-every-minute';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'process-tenant-notifications-every-minute',
    '* * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'notification_worker_project_url'
        ) || '/functions/v1/process-notifications?limit=25',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'notification_worker_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
      );
    $cron$
  );
end;
$migration$;
