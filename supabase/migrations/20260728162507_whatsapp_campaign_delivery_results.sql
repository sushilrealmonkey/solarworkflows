-- Atomically record provider acceptance or retry/failure for a claimed
-- WhatsApp campaign recipient. Service role is the only caller.

create or replace function public.complete_whatsapp_campaign_recipient(
  p_recipient_id uuid,
  p_meta_message_id text,
  p_sent_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_recipient public.whatsapp_campaign_recipients%rowtype;
  target_campaign public.whatsapp_campaigns%rowtype;
  target_contact public.whatsapp_contacts%rowtype;
  target_phone public.whatsapp_phone_numbers%rowtype;
  target_conversation_id uuid;
  target_message_id uuid;
begin
  if nullif(btrim(p_meta_message_id), '') is null then
    raise exception 'Meta message ID is required' using errcode = '22023';
  end if;

  select * into target_recipient
  from public.whatsapp_campaign_recipients
  where id = p_recipient_id
  for update;

  if not found or target_recipient.status <> 'processing' then
    raise exception 'Campaign recipient is not processing'
      using errcode = '55000';
  end if;

  select * into strict target_campaign
  from public.whatsapp_campaigns
  where id = target_recipient.campaign_id;
  select * into strict target_contact
  from public.whatsapp_contacts
  where id = target_recipient.contact_id;
  select * into strict target_phone
  from public.whatsapp_phone_numbers
  where id = target_campaign.whatsapp_phone_number_id;

  insert into public.whatsapp_conversations (
    company_id, whatsapp_phone_number_id, contact_wa_id, contact_name,
    last_message_at
  )
  values (
    target_recipient.company_id, target_phone.id, target_contact.phone_number,
    target_contact.name, coalesce(p_sent_at, now())
  )
  on conflict (company_id, whatsapp_phone_number_id, contact_wa_id)
  do update set
    contact_name = coalesce(excluded.contact_name, whatsapp_conversations.contact_name),
    last_message_at = greatest(whatsapp_conversations.last_message_at, excluded.last_message_at),
    updated_at = now()
  returning id into target_conversation_id;

  insert into public.whatsapp_messages (
    company_id, conversation_id, whatsapp_phone_number_id, meta_message_id,
    direction, message_type, status, sender_wa_id, text_body,
    source_timestamp, sent_at, raw_payload
  )
  values (
    target_recipient.company_id, target_conversation_id, target_phone.id,
    btrim(p_meta_message_id), 'outbound', 'template', 'sent',
    coalesce(target_phone.display_phone_number, target_phone.meta_phone_number_id),
    target_campaign.template_name, coalesce(p_sent_at, now()),
    coalesce(p_sent_at, now()),
    jsonb_build_object(
      'campaignId', target_campaign.id,
      'campaignRecipientId', target_recipient.id,
      'templateName', target_campaign.template_name,
      'language', target_campaign.template_language
    )
  )
  returning id into target_message_id;

  update public.whatsapp_campaign_recipients
  set
    status = 'sent',
    whatsapp_message_id = target_message_id,
    processing_started_at = null,
    failure_reason = null
  where id = target_recipient.id;

  perform public.finish_whatsapp_campaign_if_settled(target_campaign.id);
  return target_message_id;
end;
$$;

create or replace function public.finish_whatsapp_campaign_if_settled(
  p_campaign_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.whatsapp_campaigns
  set status = 'completed', completed_at = now()
  where id = p_campaign_id
    and status = 'running'
    and not exists (
      select 1 from public.whatsapp_campaign_recipients
      where campaign_id = p_campaign_id
        and status in ('queued', 'processing')
    );
  return found;
end;
$$;

create or replace function public.fail_whatsapp_campaign_recipient(
  p_recipient_id uuid,
  p_failure_reason text,
  p_retryable boolean
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_recipient public.whatsapp_campaign_recipients%rowtype;
  next_status text;
  retry_delay_seconds integer;
begin
  select * into target_recipient
  from public.whatsapp_campaign_recipients
  where id = p_recipient_id
  for update;

  if not found or target_recipient.status <> 'processing' then
    raise exception 'Campaign recipient is not processing'
      using errcode = '55000';
  end if;

  next_status := case
    when p_retryable and target_recipient.attempt_count < 10 then 'queued'
    else 'failed'
  end;
  retry_delay_seconds := least(
    3600,
    (60 * power(2, greatest(target_recipient.attempt_count - 1, 0)))::integer
  );

  update public.whatsapp_campaign_recipients
  set
    status = next_status,
    processing_started_at = null,
    next_attempt_at = case
      when next_status = 'queued'
        then now() + make_interval(secs => retry_delay_seconds)
      else next_attempt_at
    end,
    failure_reason = left(coalesce(nullif(btrim(p_failure_reason), ''), 'Unknown failure'), 2000)
  where id = target_recipient.id;

  perform public.finish_whatsapp_campaign_if_settled(target_recipient.campaign_id);
  return next_status;
end;
$$;

revoke all on function public.complete_whatsapp_campaign_recipient(uuid, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.finish_whatsapp_campaign_if_settled(uuid)
from public, anon, authenticated;
revoke all on function public.fail_whatsapp_campaign_recipient(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.complete_whatsapp_campaign_recipient(uuid, text, timestamptz)
to service_role;
grant execute on function public.finish_whatsapp_campaign_if_settled(uuid)
to service_role;
grant execute on function public.fail_whatsapp_campaign_recipient(uuid, text, boolean)
to service_role;
