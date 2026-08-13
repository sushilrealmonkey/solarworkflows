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
    or new.daily_message_limit > old.daily_message_limit
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

drop trigger if exists set_whatsapp_campaign_daily_wake_time
on public.whatsapp_campaigns;

create trigger set_whatsapp_campaign_daily_wake_time
before update of status, daily_message_limit, daily_send_time, send_timezone
on public.whatsapp_campaigns
for each row execute function public.set_whatsapp_campaign_daily_wake_time();

create or replace function public.raise_whatsapp_company_daily_message_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    or new.daily_message_limit > old.daily_message_limit then
    insert into public.whatsapp_outreach_settings (
      company_id,
      daily_message_limit
    )
    select new.company_id, new.daily_message_limit
    where new.daily_message_limit > coalesce(
      (
        select settings.daily_message_limit
        from public.whatsapp_outreach_settings as settings
        where settings.company_id = new.company_id
      ),
      100
    )
    on conflict (company_id) do update
    set daily_message_limit = greatest(
      public.whatsapp_outreach_settings.daily_message_limit,
      excluded.daily_message_limit
    );
  end if;
  return new;
end;
$$;

drop trigger if exists raise_whatsapp_company_daily_message_limit
on public.whatsapp_campaigns;

create trigger raise_whatsapp_company_daily_message_limit
after insert or update of daily_message_limit
on public.whatsapp_campaigns
for each row execute function public.raise_whatsapp_company_daily_message_limit();

-- Repair running campaigns whose per-campaign limit had already been raised
-- above the company ceiling before this migration was deployed. The CTE keeps
-- the wake-up scoped to companies whose ceiling is actually raised here.
with requested_limits as (
  select campaigns.company_id, max(campaigns.daily_message_limit) as daily_message_limit
  from public.whatsapp_campaigns as campaigns
  where campaigns.status = 'running'
  group by campaigns.company_id
), raised_companies as (
  update public.whatsapp_outreach_settings as settings
  set daily_message_limit = requested_limits.daily_message_limit
  from requested_limits
  where settings.company_id = requested_limits.company_id
    and settings.daily_message_limit < requested_limits.daily_message_limit
  returning settings.company_id
)
update public.whatsapp_campaigns as campaigns
set next_batch_at = greatest(
  now(),
  (
    ((now() at time zone campaigns.send_timezone)::date + campaigns.daily_send_time)
    at time zone campaigns.send_timezone
  )
)
from raised_companies
where campaigns.company_id = raised_companies.company_id
  and campaigns.status = 'running'
  and exists (
    select 1
    from public.whatsapp_campaign_recipients as queued
    where queued.campaign_id = campaigns.id
      and queued.company_id = campaigns.company_id
      and queued.status = 'queued'
  )
  and (
    select count(*)
    from public.whatsapp_campaign_recipients as attempted
    where attempted.campaign_id = campaigns.id
      and attempted.company_id = campaigns.company_id
      and attempted.attempted_at >= (
        date_trunc('day', now() at time zone campaigns.send_timezone)
        at time zone campaigns.send_timezone
      )
      and attempted.status <> 'skipped'
  ) < campaigns.daily_message_limit;
