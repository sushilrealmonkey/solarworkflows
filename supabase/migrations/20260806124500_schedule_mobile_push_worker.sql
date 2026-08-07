-- Schedule the Expo push worker only when its Vault secrets are provisioned.
-- Required Vault entries: mobile_push_worker_project_url, mobile_push_worker_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
  project_url_exists boolean;
  worker_secret_exists boolean;
begin
  select jobid into existing_job_id from cron.job where jobname = 'process-mobile-push-every-minute';
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  select exists (select 1 from vault.decrypted_secrets where name = 'mobile_push_worker_project_url') into project_url_exists;
  select exists (select 1 from vault.decrypted_secrets where name = 'mobile_push_worker_secret') into worker_secret_exists;
  if project_url_exists and worker_secret_exists then
    perform cron.schedule(
      'process-mobile-push-every-minute', '* * * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'mobile_push_worker_project_url') || '/functions/v1/process-mobile-push?limit=100',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobile_push_worker_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
      $cron$
    );
  else
    raise notice 'Mobile push Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;
