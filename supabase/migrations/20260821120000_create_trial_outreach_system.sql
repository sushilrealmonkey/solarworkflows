-- Trial activation and churn-reduction outreach.
--
-- This is a platform-owned workflow. company_id always identifies the target
-- tenant, while platform staff assignment is intentionally cross-tenant.

create table public.trial_outreach_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  subscription_id uuid references public.company_subscriptions(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'converted', 'expired', 'opted_out', 'completed')),
  engagement_state text not null default 'never_started'
    check (engagement_state in (
      'never_started',
      'started_stalled',
      'activated_inactive',
      'engaged',
      'converted',
      'paused',
      'opted_out',
      'expired'
    )),
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  first_login_at timestamptz,
  last_login_at timestamptz,
  first_value_at timestamptz,
  last_activity_at timestamptz,
  first_value_kind text,
  preferred_language text not null default 'en',
  timezone text not null default 'Asia/Kolkata',
  last_blocker text,
  enrolled_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_outreach_enrollments_language_check
    check (preferred_language in ('en', 'hi')),
  constraint trial_outreach_enrollments_timezone_check
    check (btrim(timezone) <> ''),
  constraint trial_outreach_enrollments_first_value_kind_check
    check (first_value_kind is null or first_value_kind in ('lead', 'customer', 'quotation', 'site_survey', 'project')),
  constraint trial_outreach_enrollments_id_company_key
    unique (id, company_id)
);

create table public.trial_outreach_touchpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrollment_id uuid not null,
  sequence_day integer not null check (sequence_day between 1 and 14),
  touchpoint_key text not null check (btrim(touchpoint_key) <> ''),
  channel text not null check (channel in ('email', 'whatsapp', 'call')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'delivered', 'read', 'due', 'completed', 'failed', 'skipped', 'cancelled')),
  scheduled_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  assigned_to_profile_id uuid references public.users_profile(id) on delete set null,
  notification_delivery_id uuid,
  provider_message_id text,
  failure_code text,
  failure_message text,
  outcome text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_outreach_touchpoints_enrollment_company_fk
    foreign key (enrollment_id, company_id)
    references public.trial_outreach_enrollments(id, company_id)
    on delete cascade,
  constraint trial_outreach_touchpoints_id_company_key
    unique (id, company_id),
  constraint trial_outreach_touchpoints_idempotency_key
    unique (company_id, enrollment_id, sequence_day, touchpoint_key, channel)
);

create table public.trial_outreach_interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrollment_id uuid not null,
  touchpoint_id uuid,
  channel text not null check (channel in ('email', 'whatsapp', 'call', 'in_app', 'system')),
  interaction_type text not null
    check (interaction_type in ('reply', 'call_attempt', 'call_connected', 'blocker', 'activation', 'opt_out', 'note', 'status_change')),
  outcome text,
  blocker text,
  notes text,
  recorded_by_profile_id uuid references public.users_profile(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_outreach_interactions_enrollment_company_fk
    foreign key (enrollment_id, company_id)
    references public.trial_outreach_enrollments(id, company_id)
    on delete cascade,
  constraint trial_outreach_interactions_touchpoint_company_fk
    foreign key (touchpoint_id, company_id)
    references public.trial_outreach_touchpoints(id, company_id)
    on delete set null,
  constraint trial_outreach_interactions_id_company_key
    unique (id, company_id)
);

create index trial_outreach_enrollments_status_state_idx
on public.trial_outreach_enrollments (status, engagement_state, trial_ends_at);
create index trial_outreach_touchpoints_due_idx
on public.trial_outreach_touchpoints (status, scheduled_at)
where status in ('queued', 'processing', 'due');
create index trial_outreach_touchpoints_company_idx
on public.trial_outreach_touchpoints (company_id, scheduled_at desc);
create index trial_outreach_interactions_company_idx
on public.trial_outreach_interactions (company_id, occurred_at desc);

create trigger set_trial_outreach_enrollments_updated_at
before update on public.trial_outreach_enrollments
for each row execute function public.set_updated_at();
create trigger set_trial_outreach_touchpoints_updated_at
before update on public.trial_outreach_touchpoints
for each row execute function public.set_updated_at();
create trigger set_trial_outreach_interactions_updated_at
before update on public.trial_outreach_interactions
for each row execute function public.set_updated_at();

create or replace function public.can_manage_trial_outreach()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_super_admin() or public.has_platform_role('backend_staff');
$$;

revoke all on function public.can_manage_trial_outreach() from public, anon;
grant execute on function public.can_manage_trial_outreach() to authenticated;

alter table public.trial_outreach_enrollments enable row level security;
alter table public.trial_outreach_touchpoints enable row level security;
alter table public.trial_outreach_interactions enable row level security;

create policy "Platform staff manage trial outreach enrollments"
on public.trial_outreach_enrollments for all to authenticated
using ((select public.can_manage_trial_outreach()))
with check ((select public.can_manage_trial_outreach()));

create policy "Platform staff manage trial outreach touchpoints"
on public.trial_outreach_touchpoints for all to authenticated
using ((select public.can_manage_trial_outreach()))
with check ((select public.can_manage_trial_outreach()));

create policy "Platform staff manage trial outreach interactions"
on public.trial_outreach_interactions for all to authenticated
using ((select public.can_manage_trial_outreach()))
with check ((select public.can_manage_trial_outreach()));

revoke all on public.trial_outreach_enrollments,
  public.trial_outreach_touchpoints,
  public.trial_outreach_interactions from anon;
grant select, insert, update, delete on public.trial_outreach_enrollments,
  public.trial_outreach_touchpoints,
  public.trial_outreach_interactions to authenticated;

create or replace function public.ensure_trial_outreach_enrollment_for_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'trialing'
    and new.trial_started_at is not null
    and new.trial_ends_at is not null then
    insert into public.trial_outreach_enrollments (
      company_id,
      subscription_id,
      trial_started_at,
      trial_ends_at
    )
    select
      new.company_id,
      new.id,
      new.trial_started_at,
      new.trial_ends_at
    where exists (
      select 1 from public.companies
      where companies.id = new.company_id
        and companies.is_in_house = false
    )
    on conflict (company_id) do update
    set
      subscription_id = excluded.subscription_id,
      trial_started_at = excluded.trial_started_at,
      trial_ends_at = excluded.trial_ends_at,
      updated_at = now()
    where public.trial_outreach_enrollments.status in ('active', 'paused');
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_trial_outreach_enrollment
on public.company_subscriptions;
create trigger ensure_trial_outreach_enrollment
after insert or update of status, trial_started_at, trial_ends_at
on public.company_subscriptions
for each row execute function public.ensure_trial_outreach_enrollment_for_subscription();

create or replace function public.ensure_trial_outreach_enrollments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.trial_outreach_enrollments (
    company_id,
    subscription_id,
    trial_started_at,
    trial_ends_at
  )
  select
    subscriptions.company_id,
    subscriptions.id,
    subscriptions.trial_started_at,
    subscriptions.trial_ends_at
  from public.company_subscriptions as subscriptions
  join public.companies
    on companies.id = subscriptions.company_id
  where subscriptions.status = 'trialing'
    and subscriptions.trial_started_at is not null
    and subscriptions.trial_ends_at is not null
    and subscriptions.trial_ends_at > now()
    and companies.is_in_house = false
  on conflict (company_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ensure_trial_outreach_enrollments() from public, anon, authenticated;
grant execute on function public.ensure_trial_outreach_enrollments() to service_role;
revoke all on function public.ensure_trial_outreach_enrollment_for_subscription() from public, anon, authenticated;

-- A verified phone that explicitly granted the existing account-welcome
-- notification is eligible for trial activation WhatsApp messages. STOP and
-- notification_unsubscribes still suppress every later delivery.
create or replace function public.seed_trial_activation_preference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.notification_type = 'account_welcome'
    and new.channel = 'whatsapp'
    and new.consent_status = 'granted'
    and new.is_enabled then
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
      new.company_id,
      new.recipient_id,
      'trial_activation',
      'whatsapp',
      true,
      'granted',
      coalesce(new.consent_source, 'account_welcome'),
      new.consented_at
    )
    on conflict (company_id, recipient_id, notification_type, channel)
    do update set
      is_enabled = excluded.is_enabled,
      consent_status = excluded.consent_status,
      consent_source = excluded.consent_source,
      consented_at = excluded.consented_at,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists seed_trial_activation_preference
on public.notification_preferences;
create trigger seed_trial_activation_preference
after insert or update of is_enabled, consent_status, consent_source, consented_at
on public.notification_preferences
for each row execute function public.seed_trial_activation_preference();

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
select
  existing.company_id,
  existing.recipient_id,
  'trial_activation',
  'whatsapp',
  existing.is_enabled,
  existing.consent_status,
  coalesce(existing.consent_source, 'account_welcome'),
  existing.consented_at
from public.notification_preferences as existing
where existing.notification_type = 'account_welcome'
  and existing.channel = 'whatsapp'
  and existing.consent_status = 'granted'
on conflict (company_id, recipient_id, notification_type, channel)
do nothing;

create or replace function public.stop_trial_outreach_for_whatsapp_opt_out()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resubscribed_at is not null then
    return new;
  end if;

  update public.trial_outreach_enrollments
  set
    status = 'opted_out',
    engagement_state = 'opted_out',
    stop_reason = 'whatsapp_opt_out',
    completed_at = now()
  where company_id = new.company_id
    and status = 'active';

  update public.trial_outreach_touchpoints
  set status = 'cancelled', outcome = 'whatsapp_opt_out', updated_at = now()
  where company_id = new.company_id
    and status in ('queued', 'due');

  return new;
end;
$$;

drop trigger if exists stop_trial_outreach_for_whatsapp_opt_out
on public.notification_unsubscribes;
create trigger stop_trial_outreach_for_whatsapp_opt_out
after insert or update of resubscribed_at
on public.notification_unsubscribes
for each row execute function public.stop_trial_outreach_for_whatsapp_opt_out();

update public.trial_outreach_enrollments as enrollments
set
  status = 'opted_out',
  engagement_state = 'opted_out',
  stop_reason = 'whatsapp_opt_out',
  completed_at = coalesce(enrollments.completed_at, now())
where enrollments.status = 'active'
  and exists (
    select 1
    from public.notification_unsubscribes as unsubscribes
    where unsubscribes.company_id = enrollments.company_id
      and unsubscribes.scope = 'all_whatsapp'
      and unsubscribes.resubscribed_at is null
  );

create or replace function public.pause_trial_outreach_for_whatsapp_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  insert into public.trial_outreach_interactions (
    company_id,
    enrollment_id,
    channel,
    interaction_type,
    notes,
    metadata,
    occurred_at
  )
  select
    enrollments.company_id,
    enrollments.id,
    'whatsapp',
    'reply',
    left(coalesce(new.text_body, 'WhatsApp reply received'), 2000),
    jsonb_build_object('whatsapp_message_id', new.id),
    coalesce(new.source_timestamp, now())
  from public.trial_outreach_enrollments as enrollments
  where enrollments.company_id = new.company_id
    and enrollments.status = 'active'
    and not exists (
      select 1
      from public.notification_unsubscribes as unsubscribes
      where unsubscribes.company_id = new.company_id
        and unsubscribes.scope = 'all_whatsapp'
        and unsubscribes.resubscribed_at is null
    );

  update public.trial_outreach_enrollments
  set
    status = 'paused',
    engagement_state = 'paused',
    stop_reason = 'customer_reply',
    paused_at = now()
  where company_id = new.company_id
    and status = 'active'
    and not exists (
      select 1
      from public.notification_unsubscribes as unsubscribes
      where unsubscribes.company_id = new.company_id
        and unsubscribes.scope = 'all_whatsapp'
        and unsubscribes.resubscribed_at is null
    );

  update public.trial_outreach_touchpoints
  set status = 'cancelled', outcome = 'customer_reply', updated_at = now()
  where company_id = new.company_id
    and status in ('queued', 'due');

  return new;
end;
$$;

drop trigger if exists pause_trial_outreach_for_whatsapp_reply
on public.whatsapp_messages;
create trigger pause_trial_outreach_for_whatsapp_reply
after insert
on public.whatsapp_messages
for each row execute function public.pause_trial_outreach_for_whatsapp_reply();

revoke all on function public.stop_trial_outreach_for_whatsapp_opt_out() from public, anon, authenticated;
revoke all on function public.pause_trial_outreach_for_whatsapp_reply() from public, anon, authenticated;

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
  (null, 'trial_activation_quick_start', 'meta', 'bizlee_trial_activation_quick_start', 'en_US', 'marketing', 'draft', '["first_name","company_name","trial_end_date","next_step_url"]'::jsonb),
  (null, 'trial_activation_setup_help', 'meta', 'bizlee_trial_activation_setup_help', 'en_US', 'marketing', 'draft', '["first_name","company_name","next_step_url"]'::jsonb),
  (null, 'trial_activation_blocker_check', 'meta', 'bizlee_trial_activation_blocker_check', 'en_US', 'marketing', 'draft', '["first_name","company_name","support_phone"]'::jsonb),
  (null, 'trial_activation_assisted_setup', 'meta', 'bizlee_trial_activation_assisted_setup', 'en_US', 'marketing', 'draft', '["first_name","company_name","next_step_url"]'::jsonb),
  (null, 'trial_activation_midpoint', 'meta', 'bizlee_trial_activation_midpoint', 'en_US', 'marketing', 'draft', '["first_name","company_name","progress","next_step_url"]'::jsonb),
  (null, 'trial_activation_use_case', 'meta', 'bizlee_trial_activation_use_case', 'en_US', 'marketing', 'draft', '["first_name","company_name","use_case","next_step_url"]'::jsonb),
  (null, 'trial_activation_three_days', 'meta', 'bizlee_trial_activation_three_days', 'en_US', 'marketing', 'draft', '["first_name","company_name","trial_end_date","next_step_url"]'::jsonb),
  (null, 'trial_activation_one_day', 'meta', 'bizlee_trial_activation_one_day', 'en_US', 'marketing', 'draft', '["first_name","company_name","trial_end_date","next_step_url"]'::jsonb),
  (null, 'trial_activation_expired', 'meta', 'bizlee_trial_activation_expired', 'en_US', 'marketing', 'draft', '["first_name","company_name","trial_end_date","next_step_url"]'::jsonb)
on conflict (notification_key, language_code) where company_id is null
do update set
  provider_template_name = excluded.provider_template_name,
  variable_schema = excluded.variable_schema,
  category = excluded.category,
  updated_at = now();

create or replace function public.get_trial_outreach_snapshots(
  p_company_id uuid default null
)
returns table (
  company_id uuid,
  organization_id uuid,
  company_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  admin_profile_id uuid,
  admin_last_login_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  subscription_status text,
  enrollment_id uuid,
  enrollment_status text,
  engagement_state text,
  first_login_at timestamptz,
  last_login_at timestamptz,
  last_activity_at timestamptz,
  first_customer_at timestamptz,
  first_lead_at timestamptz,
  first_quotation_at timestamptz,
  first_site_survey_at timestamptz,
  first_project_at timestamptz,
  customer_count bigint,
  lead_count bigint,
  quotation_count bigint,
  site_survey_count bigint,
  project_count bigint,
  first_value_at timestamptz,
  first_value_kind text,
  timezone text,
  preferred_language text,
  whatsapp_recipient_id uuid,
  whatsapp_opted_in boolean,
  email_opted_in boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    companies.id,
    organizations.id,
    companies.company_name,
    coalesce(admin.full_name, companies.owner_name),
    coalesce(admin.email, companies.owner_email),
    coalesce(admin.phone, companies.owner_phone),
    admin.id,
    admin.last_login_at,
    subscriptions.trial_started_at,
    subscriptions.trial_ends_at,
    subscriptions.status,
    enrollments.id,
    enrollments.status,
    enrollments.engagement_state,
    coalesce(enrollments.first_login_at, admin.last_login_at),
    coalesce(enrollments.last_login_at, admin.last_login_at),
    activity.last_activity_at,
    records.first_customer_at,
    records.first_lead_at,
    records.first_quotation_at,
    records.first_site_survey_at,
    records.first_project_at,
    records.customer_count,
    records.lead_count,
    records.quotation_count,
    records.site_survey_count,
    records.project_count,
    case
      when least(records.first_customer_at, records.first_lead_at) is not null
        and least(records.first_quotation_at, records.first_site_survey_at, records.first_project_at) is not null
      then greatest(
        least(records.first_customer_at, records.first_lead_at),
        least(records.first_quotation_at, records.first_site_survey_at, records.first_project_at)
      )
      else null
    end,
    case
      when records.first_customer_at is not null
        and records.first_customer_at <= least(records.first_lead_at, records.first_customer_at)
        and records.first_quotation_at is null
        and records.first_site_survey_at is null
        and records.first_project_at is null then 'customer'
      when records.first_lead_at is not null
        and records.first_lead_at <= least(records.first_customer_at, records.first_lead_at)
        and records.first_quotation_at is null
        and records.first_site_survey_at is null
        and records.first_project_at is null then 'lead'
      when records.first_quotation_at is not null then 'quotation'
      when records.first_site_survey_at is not null then 'site_survey'
      when records.first_project_at is not null then 'project'
      else null
    end,
    coalesce(settings.timezone, 'Asia/Kolkata'),
    coalesce(recipients.preferred_language, 'en'),
    recipients.id,
    coalesce(recipients.verification_status = 'verified' and activation_preference.is_enabled and activation_preference.consent_status = 'granted', false),
    coalesce(admin.email is not null, false)
  from public.company_subscriptions as subscriptions
  join public.companies
    on companies.id = subscriptions.company_id
  left join public.organizations
    on organizations.company_id = companies.id
  left join public.trial_outreach_enrollments as enrollments
    on enrollments.company_id = companies.id
  left join public.organization_settings as settings
    on settings.organization_id = organizations.id
  left join lateral (
    select
      profiles.id,
      profiles.full_name,
      profiles.email,
      profiles.phone,
      profiles.last_login_at
    from public.users_profile as profiles
    where profiles.company_id = companies.id
      and profiles.is_super_admin = false
      and profiles.status <> 'inactive'
    order by
      case when exists (
        select 1
        from public.user_roles as assignments
        join public.roles on roles.id = assignments.role_id
        where (assignments.user_profile_id = profiles.id or assignments.user_id = profiles.auth_user_id)
          and roles.role_key = 'admin'
      ) then 0 else 1 end,
      profiles.created_at nulls last,
      profiles.id
    limit 1
  ) as admin on true
  left join public.notification_recipients as recipients
    on recipients.company_id = companies.id
    and recipients.user_profile_id = admin.id
  left join public.notification_preferences as activation_preference
    on activation_preference.company_id = recipients.company_id
    and activation_preference.recipient_id = recipients.id
    and activation_preference.notification_type = 'trial_activation'
    and activation_preference.channel = 'whatsapp'
  left join lateral (
    select max(logs.created_at) as last_activity_at
    from public.activity_logs as logs
    where logs.organization_id = organizations.id
  ) as activity on true
  left join lateral (
    select
      (select min(customers.created_at) from public.customers where customers.organization_id = organizations.id) as first_customer_at,
      (select min(leads.created_at) from public.leads where leads.organization_id = organizations.id) as first_lead_at,
      (select min(quotations.created_at) from public.quotations where quotations.organization_id = organizations.id) as first_quotation_at,
      (select min(site_surveys.created_at) from public.site_surveys where site_surveys.organization_id = organizations.id) as first_site_survey_at,
      (select min(projects.created_at) from public.projects where projects.organization_id = organizations.id) as first_project_at,
      (select count(*) from public.customers where customers.organization_id = organizations.id) as customer_count,
      (select count(*) from public.leads where leads.organization_id = organizations.id) as lead_count,
      (select count(*) from public.quotations where quotations.organization_id = organizations.id) as quotation_count,
      (select count(*) from public.site_surveys where site_surveys.organization_id = organizations.id) as site_survey_count,
      (select count(*) from public.projects where projects.organization_id = organizations.id) as project_count
  ) as records on true
  where companies.is_in_house = false
    and subscriptions.trial_started_at is not null
    and subscriptions.trial_ends_at is not null
    and (p_company_id is null or companies.id = p_company_id);
$$;

revoke all on function public.get_trial_outreach_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.get_trial_outreach_snapshots(uuid) to service_role;

create or replace function public.schedule_trial_outreach_touchpoints(
  p_company_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  with steps(sequence_day, touchpoint_key, channel) as (
    values
      (1, 'trial_activation_quick_start', 'email'),
      (1, 'trial_activation_quick_start', 'whatsapp'),
      (1, 'trial_activation_call_1', 'call'),
      (2, 'trial_activation_setup_help', 'email'),
      (3, 'trial_activation_blocker_check', 'email'),
      (3, 'trial_activation_blocker_check', 'whatsapp'),
      (4, 'trial_activation_use_case', 'email'),
      (5, 'trial_activation_assisted_setup', 'email'),
      (5, 'trial_activation_assisted_setup', 'whatsapp'),
      (5, 'trial_activation_call_2', 'call'),
      (7, 'trial_activation_midpoint', 'email'),
      (7, 'trial_activation_midpoint', 'whatsapp'),
      (8, 'trial_activation_use_case', 'email'),
      (9, 'trial_activation_blocker_check', 'email'),
      (11, 'trial_activation_three_days', 'email'),
      (11, 'trial_activation_three_days', 'whatsapp'),
      (12, 'trial_activation_assisted_setup', 'email'),
      (12, 'trial_activation_assisted_setup', 'whatsapp'),
      (12, 'trial_activation_call_3', 'call'),
      (13, 'trial_activation_one_day', 'email'),
      (13, 'trial_activation_one_day', 'whatsapp'),
      (14, 'trial_activation_expired', 'email'),
      (14, 'trial_activation_expired', 'whatsapp')
  )
  insert into public.trial_outreach_touchpoints (
    company_id,
    enrollment_id,
    sequence_day,
    touchpoint_key,
    channel,
    status,
    scheduled_at
  )
  select
    enrollments.company_id,
    enrollments.id,
    steps.sequence_day,
    steps.touchpoint_key,
    steps.channel,
    'queued',
    (
      (
        (enrollments.trial_started_at at time zone enrollments.timezone)::date
        + steps.sequence_day
      ) + time '10:00'
    ) at time zone enrollments.timezone
  from public.trial_outreach_enrollments as enrollments
  cross join steps
  where enrollments.status in ('active', 'expired')
    and (p_company_id is null or enrollments.company_id = p_company_id)
  on conflict (company_id, enrollment_id, sequence_day, touchpoint_key, channel)
  do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.schedule_trial_outreach_touchpoints(uuid) from public, anon, authenticated;
grant execute on function public.schedule_trial_outreach_touchpoints(uuid) to service_role;

create or replace function public.claim_trial_outreach_touchpoints(p_limit integer default 100)
returns table (
  touchpoint_id uuid,
  company_id uuid,
  enrollment_id uuid,
  sequence_day integer,
  touchpoint_key text,
  channel text,
  scheduled_at timestamptz,
  attempt_count integer,
  assigned_to_profile_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'Trial outreach batch size must be between 1 and 200'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select touchpoints.id
    from public.trial_outreach_touchpoints as touchpoints
    join public.trial_outreach_enrollments as enrollments
      on enrollments.id = touchpoints.enrollment_id
      and enrollments.company_id = touchpoints.company_id
    where (
        touchpoints.status = 'queued'
        or (
          touchpoints.status = 'failed'
          and touchpoints.attempt_count < 3
          and touchpoints.failed_at < now() - interval '10 minutes'
        )
      )
      and touchpoints.scheduled_at <= now()
      and (
        enrollments.status = 'active'
        or (
          enrollments.status = 'expired'
          and touchpoints.touchpoint_key = 'trial_activation_expired'
        )
      )
    order by touchpoints.scheduled_at, touchpoints.created_at
    for update of touchpoints skip locked
    limit p_limit
  ), claimed as (
    update public.trial_outreach_touchpoints as touchpoints
    set
      status = 'processing',
      claimed_at = now(),
      attempt_count = touchpoints.attempt_count + 1,
      failure_code = null,
      failure_message = null,
      failed_at = null
    from candidates
    where touchpoints.id = candidates.id
    returning touchpoints.*
  )
  select
    claimed.id,
    claimed.company_id,
    claimed.enrollment_id,
    claimed.sequence_day,
    claimed.touchpoint_key,
    claimed.channel,
    claimed.scheduled_at,
    claimed.attempt_count,
    claimed.assigned_to_profile_id
  from claimed;
end;
$$;

revoke all on function public.claim_trial_outreach_touchpoints(integer) from public, anon, authenticated;
grant execute on function public.claim_trial_outreach_touchpoints(integer) to service_role;

create or replace function public.trial_outreach_dashboard_summary(
  report_start date,
  report_end date
)
returns table (
  enrolled_count bigint,
  no_login_count bigint,
  no_first_value_count bigint,
  calls_due_today_count bigint,
  first_value_day_1_count bigint,
  first_value_day_3_count bigint,
  first_value_day_7_count bigint,
  first_value_day_14_count bigint,
  converted_count bigint,
  replies_count bigint,
  connected_calls_count bigint,
  opt_out_count bigint,
  failed_delivery_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() and not public.has_platform_role('backend_staff') then
    raise exception 'Platform outreach access required' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select enrollments.*
    from public.trial_outreach_enrollments as enrollments
    where enrollments.enrolled_at < report_end
      and (
        enrollments.enrolled_at >= report_start
        or exists (
          select 1
          from public.trial_outreach_touchpoints as scheduled_touchpoints
          where scheduled_touchpoints.company_id = enrollments.company_id
            and scheduled_touchpoints.scheduled_at >= report_start
            and scheduled_touchpoints.scheduled_at < report_end
        )
        or exists (
          select 1
          from public.trial_outreach_interactions as recent_interactions
          where recent_interactions.company_id = enrollments.company_id
            and recent_interactions.occurred_at >= report_start
            and recent_interactions.occurred_at < report_end
        )
      )
  )
  select
    (select count(*) from scoped where scoped.enrolled_at >= report_start and scoped.enrolled_at < report_end),
    (select count(*) from scoped where scoped.engagement_state = 'never_started' and scoped.status = 'active'),
    (select count(*) from scoped where scoped.first_value_at is null and scoped.status = 'active'),
    (select count(*) from public.trial_outreach_touchpoints where channel = 'call' and status in ('queued', 'due') and scheduled_at::date = current_date),
    (select count(*) from scoped where scoped.first_value_at is not null and scoped.first_value_at < scoped.trial_started_at + interval '1 day'),
    (select count(*) from scoped where scoped.first_value_at is not null and scoped.first_value_at < scoped.trial_started_at + interval '3 days'),
    (select count(*) from scoped where scoped.first_value_at is not null and scoped.first_value_at < scoped.trial_started_at + interval '7 days'),
    (select count(*) from scoped where scoped.first_value_at is not null and scoped.first_value_at <= scoped.trial_ends_at),
    (select count(*) from scoped where scoped.status = 'converted'),
    (select count(*) from public.trial_outreach_interactions where interaction_type = 'reply' and occurred_at >= report_start and occurred_at < report_end),
    (select count(*) from public.trial_outreach_interactions where interaction_type = 'call_connected' and occurred_at >= report_start and occurred_at < report_end),
    (select count(*) from public.trial_outreach_interactions where interaction_type = 'opt_out' and occurred_at >= report_start and occurred_at < report_end),
    (select count(*) from public.trial_outreach_touchpoints where status = 'failed' and updated_at >= report_start and updated_at < report_end);
end;
$$;

revoke all on function public.trial_outreach_dashboard_summary(date, date) from public, anon;
grant execute on function public.trial_outreach_dashboard_summary(date, date) to authenticated;

create or replace function public.sync_trial_outreach_touchpoint_delivery()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.trial_outreach_touchpoints
  set
    status = case
      when new.status = 'sent' then 'sent'
      when new.status = 'delivered' then 'delivered'
      when new.status = 'read' then 'read'
      when new.status = 'failed' then 'failed'
      when new.status = 'skipped' then 'skipped'
      else status
    end,
    provider_message_id = coalesce(new.provider_message_id, provider_message_id),
    sent_at = coalesce(sent_at, new.sent_at),
    failed_at = case when new.status = 'failed' then coalesce(new.failed_at, now()) else failed_at end,
    failure_code = coalesce(new.failure_code, failure_code),
    failure_message = coalesce(new.failure_message, failure_message),
    updated_at = now()
  where notification_delivery_id = new.id;

  return new;
end;
$$;

drop trigger if exists sync_trial_outreach_touchpoint_delivery
on public.notification_deliveries;
create trigger sync_trial_outreach_touchpoint_delivery
after update of status, provider_message_id, sent_at, delivered_at, read_at, failed_at
on public.notification_deliveries
for each row execute function public.sync_trial_outreach_touchpoint_delivery();

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'process-bizlee-trial-outreach-every-five-minutes';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  if exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_outreach_project_url'
  ) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_outreach_worker_secret'
  ) then
    perform cron.schedule(
      'process-bizlee-trial-outreach-every-five-minutes',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'trial_outreach_project_url'
          ) || '/functions/v1/process-trial-outreach',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'trial_outreach_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        );
      $job$
    );
  else
    raise notice
      'Trial outreach Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
