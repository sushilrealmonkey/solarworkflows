-- Keep the daily WhatsApp summary worker scheduled even when the Vault secrets
-- are added after this migration has been applied. Earlier installations only
-- created the job if every secret already existed, leaving enabled summaries
-- permanently inactive when secret provisioning happened later.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'process-daily-summaries-every-15-minutes';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

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
      )
      where exists (
        select 1
        from vault.decrypted_secrets
        where name = 'notification_worker_project_url'
      )
        and exists (
          select 1
          from vault.decrypted_secrets
          where name = 'daily_summary_worker_secret'
        );
    $cron$
  );
end;
$migration$;
