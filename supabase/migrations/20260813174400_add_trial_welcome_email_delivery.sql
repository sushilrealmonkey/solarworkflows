-- Deliver the platform trial alert and the tenant owner's welcome as separate,
-- retryable emails. Existing outbox rows remain platform alerts; only trials
-- created after this migration queue the new owner welcome.

alter table public.trial_signup_notification_outbox
add column notification_type text not null default 'platform_alert';

alter table public.trial_signup_notification_outbox
add constraint trial_signup_notification_outbox_notification_type_check
check (notification_type in ('platform_alert', 'trial_welcome'));

alter table public.trial_signup_notification_outbox
drop constraint if exists trial_signup_notification_outbox_subscription_id_key;

alter table public.trial_signup_notification_outbox
add constraint trial_signup_notification_outbox_subscription_type_key
unique (subscription_id, notification_type);

alter table public.trial_signup_notification_outbox
drop constraint if exists trial_signup_notification_outbox_status_check;

alter table public.trial_signup_notification_outbox
add constraint trial_signup_notification_outbox_status_check
check (status in ('pending', 'processing', 'sent', 'failed', 'skipped'));

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
      subscription_id,
      notification_type
    )
    select
      new.company_id,
      new.id,
      delivery.notification_type
    from (
      values
        ('platform_alert'::text),
        ('trial_welcome'::text)
    ) as delivery(notification_type)
    on conflict (subscription_id, notification_type) do nothing;
  end if;

  return new;
end;
$$;

drop function public.claim_trial_signup_notifications(integer);

create function public.claim_trial_signup_notifications(
  batch_size integer default 25
)
returns table (
  id uuid,
  company_id uuid,
  subscription_id uuid,
  notification_type text,
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
    order by outbox.created_at, outbox.notification_type
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
    outbox.notification_type,
    outbox.attempt_count;
end;
$$;

revoke execute on function public.queue_trial_signup_notification()
from public, anon, authenticated;
revoke execute on function public.claim_trial_signup_notifications(integer)
from public, anon, authenticated;
grant execute on function public.claim_trial_signup_notifications(integer)
to service_role;

notify pgrst, 'reload schema';
