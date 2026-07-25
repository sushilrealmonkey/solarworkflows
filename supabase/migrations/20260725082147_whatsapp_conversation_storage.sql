-- Tenant-scoped WhatsApp Cloud API storage.
--
-- The public webhook resolves the tenant from Meta's phone_number_id. Callers
-- never provide company_id, which prevents a signed payload from being routed
-- to an arbitrary tenant. The service-role-only RPC keeps tenant resolution,
-- conversation upsert, and idempotent message insertion in one transaction.

create table public.whatsapp_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meta_phone_number_id text not null,
  meta_business_account_id text,
  display_phone_number text,
  verified_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_phone_numbers_meta_phone_number_id_key
    unique (meta_phone_number_id),
  constraint whatsapp_phone_numbers_id_company_id_key
    unique (id, company_id),
  constraint whatsapp_phone_numbers_meta_phone_number_id_not_blank
    check (btrim(meta_phone_number_id) <> '')
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  whatsapp_phone_number_id uuid not null,
  contact_wa_id text not null,
  contact_name text,
  last_message_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_phone_number_company_fk
    foreign key (whatsapp_phone_number_id, company_id)
    references public.whatsapp_phone_numbers(id, company_id)
    on delete cascade,
  constraint whatsapp_conversations_id_company_id_key
    unique (id, company_id),
  constraint whatsapp_conversations_company_phone_contact_key
    unique (company_id, whatsapp_phone_number_id, contact_wa_id),
  constraint whatsapp_conversations_contact_wa_id_not_blank
    check (btrim(contact_wa_id) <> '')
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  whatsapp_phone_number_id uuid not null,
  meta_message_id text not null,
  direction text not null default 'inbound',
  message_type text not null,
  status text not null default 'received',
  sender_wa_id text not null,
  text_body text,
  source_timestamp timestamptz not null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint whatsapp_messages_conversation_company_fk
    foreign key (conversation_id, company_id)
    references public.whatsapp_conversations(id, company_id)
    on delete cascade,
  constraint whatsapp_messages_phone_number_company_fk
    foreign key (whatsapp_phone_number_id, company_id)
    references public.whatsapp_phone_numbers(id, company_id)
    on delete cascade,
  constraint whatsapp_messages_company_meta_message_id_key
    unique (company_id, meta_message_id),
  constraint whatsapp_messages_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint whatsapp_messages_status_check
    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  constraint whatsapp_messages_meta_message_id_not_blank
    check (btrim(meta_message_id) <> ''),
  constraint whatsapp_messages_message_type_not_blank
    check (btrim(message_type) <> ''),
  constraint whatsapp_messages_sender_wa_id_not_blank
    check (btrim(sender_wa_id) <> ''),
  constraint whatsapp_messages_raw_payload_is_object
    check (jsonb_typeof(raw_payload) = 'object')
);

create index whatsapp_phone_numbers_company_id_idx
on public.whatsapp_phone_numbers (company_id);

create index whatsapp_conversations_company_last_message_idx
on public.whatsapp_conversations (company_id, last_message_at desc);

create index whatsapp_messages_conversation_source_timestamp_idx
on public.whatsapp_messages (conversation_id, source_timestamp desc);

create index whatsapp_messages_company_source_timestamp_idx
on public.whatsapp_messages (company_id, source_timestamp desc);

create trigger set_whatsapp_phone_numbers_updated_at
before update on public.whatsapp_phone_numbers
for each row
execute function public.set_updated_at();

create trigger set_whatsapp_conversations_updated_at
before update on public.whatsapp_conversations
for each row
execute function public.set_updated_at();

alter table public.whatsapp_phone_numbers enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

create policy "Tenant members can view WhatsApp phone numbers"
on public.whatsapp_phone_numbers
for select
to authenticated
using (
  company_id = (select public.get_current_user_company_id())
);

create policy "Tenant members can view WhatsApp conversations"
on public.whatsapp_conversations
for select
to authenticated
using (
  company_id = (select public.get_current_user_company_id())
);

create policy "Tenant members can view WhatsApp messages"
on public.whatsapp_messages
for select
to authenticated
using (
  company_id = (select public.get_current_user_company_id())
);

create or replace function public.persist_inbound_whatsapp_message(
  p_meta_phone_number_id text,
  p_meta_message_id text,
  p_contact_wa_id text,
  p_contact_name text,
  p_message_type text,
  p_text_body text,
  p_source_timestamp timestamptz,
  p_raw_payload jsonb
)
returns table (
  mapped boolean,
  inserted boolean,
  company_id uuid,
  conversation_id uuid,
  message_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_phone_number public.whatsapp_phone_numbers%rowtype;
  target_conversation_id uuid;
  target_message_id uuid;
  message_inserted boolean := false;
  normalized_message_at timestamptz :=
    coalesce(p_source_timestamp, statement_timestamp());
begin
  if nullif(btrim(p_meta_phone_number_id), '') is null
    or nullif(btrim(p_meta_message_id), '') is null
    or nullif(btrim(p_contact_wa_id), '') is null
    or nullif(btrim(p_message_type), '') is null then
    raise exception 'Required WhatsApp message identifiers are missing'
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
    select false, false, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  -- Exit early on replay before touching the conversation.
  select
    whatsapp_messages.id,
    whatsapp_messages.conversation_id
  into
    target_message_id,
    target_conversation_id
  from public.whatsapp_messages
  where whatsapp_messages.company_id = target_phone_number.company_id
    and whatsapp_messages.meta_message_id = btrim(p_meta_message_id)
  limit 1;

  if found then
    return query
    select
      true,
      false,
      target_phone_number.company_id,
      target_conversation_id,
      target_message_id;
    return;
  end if;

  insert into public.whatsapp_conversations (
    company_id,
    whatsapp_phone_number_id,
    contact_wa_id,
    contact_name,
    last_message_at
  )
  values (
    target_phone_number.company_id,
    target_phone_number.id,
    btrim(p_contact_wa_id),
    nullif(btrim(p_contact_name), ''),
    normalized_message_at
  )
  on conflict (
    company_id,
    whatsapp_phone_number_id,
    contact_wa_id
  )
  do update
  set
    contact_name = coalesce(
      excluded.contact_name,
      whatsapp_conversations.contact_name
    ),
    last_message_at = greatest(
      whatsapp_conversations.last_message_at,
      excluded.last_message_at
    ),
    updated_at = statement_timestamp()
  returning whatsapp_conversations.id
  into target_conversation_id;

  insert into public.whatsapp_messages (
    company_id,
    conversation_id,
    whatsapp_phone_number_id,
    meta_message_id,
    direction,
    message_type,
    status,
    sender_wa_id,
    text_body,
    source_timestamp,
    raw_payload
  )
  values (
    target_phone_number.company_id,
    target_conversation_id,
    target_phone_number.id,
    btrim(p_meta_message_id),
    'inbound',
    btrim(p_message_type),
    'received',
    btrim(p_contact_wa_id),
    p_text_body,
    normalized_message_at,
    coalesce(p_raw_payload, '{}'::jsonb)
  )
  on conflict (company_id, meta_message_id)
  do nothing
  returning whatsapp_messages.id
  into target_message_id;

  message_inserted := found;

  if not message_inserted then
    select
      whatsapp_messages.id,
      whatsapp_messages.conversation_id
    into
      target_message_id,
      target_conversation_id
    from public.whatsapp_messages
    where whatsapp_messages.company_id = target_phone_number.company_id
      and whatsapp_messages.meta_message_id = btrim(p_meta_message_id);
  end if;

  return query
  select
    true,
    message_inserted,
    target_phone_number.company_id,
    target_conversation_id,
    target_message_id;
end;
$$;

revoke all on table public.whatsapp_phone_numbers from anon, authenticated;
revoke all on table public.whatsapp_conversations from anon, authenticated;
revoke all on table public.whatsapp_messages from anon, authenticated;

grant select on table public.whatsapp_phone_numbers to authenticated;
grant select on table public.whatsapp_conversations to authenticated;
grant select on table public.whatsapp_messages to authenticated;

grant select, insert, update, delete
on table public.whatsapp_phone_numbers
to service_role;

grant select, insert, update, delete
on table public.whatsapp_conversations
to service_role;

grant select, insert, update, delete
on table public.whatsapp_messages
to service_role;

revoke all
on function public.persist_inbound_whatsapp_message(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.persist_inbound_whatsapp_message(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  jsonb
)
to service_role;
