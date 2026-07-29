-- Atomic, service-role-only queue claiming for the WhatsApp campaign worker.
-- This migration does not send messages.

alter table public.whatsapp_campaign_recipients
  add column attempt_count integer not null default 0
    check (attempt_count between 0 and 10),
  add column next_attempt_at timestamptz not null default now(),
  add column processing_started_at timestamptz;

create index whatsapp_campaign_recipients_claim_idx
on public.whatsapp_campaign_recipients (
  campaign_id,
  status,
  next_attempt_at,
  created_at
);

create or replace function public.claim_whatsapp_campaign_batch(
  p_limit integer default 25
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
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Worker batch limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  select campaigns.*
  into target_campaign
  from public.whatsapp_campaigns as campaigns
  where campaigns.status = 'running'
    and (campaigns.scheduled_at is null or campaigns.scheduled_at <= now())
  order by campaigns.started_at nulls first, campaigns.created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  claim_limit := least(p_limit, target_campaign.batch_size);

  return query
  with candidates as (
    select recipients.id
    from public.whatsapp_campaign_recipients as recipients
    join public.whatsapp_contacts as contacts
      on contacts.id = recipients.contact_id
      and contacts.company_id = recipients.company_id
    where recipients.campaign_id = target_campaign.id
      and recipients.status in ('queued', 'processing')
      and recipients.attempt_count < 10
      and recipients.next_attempt_at <= now()
      and (
        recipients.status = 'queued'
        or recipients.processing_started_at < now() - interval '10 minutes'
      )
      and contacts.consent_status = 'confirmed'
      and contacts.opted_out_at is null
    order by recipients.created_at
    for update of recipients skip locked
    limit claim_limit
  ),
  claimed as (
    update public.whatsapp_campaign_recipients as recipients
    set
      status = 'processing',
      processing_started_at = now(),
      attempted_at = now(),
      attempt_count = recipients.attempt_count + 1,
      failure_reason = null
    from candidates
    where recipients.id = candidates.id
    returning recipients.*
  )
  select
    claimed.id,
    claimed.campaign_id,
    claimed.company_id,
    claimed.contact_id,
    contacts.phone_number,
    contacts.name,
    contacts.custom_fields,
    target_campaign.whatsapp_phone_number_id,
    phone_numbers.meta_phone_number_id,
    target_campaign.template_name,
    target_campaign.template_language,
    target_campaign.variable_mappings,
    target_campaign.delay_seconds,
    claimed.attempt_count
  from claimed
  join public.whatsapp_contacts as contacts
    on contacts.id = claimed.contact_id
    and contacts.company_id = claimed.company_id
  join public.whatsapp_phone_numbers as phone_numbers
    on phone_numbers.id = target_campaign.whatsapp_phone_number_id
    and phone_numbers.company_id = target_campaign.company_id;

  if not exists (
    select 1
    from public.whatsapp_campaign_recipients as recipients
    where recipients.campaign_id = target_campaign.id
      and recipients.status in ('queued', 'processing')
  ) then
    update public.whatsapp_campaigns
    set status = 'completed', completed_at = now()
    where id = target_campaign.id and status = 'running';
  end if;
end;
$$;

create or replace function public.release_whatsapp_campaign_batch(
  p_recipient_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  released_count integer;
begin
  update public.whatsapp_campaign_recipients
  set
    status = 'queued',
    processing_started_at = null,
    attempted_at = null,
    attempt_count = greatest(attempt_count - 1, 0)
  where id = any(p_recipient_ids)
    and status = 'processing';

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.claim_whatsapp_campaign_batch(integer)
from public, anon, authenticated;
revoke all on function public.release_whatsapp_campaign_batch(uuid[])
from public, anon, authenticated;
grant execute on function public.claim_whatsapp_campaign_batch(integer)
to service_role;
grant execute on function public.release_whatsapp_campaign_batch(uuid[])
to service_role;
