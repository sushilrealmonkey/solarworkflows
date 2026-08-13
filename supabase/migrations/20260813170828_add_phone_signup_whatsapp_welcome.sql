-- Queue one consented WhatsApp welcome after a phone-verified user creates a
-- tenant workspace. The approved template is active immediately; activation
-- also backfills deliveries for welcome events recorded while it was pending.

insert into public.notification_templates (
  company_id,
  notification_key,
  provider,
  provider_template_name,
  language_code,
  category,
  approval_status,
  variable_schema,
  is_active
)
values (
  null,
  'account_welcome',
  'meta',
  'account_welcome',
  'en',
  'utility',
  'active',
  '["first_name","company_name"]'::jsonb,
  true
)
on conflict (notification_key, language_code) where company_id is null
do update set
  provider = excluded.provider,
  provider_template_name = excluded.provider_template_name,
  category = excluded.category,
  variable_schema = excluded.variable_schema,
  is_active = true,
  approval_status = excluded.approval_status,
  updated_at = now();

create or replace function public.ensure_account_welcome_delivery(
  p_event_id uuid,
  p_company_id uuid,
  p_recipient_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_template_id uuid;
begin
  select templates.id
  into target_template_id
  from public.notification_templates as templates
  where templates.notification_key = 'account_welcome'
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
    return;
  end if;

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
    events.company_id,
    events.id,
    recipients.id,
    target_template_id,
    'whatsapp',
    'queued',
    now(),
    now()
  from public.notification_events as events
  join public.notification_recipients as recipients
    on recipients.id = p_recipient_id
    and recipients.company_id = events.company_id
  join public.notification_preferences as preferences
    on preferences.company_id = recipients.company_id
    and preferences.recipient_id = recipients.id
    and preferences.notification_type = 'account_welcome'
    and preferences.channel = 'whatsapp'
    and preferences.is_enabled
    and preferences.consent_status = 'granted'
  where events.id = p_event_id
    and events.company_id = p_company_id
    and events.event_type = 'account_welcome'
    and events.source_type = 'users_profile'
    and events.source_record_id = recipients.user_profile_id::text
    and recipients.verification_status = 'verified'
    and not exists (
      select 1
      from public.notification_unsubscribes as unsubscribes
      where unsubscribes.company_id = recipients.company_id
        and unsubscribes.recipient_id = recipients.id
        and unsubscribes.resubscribed_at is null
        and unsubscribes.scope in (
          'account_welcome',
          'all_optional',
          'all_whatsapp'
        )
    )
  on conflict (company_id, event_id, recipient_id, channel) do nothing;
end;
$$;

create or replace function public.backfill_account_welcome_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  waiting record;
begin
  if new.notification_key <> 'account_welcome'
    or new.provider <> 'meta'
    or new.approval_status <> 'active'
    or not new.is_active then
    return new;
  end if;

  for waiting in
    select
      events.id as event_id,
      events.company_id,
      recipients.id as recipient_id
    from public.notification_events as events
    join public.notification_recipients as recipients
      on recipients.company_id = events.company_id
      and events.source_type = 'users_profile'
      and events.source_record_id = recipients.user_profile_id::text
    where events.event_type = 'account_welcome'
      and (new.company_id is null or events.company_id = new.company_id)
  loop
    perform public.ensure_account_welcome_delivery(
      waiting.event_id,
      waiting.company_id,
      waiting.recipient_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists backfill_account_welcome_deliveries
on public.notification_templates;

create trigger backfill_account_welcome_deliveries
after insert or update of approval_status, is_active
on public.notification_templates
for each row execute function public.backfill_account_welcome_deliveries();

create or replace function public.self_create_epc_workspace(
  workspace_name text,
  admin_full_name text,
  admin_phone text,
  welcome_whatsapp_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  onboarding_result jsonb;
  current_auth_user_id uuid := auth.uid();
  verified_auth_phone text;
  normalized_phone_e164 text;
  new_company_id uuid;
  new_admin_profile_id uuid;
  welcome_recipient_id uuid;
  welcome_event_id uuid;
begin
  onboarding_result := public.self_create_epc_workspace(
    workspace_name,
    admin_full_name,
    admin_phone
  );

  if not coalesce(welcome_whatsapp_consent, false) then
    return onboarding_result;
  end if;

  select nullif(btrim(users.phone), '')
  into verified_auth_phone
  from auth.users
  where users.id = current_auth_user_id
    and users.phone_confirmed_at is not null;

  -- Consent supplied by an email-signup caller is ignored. Only the verified
  -- Auth phone used for signup may receive this account welcome.
  if verified_auth_phone is null then
    return onboarding_result;
  end if;

  normalized_phone_e164 := '+' || regexp_replace(
    verified_auth_phone,
    '[^0-9]',
    '',
    'g'
  );

  if normalized_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    return onboarding_result;
  end if;

  new_company_id := (onboarding_result ->> 'company_id')::uuid;
  new_admin_profile_id := (onboarding_result ->> 'admin_profile_id')::uuid;

  if not exists (
    select 1
    from public.users_profile as profiles
    where profiles.id = new_admin_profile_id
      and profiles.company_id = new_company_id
      and profiles.auth_user_id = current_auth_user_id
      and profiles.phone_verified
      and profiles.phone = verified_auth_phone
  ) then
    raise exception 'Verified phone profile could not be resolved for welcome delivery'
      using errcode = 'P0002';
  end if;

  insert into public.notification_recipients (
    company_id,
    user_profile_id,
    phone_e164,
    verification_status,
    verified_at
  )
  values (
    new_company_id,
    new_admin_profile_id,
    normalized_phone_e164,
    'verified',
    now()
  )
  on conflict (company_id, user_profile_id) do update
  set
    phone_e164 = excluded.phone_e164,
    verification_status = 'verified',
    verified_at = coalesce(
      public.notification_recipients.verified_at,
      excluded.verified_at
    ),
    updated_at = now()
  returning id into welcome_recipient_id;

  insert into public.notification_preferences (
    company_id,
    recipient_id,
    notification_type,
    channel,
    is_enabled,
    consent_status,
    consent_source,
    consented_at
  )
  values (
    new_company_id,
    welcome_recipient_id,
    'account_welcome',
    'whatsapp',
    true,
    'granted',
    'phone_workspace_signup_v1',
    now()
  )
  on conflict (company_id, recipient_id, notification_type, channel)
  do update set
    is_enabled = true,
    consent_status = 'granted',
    consent_source = excluded.consent_source,
    consented_at = excluded.consented_at,
    updated_at = now();

  insert into public.notification_events (
    company_id,
    event_type,
    source_type,
    source_record_id,
    idempotency_key,
    payload
  )
  values (
    new_company_id,
    'account_welcome',
    'users_profile',
    new_admin_profile_id::text,
    'account-welcome:' || current_auth_user_id::text,
    jsonb_build_object('signup_method', 'phone')
  )
  on conflict (company_id, idempotency_key) do update
  set updated_at = now()
  returning id into welcome_event_id;

  perform public.ensure_account_welcome_delivery(
    welcome_event_id,
    new_company_id,
    welcome_recipient_id
  );

  return onboarding_result || jsonb_build_object(
    'welcome_whatsapp_queued', true
  );
end;
$$;

revoke all on function public.ensure_account_welcome_delivery(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.backfill_account_welcome_deliveries()
from public, anon, authenticated;
revoke all on function public.self_create_epc_workspace(text, text, text, boolean)
from public, anon;
grant execute on function public.self_create_epc_workspace(text, text, text, boolean)
to authenticated;

notify pgrst, 'reload schema';
