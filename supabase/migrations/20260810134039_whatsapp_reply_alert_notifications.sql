-- Durable, tenant-routed alerts for super admins when an outreach contact
-- replies. Recipients are explicitly registered per sender company so a
-- platform administrator is never silently linked through tenant membership.

create unique index if not exists whatsapp_messages_id_company_id_unique
on public.whatsapp_messages(id, company_id);

create table public.whatsapp_reply_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  admin_user_profile_id uuid not null references public.users_profile(id) on delete cascade,
  phone_e164 text not null,
  is_enabled boolean not null default true,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'invalid')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, phone_e164),
  check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  check (
    (verification_status = 'verified' and verified_at is not null)
    or verification_status <> 'verified'
  )
);

create table public.whatsapp_reply_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  whatsapp_message_id uuid not null,
  recipient_id uuid not null,
  sender_meta_phone_number_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  failure_code text,
  failure_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (whatsapp_message_id, company_id)
    references public.whatsapp_messages(id, company_id) on delete cascade,
  foreign key (recipient_id, company_id)
    references public.whatsapp_reply_alert_recipients(id, company_id) on delete cascade,
  unique (company_id, whatsapp_message_id, recipient_id)
);

create unique index whatsapp_reply_alert_provider_message_key
on public.whatsapp_reply_alert_deliveries(provider_message_id)
where provider_message_id is not null;

create index whatsapp_reply_alert_claim_idx
on public.whatsapp_reply_alert_deliveries(next_attempt_at, created_at)
where status in ('queued', 'processing', 'failed');

alter table public.whatsapp_reply_alert_recipients enable row level security;
alter table public.whatsapp_reply_alert_deliveries enable row level security;
revoke all on public.whatsapp_reply_alert_recipients from public, anon, authenticated;
revoke all on public.whatsapp_reply_alert_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_reply_alert_recipients to service_role;
grant select, insert, update, delete on public.whatsapp_reply_alert_deliveries to service_role;

create trigger set_whatsapp_reply_alert_recipients_updated_at
before update on public.whatsapp_reply_alert_recipients
for each row execute function public.set_updated_at();

create trigger set_whatsapp_reply_alert_deliveries_updated_at
before update on public.whatsapp_reply_alert_deliveries
for each row execute function public.set_updated_at();

create or replace function public.enqueue_whatsapp_reply_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_phone_number_id text;
begin
  if new.direction <> 'inbound' then return new; end if;

  select phone_numbers.meta_phone_number_id
  into sender_phone_number_id
  from public.whatsapp_phone_numbers phone_numbers
  where phone_numbers.id = new.whatsapp_phone_number_id
    and phone_numbers.company_id = new.company_id
    and phone_numbers.is_active;

  if sender_phone_number_id is null then return new; end if;

  insert into public.whatsapp_reply_alert_deliveries (
    company_id, whatsapp_message_id, recipient_id,
    sender_meta_phone_number_id, status, next_attempt_at
  )
  select new.company_id, new.id, recipients.id,
    sender_phone_number_id, 'queued', now()
  from public.whatsapp_reply_alert_recipients recipients
  join public.users_profile profiles
    on profiles.id = recipients.admin_user_profile_id
  where recipients.company_id = new.company_id
    and recipients.is_enabled
    and recipients.verification_status = 'verified'
    and profiles.status = 'active'
    and profiles.is_super_admin = true
  on conflict (company_id, whatsapp_message_id, recipient_id) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_whatsapp_reply_alert()
from public, anon, authenticated;

create trigger enqueue_whatsapp_reply_alert_after_message
after insert on public.whatsapp_messages
for each row execute function public.enqueue_whatsapp_reply_alert();

create or replace function public.claim_whatsapp_reply_alert_batch(p_limit integer default 25)
returns table (
  delivery_id uuid,
  company_id uuid,
  sender_meta_phone_number_id text,
  phone_e164 text,
  contact_name text,
  contact_mobile text,
  reply_preview text,
  received_at text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Reply alert batch limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select deliveries.id
    from public.whatsapp_reply_alert_deliveries deliveries
    join public.whatsapp_reply_alert_recipients recipients
      on recipients.id = deliveries.recipient_id
      and recipients.company_id = deliveries.company_id
    where deliveries.status in ('queued', 'failed', 'processing')
      and deliveries.attempt_count < 5
      and deliveries.next_attempt_at <= now()
      and (deliveries.status <> 'processing'
        or deliveries.locked_at < now() - interval '10 minutes')
      and recipients.is_enabled
      and recipients.verification_status = 'verified'
    order by deliveries.next_attempt_at, deliveries.created_at
    for update of deliveries skip locked
    limit p_limit
  ), claimed as (
    update public.whatsapp_reply_alert_deliveries deliveries
    set status = 'processing', locked_at = now(),
      attempt_count = deliveries.attempt_count + 1,
      failure_code = null, failure_message = null, failed_at = null
    from candidates
    where deliveries.id = candidates.id
    returning deliveries.*
  )
  select claimed.id, claimed.company_id,
    claimed.sender_meta_phone_number_id, recipients.phone_e164,
    coalesce(nullif(conversations.contact_name, ''), messages.sender_wa_id),
    case when messages.sender_wa_id like '+%' then messages.sender_wa_id
      else '+' || messages.sender_wa_id end,
    left(coalesce(nullif(messages.text_body, ''), '[' || messages.message_type || ']'), 900),
    to_char(messages.source_timestamp at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
    claimed.attempt_count
  from claimed
  join public.whatsapp_reply_alert_recipients recipients
    on recipients.id = claimed.recipient_id
    and recipients.company_id = claimed.company_id
  join public.whatsapp_messages messages
    on messages.id = claimed.whatsapp_message_id
    and messages.company_id = claimed.company_id
  join public.whatsapp_conversations conversations
    on conversations.id = messages.conversation_id
    and conversations.company_id = messages.company_id;
end;
$$;

create or replace function public.complete_whatsapp_reply_alert(
  p_delivery_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_reply_alert_deliveries
  set status = 'sent', provider_message_id = nullif(btrim(p_provider_message_id), ''),
    sent_at = now(), locked_at = null, failure_code = null, failure_message = null
  where id = p_delivery_id and status = 'processing';
  return found;
end;
$$;

create or replace function public.fail_whatsapp_reply_alert(
  p_delivery_id uuid,
  p_failure_code text,
  p_failure_message text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  attempts integer;
  next_status text;
begin
  select attempt_count into attempts
  from public.whatsapp_reply_alert_deliveries
  where id = p_delivery_id and status = 'processing'
  for update;
  if not found then return 'ignored'; end if;

  next_status := case when p_retryable and attempts < 5 then 'failed' else 'cancelled' end;
  update public.whatsapp_reply_alert_deliveries
  set status = next_status,
    next_attempt_at = case when next_status = 'failed'
      then now() + make_interval(mins => least(power(2, greatest(attempts - 1, 0))::integer, 60))
      else next_attempt_at end,
    locked_at = null,
    failure_code = left(coalesce(p_failure_code, 'unknown'), 100),
    failure_message = left(coalesce(p_failure_message, 'Delivery failed'), 1000),
    failed_at = now()
  where id = p_delivery_id;
  return next_status;
end;
$$;

create or replace function public.process_whatsapp_reply_alert_status(
  p_provider_message_id text,
  p_status text,
  p_source_timestamp timestamptz,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  delivery_found boolean,
  updated boolean,
  company_id uuid,
  delivery_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  target_delivery public.whatsapp_reply_alert_deliveries%rowtype;
  callback_at timestamptz := coalesce(p_source_timestamp, now());
  next_status text;
begin
  if nullif(btrim(p_provider_message_id), '') is null
    or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid reply alert status callback' using errcode = '22023';
  end if;

  select deliveries.* into target_delivery
  from public.whatsapp_reply_alert_deliveries deliveries
  where deliveries.provider_message_id = btrim(p_provider_message_id)
  for update;

  if not found then
    return query select false, false, null::uuid, null::uuid, null::text;
    return;
  end if;

  next_status := case
    when target_delivery.status = 'read' then 'read'
    when p_status = 'read' then 'read'
    when target_delivery.status = 'delivered' then 'delivered'
    when p_status = 'delivered' then 'delivered'
    when p_status = 'failed' then 'failed'
    else 'sent'
  end;

  update public.whatsapp_reply_alert_deliveries
  set status = next_status,
    sent_at = case when p_status = 'sent' then coalesce(sent_at, callback_at) else sent_at end,
    delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, callback_at) else delivered_at end,
    read_at = case when p_status = 'read' then coalesce(read_at, callback_at) else read_at end,
    failed_at = case when p_status = 'failed' then coalesce(failed_at, callback_at) else failed_at end,
    failure_code = case when p_status = 'failed'
      then coalesce(failure_code, left(nullif(btrim(p_error_code), ''), 100))
      else failure_code end,
    failure_message = case when p_status = 'failed'
      then coalesce(failure_message, left(nullif(btrim(p_error_message), ''), 1000))
      else failure_message end
  where id = target_delivery.id
    and (status is distinct from next_status
      or (p_status = 'sent' and sent_at is null)
      or (p_status = 'delivered' and delivered_at is null)
      or (p_status = 'read' and read_at is null)
      or (p_status = 'failed' and failed_at is null));

  return query select true, found, target_delivery.company_id,
    target_delivery.id, next_status;
end;
$$;

revoke all on function public.claim_whatsapp_reply_alert_batch(integer) from public, anon, authenticated;
revoke all on function public.complete_whatsapp_reply_alert(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_whatsapp_reply_alert(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.process_whatsapp_reply_alert_status(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_reply_alert_batch(integer) to service_role;
grant execute on function public.complete_whatsapp_reply_alert(uuid, text) to service_role;
grant execute on function public.fail_whatsapp_reply_alert(uuid, text, text, boolean) to service_role;
grant execute on function public.process_whatsapp_reply_alert_status(text, text, timestamptz, text, text) to service_role;

comment on table public.whatsapp_reply_alert_recipients is
  'Verified super-admin WhatsApp alert destinations, explicitly scoped to an outreach sender company.';
comment on table public.whatsapp_reply_alert_deliveries is
  'Idempotent delivery queue for inbound WhatsApp reply alerts.';
