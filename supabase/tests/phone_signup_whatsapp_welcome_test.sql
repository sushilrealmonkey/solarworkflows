-- Guardrails for the consented, tenant-scoped phone-signup welcome message.

do $$
declare
  target_function regprocedure :=
    'public.self_create_epc_workspace(text,text,text,boolean)'::regprocedure;
  function_is_security_definer boolean;
  function_search_path text[];
begin
  if not has_function_privilege('authenticated', target_function, 'execute') then
    raise exception 'authenticated must be allowed to queue a signup welcome';
  end if;

  if has_function_privilege('anon', target_function, 'execute') then
    raise exception 'anon must not be allowed to queue a signup welcome';
  end if;

  select pg_proc.prosecdef, pg_proc.proconfig
  into function_is_security_definer, function_search_path
  from pg_proc
  where pg_proc.oid = target_function;

  if not function_is_security_definer then
    raise exception 'welcome onboarding RPC must be security definer';
  end if;

  if not coalesce(
    function_search_path @> array['search_path=public, auth']::text[],
    false
  ) then
    raise exception 'welcome onboarding RPC must use a fixed search_path';
  end if;

  if not exists (
    select 1
    from public.notification_templates
    where company_id is null
      and notification_key = 'account_welcome'
      and provider_template_name = 'account_welcome'
      and language_code = 'en'
      and variable_schema = '["first_name","company_name"]'::jsonb
      and approval_status = 'active'
  ) then
    raise exception 'account welcome template catalog entry is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.notification_templates'::regclass
      and tgname = 'backfill_account_welcome_deliveries'
      and not tgisinternal
  ) then
    raise exception 'account welcome activation backfill trigger is missing';
  end if;
end;
$$;

begin;

insert into auth.users (
  id, aud, role, phone, phone_confirmed_at, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '91000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '+919100000001',
  now(),
  '',
  '{"provider":"phone","providers":["phone"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

do $$
declare
  candidate_user_id uuid;
  candidate_phone text;
  onboarding_result jsonb;
  created_company_id uuid;
  created_admin_profile_id uuid;
  welcome_recipient_id uuid;
  welcome_event_id uuid;
begin
  select users.id, users.phone
  into candidate_user_id, candidate_phone
  from auth.users
  where users.phone_confirmed_at is not null
    and users.phone is not null
    and not exists (
      select 1
      from public.users_profile
      where users_profile.auth_user_id = users.id
        or users_profile.phone = users.phone
    )
    and not exists (
      select 1 from public.profiles where profiles.id = users.id
    )
  order by users.created_at desc
  limit 1;

  if candidate_user_id is null then
    raise notice 'Skipping phone welcome behavior test: no verified unassigned phone identity is available';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', candidate_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', candidate_user_id,
      'phone', candidate_phone,
      'role', 'authenticated'
    )::text,
    true
  );

  onboarding_result := public.self_create_epc_workspace(
    'WhatsApp Welcome Test Workspace',
    'WhatsApp Welcome Admin',
    candidate_phone,
    true
  );

  created_company_id := (onboarding_result ->> 'company_id')::uuid;
  created_admin_profile_id := (onboarding_result ->> 'admin_profile_id')::uuid;

  select recipients.id
  into welcome_recipient_id
  from public.notification_recipients as recipients
  where recipients.company_id = created_company_id
    and recipients.user_profile_id = created_admin_profile_id
    and recipients.verification_status = 'verified';

  if welcome_recipient_id is null then
    raise exception 'phone onboarding did not create a verified tenant recipient';
  end if;

  if not exists (
    select 1
    from public.notification_preferences as preferences
    where preferences.company_id = created_company_id
      and preferences.recipient_id = welcome_recipient_id
      and preferences.notification_type = 'account_welcome'
      and preferences.channel = 'whatsapp'
      and preferences.is_enabled
      and preferences.consent_status = 'granted'
      and preferences.consent_source = 'phone_workspace_signup_v1'
  ) then
    raise exception 'phone onboarding did not record explicit welcome consent';
  end if;

  select events.id
  into welcome_event_id
  from public.notification_events as events
  where events.company_id = created_company_id
    and events.event_type = 'account_welcome'
    and events.source_type = 'users_profile'
    and events.source_record_id = created_admin_profile_id::text
    and events.idempotency_key = 'account-welcome:' || candidate_user_id::text;

  if welcome_event_id is null then
    raise exception 'phone onboarding did not record the welcome event';
  end if;

  if not exists (
    select 1
    from public.notification_deliveries as deliveries
    where deliveries.company_id = created_company_id
      and deliveries.event_id = welcome_event_id
      and deliveries.recipient_id = welcome_recipient_id
      and deliveries.channel = 'whatsapp'
  ) then
    raise exception 'approved welcome template did not create a delivery';
  end if;
end;
$$;

rollback;
