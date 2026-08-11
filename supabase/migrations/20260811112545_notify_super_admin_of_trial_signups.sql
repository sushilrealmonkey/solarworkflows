-- Reliable, tenant-scoped email notifications for new trial workspaces.

create table public.trial_signup_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid not null unique references public.company_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'sent', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trial_signup_notification_outbox_pending_idx
on public.trial_signup_notification_outbox (created_at)
where status in ('pending', 'processing');

create trigger set_trial_signup_notification_outbox_updated_at
before update on public.trial_signup_notification_outbox
for each row execute function public.set_updated_at();

alter table public.trial_signup_notification_outbox enable row level security;
revoke all on public.trial_signup_notification_outbox from anon, authenticated;
grant select, update on public.trial_signup_notification_outbox to service_role;

create or replace function public.queue_trial_signup_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'trialing' then
    insert into public.trial_signup_notification_outbox (
      company_id,
      subscription_id
    )
    values (
      new.company_id,
      new.id
    )
    on conflict (subscription_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger queue_trial_signup_notification
after insert on public.company_subscriptions
for each row execute function public.queue_trial_signup_notification();

create or replace function public.claim_trial_signup_notifications(
  batch_size integer default 25
)
returns table (
  id uuid,
  company_id uuid,
  subscription_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with claimable as (
    select outbox.id
    from public.trial_signup_notification_outbox as outbox
    where (
      outbox.status = 'pending'
      or (
        outbox.status = 'processing'
        and outbox.last_attempt_at < statement_timestamp() - interval '10 minutes'
      )
    )
      and outbox.attempt_count < 5
    order by outbox.created_at
    for update skip locked
    limit least(greatest(batch_size, 1), 100)
  )
  update public.trial_signup_notification_outbox as outbox
  set
    status = 'processing',
    attempt_count = outbox.attempt_count + 1,
    last_attempt_at = statement_timestamp(),
    last_error = null
  from claimable
  where outbox.id = claimable.id
  returning
    outbox.id,
    outbox.company_id,
    outbox.subscription_id,
    outbox.attempt_count;
end;
$$;

revoke execute on function public.queue_trial_signup_notification() from public, anon, authenticated;
revoke execute on function public.claim_trial_signup_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_trial_signup_notifications(integer) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'process-bizlee-trial-signups-every-minute';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  if exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_signup_notification_project_url'
  ) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_signup_notification_worker_secret'
  ) then
    perform cron.schedule(
      'process-bizlee-trial-signups-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'trial_signup_notification_project_url'
          ) || '/functions/v1/process-trial-signups',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'trial_signup_notification_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice
      'Trial signup notification Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
