-- Atomic notification event expansion, delivery claiming, and status updates.

create or replace function public.queue_notification_event(
  p_company_id uuid,
  p_event_type text,
  p_source_type text,
  p_source_record_id text,
  p_idempotency_key text,
  p_payload jsonb,
  p_notification_key text,
  p_scheduled_at timestamptz default now(),
  p_recipient_id uuid default null
)
returns table (
  event_id uuid,
  delivery_count integer,
  already_queued boolean
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_event_id uuid;
  target_template_id uuid;
  inserted_count integer := 0;
  event_was_existing boolean := false;
begin
  if p_company_id is null
    or nullif(btrim(p_event_type), '') is null
    or nullif(btrim(p_idempotency_key), '') is null
    or nullif(btrim(p_notification_key), '') is null
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid notification event'
      using errcode = '22023';
  end if;

  select templates.id
  into target_template_id
  from public.notification_templates as templates
  where templates.notification_key = btrim(p_notification_key)
    and templates.provider = 'meta'
    and templates.approval_status = 'active'
    and templates.is_active
    and (
      templates.company_id = p_company_id
      or templates.company_id is null
    )
  order by templates.company_id nulls last, templates.version desc
  limit 1;

  if target_template_id is null then
    raise exception 'No active notification template is configured'
      using errcode = 'P0002';
  end if;

  insert into public.notification_events (
    company_id,
    event_type,
    source_type,
    source_record_id,
    idempotency_key,
    payload,
    occurred_at
  )
  values (
    p_company_id,
    btrim(p_event_type),
    nullif(btrim(p_source_type), ''),
    nullif(btrim(p_source_record_id), ''),
    btrim(p_idempotency_key),
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  on conflict (company_id, idempotency_key) do nothing
  returning id into target_event_id;

  if target_event_id is null then
    event_was_existing := true;
    select events.id
    into target_event_id
    from public.notification_events as events
    where events.company_id = p_company_id
      and events.idempotency_key = btrim(p_idempotency_key);
  else
    insert into public.notification_deliveries (
      company_id,
      event_id,
      recipient_id,
      template_id,
      channel,
      status,
      scheduled_at,
      next_attempt_at
    )
    select
      recipients.company_id,
      target_event_id,
      recipients.id,
      target_template_id,
      'whatsapp',
      'queued',
      coalesce(p_scheduled_at, now()),
      coalesce(p_scheduled_at, now())
    from public.notification_recipients as recipients
    join public.notification_preferences as preferences
      on preferences.company_id = recipients.company_id
      and preferences.recipient_id = recipients.id
      and preferences.notification_type = btrim(p_event_type)
      and preferences.channel = 'whatsapp'
      and preferences.is_enabled
      and preferences.consent_status = 'granted'
    where recipients.company_id = p_company_id
      and (p_recipient_id is null or recipients.id = p_recipient_id)
      and recipients.verification_status = 'verified'
      and not exists (
        select 1
        from public.notification_unsubscribes as unsubscribes
        where unsubscribes.company_id = recipients.company_id
          and unsubscribes.recipient_id = recipients.id
          and unsubscribes.resubscribed_at is null
          and unsubscribes.scope in (
            btrim(p_event_type),
            'all_optional',
            'all_whatsapp'
          )
      )
    on conflict (company_id, event_id, recipient_id, channel) do nothing;

    get diagnostics inserted_count = row_count;
  end if;

  return query
  select target_event_id, inserted_count, event_was_existing;
end;
$$;

create or replace function public.claim_notification_delivery_batch(
  p_limit integer,
  p_allowed_phone_numbers text[] default null
)
returns table (
  delivery_id uuid,
  company_id uuid,
  event_type text,
  event_payload jsonb,
  phone_e164 text,
  full_name text,
  company_name text,
  template_name text,
  template_language text,
  variable_schema jsonb,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Notification batch limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  -- Settle rows that became ineligible after they were queued.
  update public.notification_deliveries as deliveries
  set
    status = 'skipped',
    failure_code = 'recipient_ineligible',
    failure_message = 'Recipient is not verified, opted in, or allowed in test mode',
    failed_at = now(),
    claimed_at = null
  from public.notification_recipients as recipients,
    public.notification_events as events
  where deliveries.recipient_id = recipients.id
    and deliveries.company_id = recipients.company_id
    and deliveries.event_id = events.id
    and deliveries.company_id = events.company_id
    and deliveries.status in ('queued', 'failed')
    and (
      recipients.verification_status <> 'verified'
      or (
        p_allowed_phone_numbers is not null
        and not (
          replace(recipients.phone_e164, '+', '') =
          any(p_allowed_phone_numbers)
        )
      )
      or not exists (
        select 1
        from public.notification_preferences as preferences
        where preferences.company_id = deliveries.company_id
          and preferences.recipient_id = deliveries.recipient_id
          and preferences.notification_type = events.event_type
          and preferences.channel = deliveries.channel
          and preferences.is_enabled
          and preferences.consent_status = 'granted'
      )
      or exists (
        select 1
        from public.notification_unsubscribes as unsubscribes
        where unsubscribes.company_id = deliveries.company_id
          and unsubscribes.recipient_id = deliveries.recipient_id
          and unsubscribes.resubscribed_at is null
          and unsubscribes.scope in (
            events.event_type,
            'all_optional',
            'all_whatsapp'
          )
      )
    );

  return query
  with candidates as (
    select deliveries.id
    from public.notification_deliveries as deliveries
    where deliveries.channel = 'whatsapp'
      and deliveries.status in ('queued', 'failed', 'processing')
      and deliveries.attempt_count < 5
      and deliveries.scheduled_at <= now()
      and coalesce(deliveries.next_attempt_at, deliveries.scheduled_at) <= now()
      and (
        deliveries.status <> 'processing'
        or deliveries.claimed_at < now() - interval '10 minutes'
      )
    order by deliveries.scheduled_at, deliveries.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.notification_deliveries as deliveries
    set
      status = 'processing',
      claimed_at = now(),
      attempt_count = deliveries.attempt_count + 1,
      failure_code = null,
      failure_message = null,
      failed_at = null
    from candidates
    where deliveries.id = candidates.id
    returning deliveries.*
  )
  select
    claimed.id,
    claimed.company_id,
    events.event_type,
    events.payload,
    recipients.phone_e164,
    profiles.full_name,
    companies.company_name,
    templates.provider_template_name,
    templates.language_code,
    templates.variable_schema,
    claimed.attempt_count
  from claimed
  join public.notification_events as events
    on events.id = claimed.event_id
    and events.company_id = claimed.company_id
  join public.notification_recipients as recipients
    on recipients.id = claimed.recipient_id
    and recipients.company_id = claimed.company_id
  join public.users_profile as profiles
    on profiles.id = recipients.user_profile_id
    and profiles.company_id = claimed.company_id
  join public.companies
    on companies.id = claimed.company_id
  join public.notification_templates as templates
    on templates.id = claimed.template_id;
end;
$$;

create or replace function public.complete_notification_delivery(
  p_delivery_id uuid,
  p_provider_message_id text,
  p_provider_response jsonb default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_delivery_id is null
    or nullif(btrim(p_provider_message_id), '') is null then
    raise exception 'Delivery ID and provider message ID are required'
      using errcode = '22023';
  end if;

  update public.notification_deliveries
  set
    status = 'sent',
    provider_message_id = btrim(p_provider_message_id),
    provider_response = p_provider_response,
    sent_at = coalesce(sent_at, now()),
    claimed_at = null,
    next_attempt_at = null,
    failure_code = null,
    failure_message = null
  where id = p_delivery_id
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.fail_notification_delivery(
  p_delivery_id uuid,
  p_failure_code text,
  p_failure_message text,
  p_retryable boolean
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_attempt_count integer;
  next_status text;
begin
  select attempt_count
  into target_attempt_count
  from public.notification_deliveries
  where id = p_delivery_id
    and status = 'processing'
  for update;

  if not found then
    return 'ignored';
  end if;

  next_status := case
    when p_retryable and target_attempt_count < 5 then 'failed'
    else 'cancelled'
  end;

  update public.notification_deliveries
  set
    status = next_status,
    claimed_at = null,
    failed_at = now(),
    failure_code = left(coalesce(nullif(btrim(p_failure_code), ''), 'unknown'), 100),
    failure_message = left(
      coalesce(nullif(btrim(p_failure_message), ''), 'Notification delivery failed'),
      2000
    ),
    next_attempt_at = case
      when next_status = 'failed' then
        now() + make_interval(
          secs => least(3600, 30 * power(2, greatest(target_attempt_count - 1, 0))::integer)
        )
      else null
    end
  where id = p_delivery_id;

  return next_status;
end;
$$;

create or replace function public.process_notification_delivery_status(
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
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  target_delivery public.notification_deliveries%rowtype;
  callback_at timestamptz := coalesce(p_source_timestamp, now());
  next_status text;
begin
  if nullif(btrim(p_provider_message_id), '') is null
    or p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid notification status callback'
      using errcode = '22023';
  end if;

  select deliveries.*
  into target_delivery
  from public.notification_deliveries as deliveries
  where deliveries.provider_message_id = btrim(p_provider_message_id)
  for update;

  if not found then
    return query
    select false, false, null::uuid, null::uuid, null::text;
    return;
  end if;

  next_status := case
    when target_delivery.status = 'read' then 'read'
    when p_status = 'read' then 'read'
    when target_delivery.status = 'delivered' then 'delivered'
    when p_status = 'delivered' then 'delivered'
    when target_delivery.status = 'sent' then
      case when p_status = 'failed' then 'failed' else 'sent' end
    when p_status = 'failed' then 'failed'
    else target_delivery.status
  end;

  update public.notification_deliveries
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
    failure_code = case
      when p_status = 'failed' then
        coalesce(failure_code, left(nullif(btrim(p_error_code), ''), 100))
      else failure_code
    end,
    failure_message = case
      when p_status = 'failed' then
        coalesce(failure_message, left(nullif(btrim(p_error_message), ''), 2000))
      else failure_message
    end
  where id = target_delivery.id
    and (
      status is distinct from next_status
      or (p_status = 'sent' and sent_at is null)
      or (p_status = 'delivered' and delivered_at is null)
      or (p_status = 'read' and read_at is null)
      or (p_status = 'failed' and failed_at is null)
    );

  return query
  select
    true,
    found,
    target_delivery.company_id,
    target_delivery.id,
    next_status;
end;
$$;

create or replace function public.list_due_daily_summary_recipients(
  p_limit integer default 100
)
returns table (
  company_id uuid,
  organization_id uuid,
  recipient_id uuid,
  local_date date,
  timezone text
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select
      recipients.company_id,
      profiles.organization_id,
      recipients.id as recipient_id,
      case
        when exists (
          select 1
          from pg_catalog.pg_timezone_names
          where pg_timezone_names.name =
            coalesce(preferences.timezone, recipients.timezone)
        ) then coalesce(preferences.timezone, recipients.timezone)
        else 'Asia/Kolkata'
      end as effective_timezone,
      preferences.delivery_time
    from public.notification_preferences as preferences
    join public.notification_recipients as recipients
      on recipients.id = preferences.recipient_id
      and recipients.company_id = preferences.company_id
    join public.users_profile as profiles
      on profiles.id = recipients.user_profile_id
      and profiles.company_id = recipients.company_id
    where preferences.notification_type = 'requested_daily_summary'
      and preferences.channel = 'whatsapp'
      and preferences.is_enabled
      and preferences.consent_status = 'granted'
      and preferences.delivery_time is not null
      and recipients.verification_status = 'verified'
      and profiles.status = 'active'
      and exists (
        select 1
        from public.user_roles
        join public.roles on roles.id = user_roles.role_id
        where (
          user_roles.user_profile_id = profiles.id
          or user_roles.user_id = profiles.auth_user_id
        )
          and roles.company_id = recipients.company_id
          and roles.role_key = 'admin'
      )
      and not exists (
        select 1
        from public.notification_unsubscribes as unsubscribes
        where unsubscribes.company_id = recipients.company_id
          and unsubscribes.recipient_id = recipients.id
          and unsubscribes.resubscribed_at is null
          and unsubscribes.scope in (
            'requested_daily_summary',
            'all_optional',
            'all_whatsapp'
          )
      )
  )
  select
    eligible.company_id,
    eligible.organization_id,
    eligible.recipient_id,
    (now() at time zone eligible.effective_timezone)::date,
    eligible.effective_timezone
  from eligible
  where (now() at time zone eligible.effective_timezone)::time
      >= eligible.delivery_time
    and (now() at time zone eligible.effective_timezone)::time
      < eligible.delivery_time + interval '30 minutes'
  order by eligible.company_id, eligible.recipient_id
  limit greatest(1, least(p_limit, 500));
$$;

create or replace function public.process_notification_opt_out(
  p_contact_wa_id text,
  p_text_body text
)
returns table (
  action text,
  affected_recipients integer
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  normalized_phone text := regexp_replace(
    coalesce(p_contact_wa_id, ''),
    '[^0-9]',
    '',
    'g'
  );
  normalized_keyword text := upper(btrim(coalesce(p_text_body, '')));
  affected integer := 0;
begin
  if normalized_keyword not in ('STOP', 'UNSUBSCRIBE', 'START') then
    return query select 'ignored'::text, 0;
    return;
  end if;

  if normalized_keyword in ('STOP', 'UNSUBSCRIBE') then
    update public.notification_preferences as preferences
    set
      is_enabled = false,
      consent_status = 'revoked',
      consented_at = null,
      updated_at = now()
    from public.notification_recipients as recipients
    where preferences.recipient_id = recipients.id
      and preferences.company_id = recipients.company_id
      and replace(recipients.phone_e164, '+', '') = normalized_phone;

    get diagnostics affected = row_count;

    insert into public.notification_unsubscribes (
      company_id,
      recipient_id,
      scope,
      source,
      unsubscribed_at,
      resubscribed_at
    )
    select
      recipients.company_id,
      recipients.id,
      'all_whatsapp',
      'whatsapp_reply',
      now(),
      null
    from public.notification_recipients as recipients
    where replace(recipients.phone_e164, '+', '') = normalized_phone
    on conflict (company_id, recipient_id, scope) do update
    set
      source = excluded.source,
      unsubscribed_at = excluded.unsubscribed_at,
      resubscribed_at = null,
      updated_at = now();

    return query select 'unsubscribed'::text, affected;
    return;
  end if;

  update public.notification_unsubscribes as unsubscribes
  set resubscribed_at = now(), updated_at = now()
  from public.notification_recipients as recipients
  where unsubscribes.recipient_id = recipients.id
    and unsubscribes.company_id = recipients.company_id
    and unsubscribes.scope = 'all_whatsapp'
    and unsubscribes.resubscribed_at is null
    and replace(recipients.phone_e164, '+', '') = normalized_phone;

  get diagnostics affected = row_count;
  return query select 'resubscribed'::text, affected;
end;
$$;

revoke all on function public.queue_notification_event(
  uuid, text, text, text, text, jsonb, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.claim_notification_delivery_batch(integer, text[])
from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.fail_notification_delivery(uuid, text, text, boolean)
from public, anon, authenticated;
revoke all on function public.process_notification_delivery_status(
  text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function public.list_due_daily_summary_recipients(integer)
from public, anon, authenticated;
revoke all on function public.process_notification_opt_out(text, text)
from public, anon, authenticated;

grant execute on function public.queue_notification_event(
  uuid, text, text, text, text, jsonb, text, timestamptz, uuid
) to service_role;
grant execute on function public.claim_notification_delivery_batch(integer, text[])
to service_role;
grant execute on function public.complete_notification_delivery(uuid, text, jsonb)
to service_role;
grant execute on function public.fail_notification_delivery(uuid, text, text, boolean)
to service_role;
grant execute on function public.process_notification_delivery_status(
  text, text, timestamptz, text, text
) to service_role;
grant execute on function public.list_due_daily_summary_recipients(integer)
to service_role;
grant execute on function public.process_notification_opt_out(text, text)
to service_role;
