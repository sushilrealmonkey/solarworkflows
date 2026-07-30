-- Tenant notification foundation.
--
-- This migration intentionally creates storage, constraints, indexes, and RLS
-- only. Event generation, recipient selection, scheduling, and delivery remain
-- out of scope until the notification worker is implemented.

create unique index if not exists users_profile_company_id_id_unique
on public.users_profile (company_id, id);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  source_type text,
  source_record_id text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_events_id_company_id_key
    unique (id, company_id),
  constraint notification_events_company_idempotency_key
    unique (company_id, idempotency_key),
  constraint notification_events_event_type_not_blank
    check (btrim(event_type) <> ''),
  constraint notification_events_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint notification_events_payload_is_object
    check (jsonb_typeof(payload) = 'object')
);

create table public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_profile_id uuid not null,
  phone_e164 text not null,
  verification_status text not null default 'unverified',
  preferred_language text not null default 'en_US',
  timezone text not null default 'Asia/Kolkata',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_recipients_profile_company_fk
    foreign key (company_id, user_profile_id)
    references public.users_profile(company_id, id)
    on delete cascade,
  constraint notification_recipients_id_company_id_key
    unique (id, company_id),
  constraint notification_recipients_company_user_key
    unique (company_id, user_profile_id),
  constraint notification_recipients_company_phone_key
    unique (company_id, phone_e164),
  constraint notification_recipients_phone_e164_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint notification_recipients_verification_status_check
    check (verification_status in ('unverified', 'pending', 'verified', 'invalid')),
  constraint notification_recipients_verified_at_check
    check (
      (verification_status = 'verified' and verified_at is not null)
      or (verification_status <> 'verified')
    ),
  constraint notification_recipients_language_not_blank
    check (btrim(preferred_language) <> ''),
  constraint notification_recipients_timezone_not_blank
    check (btrim(timezone) <> '')
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null,
  notification_type text not null,
  channel text not null default 'whatsapp',
  is_enabled boolean not null default true,
  delivery_time time,
  timezone text,
  consent_status text not null default 'not_required',
  consent_source text,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_recipient_company_fk
    foreign key (recipient_id, company_id)
    references public.notification_recipients(id, company_id)
    on delete cascade,
  constraint notification_preferences_id_company_id_key
    unique (id, company_id),
  constraint notification_preferences_company_recipient_type_channel_key
    unique (company_id, recipient_id, notification_type, channel),
  constraint notification_preferences_notification_type_not_blank
    check (btrim(notification_type) <> ''),
  constraint notification_preferences_channel_check
    check (channel in ('whatsapp', 'email')),
  constraint notification_preferences_timezone_not_blank
    check (timezone is null or btrim(timezone) <> ''),
  constraint notification_preferences_consent_status_check
    check (consent_status in ('not_required', 'pending', 'granted', 'revoked')),
  constraint notification_preferences_consent_consistency_check
    check (
      (consent_status = 'granted' and consented_at is not null)
      or consent_status <> 'granted'
    )
);

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  -- Null company_id denotes a Bizlee-owned platform template. A non-null value
  -- reserves the schema for a future tenant-specific override.
  company_id uuid references public.companies(id) on delete cascade,
  notification_key text not null,
  provider text not null default 'meta',
  provider_template_name text not null,
  language_code text not null,
  category text not null,
  approval_status text not null default 'active',
  variable_schema jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_templates_notification_key_not_blank
    check (btrim(notification_key) <> ''),
  constraint notification_templates_provider_check
    check (provider in ('meta', 'resend')),
  constraint notification_templates_provider_name_not_blank
    check (btrim(provider_template_name) <> ''),
  constraint notification_templates_language_not_blank
    check (btrim(language_code) <> ''),
  constraint notification_templates_category_check
    check (category in ('authentication', 'utility', 'marketing')),
  constraint notification_templates_approval_status_check
    check (approval_status in ('draft', 'pending', 'active', 'paused', 'rejected', 'disabled')),
  constraint notification_templates_variable_schema_check
    check (jsonb_typeof(variable_schema) in ('array', 'object')),
  constraint notification_templates_version_positive
    check (version > 0)
);

create unique index notification_templates_global_key_language_key
on public.notification_templates (notification_key, language_code)
where company_id is null;

create unique index notification_templates_company_key_language_key
on public.notification_templates (company_id, notification_key, language_code)
where company_id is not null;

-- Approved Bizlee-owned templates. Meta template IDs and component definitions
-- are synchronized later from the provider API; this catalogue records the
-- stable names, categories, languages, and positional variable contracts.
insert into public.notification_templates (
  company_id,
  notification_key,
  provider,
  provider_template_name,
  language_code,
  category,
  approval_status,
  variable_schema
)
values
  (
    null,
    'signup_verification',
    'meta',
    'bizlee_signup',
    'en',
    'authentication',
    'active',
    '["otp"]'::jsonb
  ),
  (
    null,
    'trial_ending',
    'meta',
    'bizlee_trial_ending',
    'en_US',
    'marketing',
    'active',
    '["first_name","company_name","days_remaining","trial_end_date"]'::jsonb
  ),
  (
    null,
    'trial_expired',
    'meta',
    'bizlee_trial_expired',
    'en_US',
    'marketing',
    'active',
    '["first_name","company_name","trial_end_date"]'::jsonb
  ),
  (
    null,
    'subscription_action_required',
    'meta',
    'bizlee_subscription_action_required',
    'en_US',
    'utility',
    'active',
    '["first_name","company_name","amount","attempt_date","reference"]'::jsonb
  ),
  (
    null,
    'requested_daily_summary',
    'meta',
    'bizlee_requested_daily_summary',
    'en_US',
    'utility',
    'active',
    '["first_name","company_name","summary_date","headline","summary"]'::jsonb
  ),
  (
    null,
    'new_signin_alert',
    'meta',
    'bizlee_new_signin_alert',
    'en_US',
    'utility',
    'active',
    '["first_name","signin_time","device","approximate_location"]'::jsonb
  ),
  (
    null,
    'account_change_notice',
    'meta',
    'bizlee_account_change_notice',
    'en_US',
    'utility',
    'active',
    '["first_name","change_date","change_time"]'::jsonb
  ),
  (
    null,
    'product_tip',
    'meta',
    'bizlee_product_tip',
    'en_US',
    'marketing',
    'active',
    '["first_name","company_name","tip"]'::jsonb
  ),
  (
    null,
    'plan_offer',
    'meta',
    'bizlee_plan_offer',
    'en_US',
    'marketing',
    'active',
    '["first_name","company_name","offer","plan_name","offer_expiry"]'::jsonb
  ),
  (
    null,
    'product_announcement',
    'meta',
    'bizlee_product_announcement',
    'en_US',
    'marketing',
    'active',
    '["first_name","feature_name","feature_description","availability"]'::jsonb
  );

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null,
  recipient_id uuid not null,
  template_id uuid references public.notification_templates(id) on delete restrict,
  channel text not null default 'whatsapp',
  status text not null default 'queued',
  scheduled_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  failure_code text,
  failure_message text,
  rendered_variables jsonb not null default '[]'::jsonb,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_event_company_fk
    foreign key (event_id, company_id)
    references public.notification_events(id, company_id)
    on delete cascade,
  constraint notification_deliveries_recipient_company_fk
    foreign key (recipient_id, company_id)
    references public.notification_recipients(id, company_id)
    on delete cascade,
  constraint notification_deliveries_id_company_id_key
    unique (id, company_id),
  constraint notification_deliveries_event_recipient_channel_key
    unique (company_id, event_id, recipient_id, channel),
  constraint notification_deliveries_channel_check
    check (channel in ('whatsapp', 'email')),
  constraint notification_deliveries_status_check
    check (status in (
      'queued',
      'processing',
      'sent',
      'delivered',
      'read',
      'failed',
      'skipped',
      'cancelled'
    )),
  constraint notification_deliveries_attempt_count_check
    check (attempt_count >= 0),
  constraint notification_deliveries_rendered_variables_check
    check (jsonb_typeof(rendered_variables) in ('array', 'object')),
  constraint notification_deliveries_provider_response_check
    check (
      provider_response is null
      or jsonb_typeof(provider_response) = 'object'
    )
);

create unique index notification_deliveries_provider_message_id_key
on public.notification_deliveries (provider_message_id)
where provider_message_id is not null;

create table public.notification_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null,
  scope text not null,
  source text not null,
  reason text,
  unsubscribed_at timestamptz not null default now(),
  resubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_unsubscribes_recipient_company_fk
    foreign key (recipient_id, company_id)
    references public.notification_recipients(id, company_id)
    on delete cascade,
  constraint notification_unsubscribes_id_company_id_key
    unique (id, company_id),
  constraint notification_unsubscribes_company_recipient_scope_key
    unique (company_id, recipient_id, scope),
  constraint notification_unsubscribes_scope_not_blank
    check (btrim(scope) <> ''),
  constraint notification_unsubscribes_source_check
    check (source in ('bizlee_settings', 'whatsapp_reply', 'support', 'system')),
  constraint notification_unsubscribes_dates_check
    check (
      resubscribed_at is null
      or resubscribed_at >= unsubscribed_at
    )
);

create index notification_events_company_occurred_at_idx
on public.notification_events (company_id, occurred_at desc);

create index notification_events_company_type_occurred_at_idx
on public.notification_events (company_id, event_type, occurred_at desc);

create index notification_recipients_company_verification_idx
on public.notification_recipients (company_id, verification_status);

create index notification_preferences_company_enabled_type_idx
on public.notification_preferences (company_id, notification_type)
where is_enabled;

create index notification_deliveries_claim_idx
on public.notification_deliveries (status, next_attempt_at, scheduled_at)
where status in ('queued', 'failed');

create index notification_deliveries_company_created_at_idx
on public.notification_deliveries (company_id, created_at desc);

create index notification_deliveries_recipient_created_at_idx
on public.notification_deliveries (recipient_id, created_at desc);

create index notification_unsubscribes_active_idx
on public.notification_unsubscribes (company_id, recipient_id, scope)
where resubscribed_at is null;

create trigger set_notification_events_updated_at
before update on public.notification_events
for each row execute function public.set_updated_at();

create trigger set_notification_recipients_updated_at
before update on public.notification_recipients
for each row execute function public.set_updated_at();

create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

create trigger set_notification_templates_updated_at
before update on public.notification_templates
for each row execute function public.set_updated_at();

create trigger set_notification_deliveries_updated_at
before update on public.notification_deliveries
for each row execute function public.set_updated_at();

create trigger set_notification_unsubscribes_updated_at
before update on public.notification_unsubscribes
for each row execute function public.set_updated_at();

alter table public.notification_events enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_unsubscribes enable row level security;

create policy "Super admins manage notification events"
on public.notification_events for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant admins view notification events"
on public.notification_events for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (select public.user_has_permission('settings', 'view'))
);

create policy "Super admins manage notification recipients"
on public.notification_recipients for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant users view permitted notification recipients"
on public.notification_recipients for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.users_profile
      where users_profile.id = notification_recipients.user_profile_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'view'))
  )
);

create policy "Super admins manage notification preferences"
on public.notification_preferences for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant users view permitted notification preferences"
on public.notification_preferences for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_preferences.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'view'))
  )
);

create policy "Tenant users create permitted notification preferences"
on public.notification_preferences for insert to authenticated
with check (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_preferences.recipient_id
        and notification_recipients.company_id = notification_preferences.company_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
);

create policy "Tenant users update permitted notification preferences"
on public.notification_preferences for update to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_preferences.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
)
with check (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_preferences.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
);

create policy "Super admins manage notification templates"
on public.notification_templates for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant admins view available notification templates"
on public.notification_templates for select to authenticated
using (
  (company_id is null or company_id = (select public.get_current_user_company_id()))
  and (select public.user_has_permission('settings', 'view'))
);

create policy "Super admins manage notification deliveries"
on public.notification_deliveries for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant admins view notification deliveries"
on public.notification_deliveries for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (select public.user_has_permission('settings', 'view'))
);

create policy "Super admins manage notification unsubscribes"
on public.notification_unsubscribes for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Tenant users view permitted notification unsubscribes"
on public.notification_unsubscribes for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_unsubscribes.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'view'))
  )
);

create policy "Tenant users create permitted notification unsubscribes"
on public.notification_unsubscribes for insert to authenticated
with check (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_unsubscribes.recipient_id
        and notification_recipients.company_id = notification_unsubscribes.company_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
);

create policy "Tenant users update permitted notification unsubscribes"
on public.notification_unsubscribes for update to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_unsubscribes.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
)
with check (
  company_id = (select public.get_current_user_company_id())
  and (
    exists (
      select 1
      from public.notification_recipients
      join public.users_profile
        on users_profile.id = notification_recipients.user_profile_id
      where notification_recipients.id = notification_unsubscribes.recipient_id
        and users_profile.auth_user_id = (select auth.uid())
    )
    or (select public.user_has_permission('settings', 'update'))
  )
);

grant select, insert, update, delete
on public.notification_events,
  public.notification_recipients,
  public.notification_preferences,
  public.notification_templates,
  public.notification_deliveries,
  public.notification_unsubscribes
to authenticated;

grant select, insert, update, delete
on public.notification_events,
  public.notification_recipients,
  public.notification_preferences,
  public.notification_templates,
  public.notification_deliveries,
  public.notification_unsubscribes
to service_role;
