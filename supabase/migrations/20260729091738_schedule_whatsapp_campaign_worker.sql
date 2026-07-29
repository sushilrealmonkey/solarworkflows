create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'process-whatsapp-campaigns-every-minute';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  if exists (
    select 1
    from vault.decrypted_secrets
    where name = 'whatsapp_worker_project_url'
  ) and exists (
    select 1
    from vault.decrypted_secrets
    where name = 'whatsapp_campaign_worker_secret'
  ) then
    perform cron.schedule(
      'process-whatsapp-campaigns-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'whatsapp_worker_project_url'
          ) || '/functions/v1/process-whatsapp-campaigns?limit=25',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'whatsapp_campaign_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice
      'WhatsApp worker Cron job was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;
