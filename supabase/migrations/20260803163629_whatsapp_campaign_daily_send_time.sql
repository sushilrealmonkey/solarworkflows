alter table public.whatsapp_campaigns
  add column daily_send_time time without time zone not null default time '09:00',
  add column send_timezone text not null default 'UTC'
    check (btrim(send_timezone) <> '');

create or replace function public.set_whatsapp_campaign_daily_wake_time()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  today_send_at timestamptz;
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.send_timezone
  ) then
    raise exception 'Invalid campaign timezone' using errcode = '22023';
  end if;

  if new.status = 'running' and (
    old.status is distinct from 'running'
    or old.daily_send_time is distinct from new.daily_send_time
    or old.send_timezone is distinct from new.send_timezone
  ) then
    today_send_at := (
      ((now() at time zone new.send_timezone)::date + new.daily_send_time)
      at time zone new.send_timezone
    );
    new.next_batch_at := greatest(now(), today_send_at);
  end if;
  return new;
end;
$$;

create trigger set_whatsapp_campaign_daily_wake_time
before update of status, daily_send_time, send_timezone
on public.whatsapp_campaigns
for each row execute function public.set_whatsapp_campaign_daily_wake_time();

-- Keep the established, service-role-only claim function while changing its
-- day boundary and next-day wake-up to the campaign's local timezone.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.claim_whatsapp_campaign_batch(integer,text[],integer)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    'recipients.attempted_at >= date_trunc(''day'', now())',
    'recipients.attempted_at >= (date_trunc(''day'', now() at time zone target_campaign.send_timezone) at time zone target_campaign.send_timezone)'
  );
  function_definition := replace(
    function_definition,
    'date_trunc(''day'', now()) + interval ''1 day''',
    '((((now() at time zone target_campaign.send_timezone)::date + 1) + target_campaign.daily_send_time) at time zone target_campaign.send_timezone)'
  );

  if function_definition not like '%target_campaign.send_timezone%' then
    raise exception 'Could not update WhatsApp campaign worker timezone logic';
  end if;

  execute function_definition;
end;
$$;
