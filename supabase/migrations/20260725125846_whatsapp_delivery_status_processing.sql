-- Store tenant-scoped WhatsApp delivery lifecycle callbacks atomically.

alter table public.whatsapp_messages
  add column sent_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column failed_at timestamptz,
  add column deleted_at timestamptz,
  add column failure_error_code text,
  add column failure_error_title text,
  add column failure_error_message text,
  add column failure_error_details text;

alter table public.whatsapp_messages
  drop constraint whatsapp_messages_status_check,
  add constraint whatsapp_messages_status_check
    check (
      status in (
        'received',
        'sent',
        'delivered',
        'read',
        'failed',
        'deleted'
      )
    );

create or replace function public.process_whatsapp_message_status(
  p_meta_phone_number_id text,
  p_meta_message_id text,
  p_status text,
  p_source_timestamp timestamptz,
  p_error_code text default null,
  p_error_title text default null,
  p_error_message text default null,
  p_error_details text default null
)
returns table (
  mapped boolean,
  message_found boolean,
  updated boolean,
  company_id uuid,
  message_id uuid,
  status text
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_phone_number public.whatsapp_phone_numbers%rowtype;
  target_message public.whatsapp_messages%rowtype;
  callback_at timestamptz := coalesce(
    p_source_timestamp,
    statement_timestamp()
  );
  next_status text;
begin
  if nullif(btrim(p_meta_phone_number_id), '') is null
    or nullif(btrim(p_meta_message_id), '') is null
    or p_status not in ('sent', 'delivered', 'read', 'failed', 'deleted') then
    raise exception 'Invalid WhatsApp status callback'
      using errcode = '22023';
  end if;

  select whatsapp_phone_numbers.*
  into target_phone_number
  from public.whatsapp_phone_numbers
  where whatsapp_phone_numbers.meta_phone_number_id =
      btrim(p_meta_phone_number_id)
    and whatsapp_phone_numbers.is_active
  limit 1;

  if not found then
    return query
    select false, false, false, null::uuid, null::uuid, null::text;
    return;
  end if;

  select whatsapp_messages.*
  into target_message
  from public.whatsapp_messages
  where whatsapp_messages.company_id = target_phone_number.company_id
    and whatsapp_messages.whatsapp_phone_number_id = target_phone_number.id
    and whatsapp_messages.meta_message_id = btrim(p_meta_message_id)
  for update;

  if not found then
    return query
    select
      true,
      false,
      false,
      target_phone_number.company_id,
      null::uuid,
      null::text;
    return;
  end if;

  next_status := case
    when target_message.status = 'deleted' then 'deleted'
    when p_status = 'deleted' then 'deleted'
    when target_message.status = 'failed' then 'failed'
    when p_status = 'failed'
      and target_message.status in ('received', 'sent', 'delivered')
      then 'failed'
    when target_message.status = 'read' then 'read'
    when p_status = 'read' then 'read'
    when target_message.status = 'delivered' then 'delivered'
    when p_status = 'delivered' then 'delivered'
    when target_message.status = 'sent' then 'sent'
    when p_status = 'sent' then 'sent'
    else target_message.status
  end;

  update public.whatsapp_messages
  set
    status = next_status,
    sent_at = case
      when p_status = 'sent' then coalesce(sent_at, callback_at)
      else sent_at
    end,
    delivered_at = case
      when p_status = 'delivered' then coalesce(delivered_at, callback_at)
      else delivered_at
    end,
    read_at = case
      when p_status = 'read' then coalesce(read_at, callback_at)
      else read_at
    end,
    failed_at = case
      when p_status = 'failed' then coalesce(failed_at, callback_at)
      else failed_at
    end,
    deleted_at = case
      when p_status = 'deleted' then coalesce(deleted_at, callback_at)
      else deleted_at
    end,
    failure_error_code = case
      when p_status = 'failed' then
        coalesce(failure_error_code, left(nullif(btrim(p_error_code), ''), 100))
      else failure_error_code
    end,
    failure_error_title = case
      when p_status = 'failed' then
        coalesce(failure_error_title, left(nullif(btrim(p_error_title), ''), 500))
      else failure_error_title
    end,
    failure_error_message = case
      when p_status = 'failed' then
        coalesce(failure_error_message, left(nullif(btrim(p_error_message), ''), 2000))
      else failure_error_message
    end,
    failure_error_details = case
      when p_status = 'failed' then
        coalesce(failure_error_details, left(nullif(btrim(p_error_details), ''), 4000))
      else failure_error_details
    end
  where whatsapp_messages.id = target_message.id
    and (
      whatsapp_messages.status is distinct from next_status
      or (p_status = 'sent' and whatsapp_messages.sent_at is null)
      or (p_status = 'delivered' and whatsapp_messages.delivered_at is null)
      or (p_status = 'read' and whatsapp_messages.read_at is null)
      or (
        p_status = 'failed'
        and (
          whatsapp_messages.failed_at is null
          or (
            whatsapp_messages.failure_error_code is null
            and nullif(btrim(p_error_code), '') is not null
          )
          or (
            whatsapp_messages.failure_error_title is null
            and nullif(btrim(p_error_title), '') is not null
          )
          or (
            whatsapp_messages.failure_error_message is null
            and nullif(btrim(p_error_message), '') is not null
          )
          or (
            whatsapp_messages.failure_error_details is null
            and nullif(btrim(p_error_details), '') is not null
          )
        )
      )
      or (p_status = 'deleted' and whatsapp_messages.deleted_at is null)
    );

  return query
  select
    true,
    true,
    found,
    target_phone_number.company_id,
    target_message.id,
    next_status;
end;
$$;

revoke all
on function public.process_whatsapp_message_status(
  text, text, text, timestamptz, text, text, text, text
)
from public, anon, authenticated;

grant execute
on function public.process_whatsapp_message_status(
  text, text, text, timestamptz, text, text, text, text
)
to service_role;
