alter table public.whatsapp_campaigns
  add column daily_message_limit integer not null default 10
    check (daily_message_limit between 1 and 10000);

alter table public.whatsapp_campaign_recipients
  add column crm_marked_at timestamptz,
  add column crm_marked_by uuid references auth.users(id) on delete set null;

create index whatsapp_campaign_recipients_daily_queue_idx
on public.whatsapp_campaign_recipients (campaign_id, status, created_at);

create or replace function public.claim_whatsapp_campaign_batch(
  p_limit integer,
  p_allowed_phone_numbers text[],
  p_max_batch_duration_seconds integer
)
returns table (
  recipient_id uuid,
  campaign_id uuid,
  company_id uuid,
  contact_id uuid,
  phone_number text,
  contact_name text,
  custom_fields jsonb,
  whatsapp_phone_number_id uuid,
  meta_phone_number_id text,
  template_name text,
  template_language text,
  variable_mappings jsonb,
  delay_seconds integer,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_campaign public.whatsapp_campaigns%rowtype;
  claim_limit integer;
  claimed_count integer;
  allocated_today integer;
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Worker batch limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_max_batch_duration_seconds < 1 or p_max_batch_duration_seconds > 300 then
    raise exception 'Worker batch duration must be between 1 and 300 seconds' using errcode = '22023';
  end if;

  select campaigns.* into target_campaign
  from public.whatsapp_campaigns as campaigns
  where campaigns.status in ('running', 'scheduled')
    and (campaigns.scheduled_at is null or campaigns.scheduled_at <= now())
    and campaigns.next_batch_at <= now()
  order by campaigns.scheduled_at nulls first, campaigns.started_at nulls first, campaigns.created_at
  for update skip locked
  limit 1;

  if not found then return; end if;

  if target_campaign.status = 'scheduled' then
    update public.whatsapp_campaigns
    set status = 'running', started_at = coalesce(started_at, now())
    where id = target_campaign.id;
  end if;

  update public.whatsapp_campaign_recipients as recipients
  set status = 'skipped', processing_started_at = null,
      failure_reason = case
        when contacts.consent_status <> 'confirmed' or contacts.opted_out_at is not null
          then 'Contact is not opted in'
        else 'Recipient is not in the test allowlist'
      end
  from public.whatsapp_contacts as contacts
  where recipients.campaign_id = target_campaign.id
    and recipients.contact_id = contacts.id
    and recipients.company_id = contacts.company_id
    and recipients.status = 'queued'
    and (contacts.consent_status <> 'confirmed' or contacts.opted_out_at is not null
      or (p_allowed_phone_numbers is not null
        and not (contacts.phone_number = any(p_allowed_phone_numbers))));

  select count(*) into allocated_today
  from public.whatsapp_campaign_recipients as recipients
  where recipients.campaign_id = target_campaign.id
    and recipients.attempted_at >= date_trunc('day', now())
    and recipients.status <> 'skipped';

  if allocated_today >= target_campaign.daily_message_limit then
    update public.whatsapp_campaigns
    set next_batch_at = date_trunc('day', now()) + interval '1 day'
    where id = target_campaign.id;
    return;
  end if;

  claim_limit := least(
    p_limit,
    target_campaign.batch_size,
    target_campaign.daily_message_limit - allocated_today,
    greatest(1, (p_max_batch_duration_seconds / greatest(target_campaign.delay_seconds, 1)) + 1)
  );

  return query
  with candidates as (
    select recipients.id
    from public.whatsapp_campaign_recipients as recipients
    join public.whatsapp_contacts as contacts
      on contacts.id = recipients.contact_id and contacts.company_id = recipients.company_id
    where recipients.campaign_id = target_campaign.id
      and recipients.status in ('queued', 'processing')
      and recipients.attempt_count < 10
      and recipients.next_attempt_at <= now()
      and (recipients.status = 'queued'
        or recipients.processing_started_at < now() - interval '10 minutes')
      and contacts.consent_status = 'confirmed'
      and contacts.opted_out_at is null
      and (p_allowed_phone_numbers is null or contacts.phone_number = any(p_allowed_phone_numbers))
    order by recipients.created_at
    for update of recipients skip locked
    limit claim_limit
  ), claimed as (
    update public.whatsapp_campaign_recipients as recipients
    set status = 'processing', processing_started_at = now(), attempted_at = now(),
        attempt_count = recipients.attempt_count + 1, failure_reason = null
    from candidates
    where recipients.id = candidates.id
    returning recipients.*
  )
  select claimed.id, claimed.campaign_id, claimed.company_id, claimed.contact_id,
    contacts.phone_number, contacts.name, contacts.custom_fields,
    target_campaign.whatsapp_phone_number_id, phone_numbers.meta_phone_number_id,
    target_campaign.template_name, target_campaign.template_language,
    target_campaign.variable_mappings, target_campaign.delay_seconds, claimed.attempt_count
  from claimed
  join public.whatsapp_contacts as contacts
    on contacts.id = claimed.contact_id and contacts.company_id = claimed.company_id
  join public.whatsapp_phone_numbers as phone_numbers
    on phone_numbers.id = target_campaign.whatsapp_phone_number_id
    and phone_numbers.company_id = target_campaign.company_id;

  get diagnostics claimed_count = row_count;

  update public.whatsapp_campaigns
  set next_batch_at = now() + make_interval(
    secs => greatest(target_campaign.delay_seconds, 1) * greatest(claimed_count, 1))
  where id = target_campaign.id;

  if not exists (
    select 1 from public.whatsapp_campaign_recipients as recipients
    where recipients.campaign_id = target_campaign.id
      and recipients.status in ('queued', 'processing')
  ) then
    update public.whatsapp_campaigns set status = 'completed', completed_at = now()
    where id = target_campaign.id and status = 'running';
  end if;
end;
$$;

revoke all on function public.claim_whatsapp_campaign_batch(integer, text[], integer)
from public, anon, authenticated;
grant execute on function public.claim_whatsapp_campaign_batch(integer, text[], integer)
to service_role;
