-- Behavior-driven trial engagement.
--
-- This replaces calendar-only activation sequences with evidence-based
-- interventions. The event store records meaningful portal use (sessions,
-- navigation, safe client errors) alongside the existing database audit trail.
-- Every row is tenant-scoped with company_id; platform staff can inspect the
-- evidence while tenant users can only append their own safe portal events.

create table public.portal_activity_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  user_profile_id uuid references public.users_profile(id) on delete set null,
  event_key text not null check (btrim(event_key) <> ''),
  event_category text not null check (event_category in (
    'session', 'navigation', 'workflow', 'onboarding', 'error', 'support', 'system'
  )),
  module text,
  route text,
  source text not null check (source in ('portal', 'database', 'system')),
  source_event_id uuid,
  client_event_key text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default now(),
  constraint portal_activity_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create unique index portal_activity_events_source_event_key
on public.portal_activity_events (company_id, source, source_event_id)
where source_event_id is not null;
create unique index portal_activity_events_client_event_key
on public.portal_activity_events (company_id, user_profile_id, client_event_key)
where client_event_key is not null;

create index portal_activity_events_company_recent_idx
on public.portal_activity_events (company_id, occurred_at desc, id desc);
create index portal_activity_events_trial_signal_idx
on public.portal_activity_events (company_id, event_key, occurred_at desc)
where event_key in (
  'portal_session_started', 'portal_page_viewed', 'feature_error',
  'help_requested', 'team_member_invited'
);
create index portal_activity_events_profile_recent_idx
on public.portal_activity_events (user_profile_id, occurred_at desc)
where user_profile_id is not null;

alter table public.portal_activity_events enable row level security;

create policy "Platform staff read portal activity evidence"
on public.portal_activity_events for select to authenticated
using ((select public.can_manage_trial_outreach()));

revoke all on public.portal_activity_events from anon, authenticated;
grant select on public.portal_activity_events to authenticated;

create or replace function public.record_portal_activity(
  p_event_key text,
  p_module text default null,
  p_route text default null,
  p_client_event_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.users_profile%rowtype;
  normalized_event_key text := nullif(btrim(p_event_key), '');
  normalized_module text := nullif(left(btrim(coalesce(p_module, '')), 80), '');
  normalized_route text := nullif(left(btrim(coalesce(p_route, '')), 240), '');
  normalized_client_event_key text := nullif(left(btrim(coalesce(p_client_event_key, '')), 160), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to record portal activity'
      using errcode = '42501';
  end if;

  if normalized_event_key not in (
    'portal_session_started', 'portal_page_viewed', 'feature_error', 'help_requested'
  ) then
    raise exception 'Unsupported portal activity event'
      using errcode = '22023';
  end if;

  if normalized_client_event_key is null then
    raise exception 'Portal activity requires an idempotency key'
      using errcode = '22023';
  end if;

  if normalized_route is not null and left(normalized_route, 1) <> '/' then
    raise exception 'Portal activity route must be a relative path'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Portal activity metadata must be an object'
      using errcode = '22023';
  end if;

  select * into profile
  from public.users_profile
  where auth_user_id = auth.uid()
    and status = 'active'
    and company_id is not null
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.portal_activity_events (
    company_id, organization_id, user_profile_id, event_key, event_category,
    module, route, source, client_event_key, metadata
  )
  values (
    profile.company_id,
    profile.organization_id,
    profile.id,
    normalized_event_key,
    case normalized_event_key
      when 'portal_session_started' then 'session'
      when 'portal_page_viewed' then 'navigation'
      when 'feature_error' then 'error'
      else 'support'
    end,
    normalized_module,
    normalized_route,
    'portal',
    normalized_client_event_key,
    jsonb_strip_nulls(jsonb_build_object(
      'error_name', nullif(left(coalesce(p_metadata ->> 'error_name', ''), 120), ''),
      'component', nullif(left(coalesce(p_metadata ->> 'component', ''), 120), '')
    ))
  )
  on conflict (company_id, user_profile_id, client_event_key)
  where client_event_key is not null do nothing;

  return true;
end;
$$;

revoke all on function public.record_portal_activity(text, text, text, text, jsonb)
from public, anon;
grant execute on function public.record_portal_activity(text, text, text, text, jsonb)
to authenticated;

create or replace function public.capture_portal_activity_from_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid;
begin
  target_company_id := new.company_id;
  if target_company_id is null and new.organization_id is not null then
    select organization.company_id into target_company_id
    from public.organizations as organization
    where organization.id = new.organization_id;
  end if;

  if target_company_id is null then
    return new;
  end if;

  insert into public.portal_activity_events (
    company_id, organization_id, user_profile_id, event_key, event_category,
    module, source, source_event_id, metadata, occurred_at
  )
  values (
    target_company_id,
    new.organization_id,
    new.user_profile_id,
    coalesce(nullif(btrim(new.module), ''), 'workflow') || '_' ||
      coalesce(nullif(btrim(new.action), ''), 'changed'),
    case
      when new.module = 'onboarding' then 'onboarding'
      else 'workflow'
    end,
    nullif(btrim(new.module), ''),
    'database',
    new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'table_name', nullif(btrim(coalesce(new.table_name, '')), ''),
      'record_id', new.record_id,
      'action', nullif(btrim(new.action), '')
    )),
    new.created_at
  )
  on conflict (company_id, source, source_event_id)
  where source_event_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists capture_portal_activity_from_audit_log on public.activity_logs;
create trigger capture_portal_activity_from_audit_log
after insert on public.activity_logs
for each row execute function public.capture_portal_activity_from_audit_log();

revoke all on function public.capture_portal_activity_from_audit_log()
from public, anon, authenticated;

-- These workflow tables were added after the original audit foundation. Their
-- changes now flow into the same portal evidence stream as the existing CRM,
-- quotation, project, and payment audit events.
drop trigger if exists audit_products_changes on public.products;
create trigger audit_products_changes
after insert or update or delete on public.products
for each row execute function public.audit_table_change('products');

drop trigger if exists audit_lead_followups_changes on public.lead_followups;
create trigger audit_lead_followups_changes
after insert or update or delete on public.lead_followups
for each row execute function public.audit_table_change('lead_followups');

drop trigger if exists audit_company_onboarding_progress_changes on public.company_onboarding_progress;
create trigger audit_company_onboarding_progress_changes
after insert or update on public.company_onboarding_progress
for each row execute function public.audit_table_change('onboarding');

create or replace function public.capture_team_invite_portal_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null or new.invited_at is null then
    return new;
  end if;

  insert into public.portal_activity_events (
    company_id, organization_id, user_profile_id, event_key, event_category,
    module, source, source_event_id, metadata, occurred_at
  ) values (
    new.company_id,
    new.organization_id,
    new.id,
    'team_member_invited',
    'workflow',
    'team',
    'system',
    new.id,
    jsonb_build_object('status', new.status),
    new.invited_at
  )
  on conflict (company_id, source, source_event_id)
  where source_event_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists capture_team_invite_portal_activity on public.users_profile;
create trigger capture_team_invite_portal_activity
after insert on public.users_profile
for each row execute function public.capture_team_invite_portal_activity();

revoke all on function public.capture_team_invite_portal_activity()
from public, anon, authenticated;

alter table public.trial_outreach_enrollments
  add column if not exists intent_score smallint not null default 0
    check (intent_score between 0 and 100),
  add column if not exists intent_tier text not null default 'low'
    check (intent_tier in ('low', 'warming', 'high', 'value_reached', 'adoption_signal')),
  add column if not exists value_reached_at timestamptz,
  add column if not exists adoption_signal_at timestamptz,
  add column if not exists last_trigger_key text;

alter table public.trial_outreach_touchpoints
  add column if not exists trigger_key text,
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists reason text,
  add column if not exists recipient_profile_id uuid references public.users_profile(id) on delete set null;

update public.trial_outreach_touchpoints
set trigger_key = coalesce(trigger_key, 'legacy_day_sequence')
where trigger_key is null;

alter table public.trial_outreach_touchpoints
  alter column trigger_key set not null;

alter table public.trial_outreach_touchpoints
  drop constraint if exists trial_outreach_touchpoints_channel_check;
alter table public.trial_outreach_touchpoints
  add constraint trial_outreach_touchpoints_channel_check
  check (channel in ('email', 'whatsapp', 'call', 'in_app', 'support'));

alter table public.trial_outreach_interactions
  drop constraint if exists trial_outreach_interactions_channel_check;
alter table public.trial_outreach_interactions
  add constraint trial_outreach_interactions_channel_check
  check (channel in ('email', 'whatsapp', 'call', 'in_app', 'support', 'system'));

create index if not exists trial_outreach_touchpoints_trigger_idx
on public.trial_outreach_touchpoints (company_id, enrollment_id, trigger_key, scheduled_at desc);
create index if not exists trial_outreach_touchpoints_open_tasks_idx
on public.trial_outreach_touchpoints (priority desc, scheduled_at, id)
where channel in ('call', 'support') and status in ('queued', 'due', 'processing');

-- The legacy migration may already have queued future day-by-day messages.
-- Preserve their history, but prevent old calendar logic from reaching users.
update public.trial_outreach_touchpoints
set status = 'cancelled', outcome = 'superseded_by_behavior_flow', updated_at = now()
where trigger_key = 'legacy_day_sequence'
  and status in ('queued', 'due', 'processing');

insert into public.notification_templates (
  company_id, notification_key, provider, provider_template_name,
  language_code, category, approval_status, variable_schema
)
values
  (null, 'trial_behavior_no_login_24h', 'meta', 'bizlee_trial_no_login_24h', 'en_US', 'marketing', 'draft', '["first_name","company_name","next_step_url"]'::jsonb),
  (null, 'trial_behavior_setup_incomplete', 'meta', 'bizlee_trial_setup_incomplete', 'en_US', 'marketing', 'draft', '["first_name","company_name","next_step_url"]'::jsonb),
  (null, 'trial_behavior_inactive_48h', 'meta', 'bizlee_trial_inactive_48h', 'en_US', 'marketing', 'draft', '["first_name","company_name","next_step_url"]'::jsonb),
  (null, 'trial_behavior_rescue_five_days', 'meta', 'bizlee_trial_rescue_five_days', 'en_US', 'marketing', 'draft', '["first_name","company_name","trial_end_date","next_step_url"]'::jsonb)
on conflict (notification_key, language_code) where company_id is null
do update set
  provider_template_name = excluded.provider_template_name,
  variable_schema = excluded.variable_schema,
  category = excluded.category,
  updated_at = now();

create or replace function public.get_trial_outreach_behavior_snapshots(
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
  email_opted_in boolean,
  onboarding_status text,
  onboarding_step text,
  onboarding_completed_at timestamptz,
  product_count bigint,
  first_product_at timestamptz,
  enquiry_without_followup_count bigint,
  last_unfollowed_enquiry_at timestamptz,
  login_event_count bigint,
  team_invite_count bigint,
  first_team_invite_at timestamptz,
  feature_error_count_24h bigint,
  latest_feature_error_at timestamptz,
  latest_activity_event text,
  intent_score integer,
  intent_tier text,
  is_high_intent boolean,
  value_reached boolean,
  adoption_signal boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select * from public.get_trial_outreach_snapshots(p_company_id)
  ), enriched as (
    select
      base.*,
      onboarding.status as onboarding_status,
      onboarding.current_step as onboarding_step,
      onboarding.completed_at as onboarding_completed_at,
      products.product_count,
      products.first_product_at,
      enquiries.enquiry_without_followup_count,
      enquiries.last_unfollowed_enquiry_at,
      portal.login_event_count,
      team.team_invite_count,
      team.first_team_invite_at,
      portal.feature_error_count_24h,
      portal.latest_feature_error_at,
      portal.latest_activity_event,
      portal.last_portal_activity_at
    from base
    left join public.company_onboarding_progress as onboarding
      on onboarding.company_id = base.company_id
    left join lateral (
      select
        count(*)::bigint as product_count,
        min(products.created_at) as first_product_at
      from public.products
      where products.tenant_id = base.organization_id
        and products.created_at >= base.trial_started_at
    ) as products on true
    left join lateral (
      select
        count(*) filter (
          where not exists (
            select 1
            from public.lead_followups as followups
            where followups.lead_id = leads.id
              and followups.organization_id = base.organization_id
          )
        )::bigint as enquiry_without_followup_count,
        max(leads.created_at) filter (
          where not exists (
            select 1
            from public.lead_followups as followups
            where followups.lead_id = leads.id
              and followups.organization_id = base.organization_id
          )
        ) as last_unfollowed_enquiry_at
      from public.leads
      where leads.organization_id = base.organization_id
        and leads.created_at >= base.trial_started_at
    ) as enquiries on true
    left join lateral (
      select
        count(*) filter (
          where events.event_key = 'portal_session_started'
        )::bigint as login_event_count,
        count(*) filter (
          where events.event_key = 'feature_error'
            and events.occurred_at >= now() - interval '24 hours'
        )::bigint as feature_error_count_24h,
        max(events.occurred_at) filter (
          where events.event_key = 'feature_error'
        ) as latest_feature_error_at,
        (array_agg(events.event_key order by events.occurred_at desc, events.id desc))[1]
          as latest_activity_event,
        max(events.occurred_at) as last_portal_activity_at
      from public.portal_activity_events as events
      where events.company_id = base.company_id
        and events.occurred_at >= base.trial_started_at
    ) as portal on true
    left join lateral (
      select
        count(*)::bigint as team_invite_count,
        min(profiles.invited_at) as first_team_invite_at
      from public.users_profile as profiles
      where profiles.company_id = base.company_id
        and profiles.id is distinct from base.admin_profile_id
        and profiles.invited_at >= base.trial_started_at
    ) as team on true
  )
  select
    enriched.company_id,
    enriched.organization_id,
    enriched.company_name,
    enriched.contact_name,
    enriched.contact_email,
    enriched.contact_phone,
    enriched.admin_profile_id,
    enriched.admin_last_login_at,
    enriched.trial_started_at,
    enriched.trial_ends_at,
    enriched.subscription_status,
    enriched.enrollment_id,
    enriched.enrollment_status,
    enriched.engagement_state,
    enriched.first_login_at,
    enriched.last_login_at,
    case
      when enriched.last_activity_at is null then enriched.last_portal_activity_at
      when enriched.last_portal_activity_at is null then enriched.last_activity_at
      else greatest(enriched.last_activity_at, enriched.last_portal_activity_at)
    end,
    enriched.first_customer_at,
    enriched.first_lead_at,
    enriched.first_quotation_at,
    enriched.first_site_survey_at,
    enriched.first_project_at,
    enriched.customer_count,
    enriched.lead_count,
    enriched.quotation_count,
    enriched.site_survey_count,
    enriched.project_count,
    enriched.first_value_at,
    enriched.first_value_kind,
    enriched.timezone,
    enriched.preferred_language,
    enriched.whatsapp_recipient_id,
    enriched.whatsapp_opted_in,
    enriched.email_opted_in,
    enriched.onboarding_status,
    enriched.onboarding_step,
    enriched.onboarding_completed_at,
    enriched.product_count,
    enriched.first_product_at,
    enriched.enquiry_without_followup_count,
    enriched.last_unfollowed_enquiry_at,
    enriched.login_event_count,
    enriched.team_invite_count,
    enriched.first_team_invite_at,
    enriched.feature_error_count_24h,
    enriched.latest_feature_error_at,
    enriched.latest_activity_event,
    least(100, greatest(0,
      least(4, enriched.login_event_count)::integer * 10 +
      least(3, enriched.lead_count)::integer * 12 +
      case when enriched.product_count > 0 then 8 else 0 end +
      case when enriched.onboarding_status = 'completed' then 10 else 0 end +
      case when enriched.first_quotation_at is not null then 35 else 0 end +
      case when enriched.team_invite_count > 0 then 15 else 0 end
    )),
    case
      when enriched.first_quotation_at is not null then 'value_reached'
      when enriched.team_invite_count > 0 then 'adoption_signal'
      when enriched.login_event_count >= 3 and enriched.lead_count >= 2 then 'high'
      when enriched.login_event_count > 0 or enriched.lead_count > 0 then 'warming'
      else 'low'
    end,
    coalesce(enriched.login_event_count >= 3 and enriched.lead_count >= 2, false),
    enriched.first_quotation_at is not null,
    coalesce(enriched.team_invite_count > 0, false)
  from enriched;
$$;

revoke all on function public.get_trial_outreach_behavior_snapshots(uuid)
from public, anon, authenticated;
grant execute on function public.get_trial_outreach_behavior_snapshots(uuid)
to service_role;

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
  with snapshots as (
    select
      snapshot.*,
      greatest(1, least(14, floor(extract(epoch from (now() - snapshot.trial_started_at)) / 86400)::integer + 1))
        as sequence_day
    from public.get_trial_outreach_behavior_snapshots(p_company_id) as snapshot
    where snapshot.enrollment_id is not null
      and snapshot.enrollment_status = 'active'
      and snapshot.subscription_status = 'trialing'
      and snapshot.trial_started_at <= now()
      and snapshot.trial_ends_at > now()
  ), behaviors as (
    select snapshots.*, 'no_login_24h'::text as trigger_key,
      'trial_behavior_no_login_24h'::text as touchpoint_key,
      'whatsapp'::text as channel, 'high'::text as priority,
      'No portal session within 24 hours of trial activation.'::text as reason,
      '/dashboard'::text as destination_route,
      jsonb_build_object('hours_since_start', floor(extract(epoch from (now() - snapshots.trial_started_at)) / 3600)) as evidence
    from snapshots
    where snapshots.last_login_at is null
      and snapshots.trial_started_at <= now() - interval '24 hours'

    union all

    select snapshots.*, 'no_login_24h', 'trial_behavior_no_login_24h', 'call', 'high',
      'No portal session within 24 hours of trial activation.', '/dashboard',
      jsonb_build_object('hours_since_start', floor(extract(epoch from (now() - snapshots.trial_started_at)) / 3600))
    from snapshots
    where snapshots.last_login_at is null
      and snapshots.trial_started_at <= now() - interval '24 hours'

    union all

    select snapshots.*, 'company_setup_incomplete_24h', 'trial_behavior_setup_incomplete', 'whatsapp', 'normal',
      'The owner logged in, but company setup remains incomplete after 24 hours.', '/onboarding/company',
      jsonb_build_object('onboarding_step', snapshots.onboarding_step)
    from snapshots
    where snapshots.last_login_at is not null
      and snapshots.onboarding_status is distinct from 'completed'
      and snapshots.trial_started_at <= now() - interval '24 hours'

    union all

    select snapshots.*, 'company_setup_no_enquiry_24h', 'trial_behavior_first_enquiry', 'call', 'normal',
      'Company setup is complete but no enquiry has been created after 24 hours.', '/leads',
      jsonb_build_object('completed_at', snapshots.onboarding_completed_at)
    from snapshots
    where snapshots.onboarding_status = 'completed'
      and snapshots.onboarding_completed_at <= now() - interval '24 hours'
      and snapshots.lead_count = 0

    union all

    select snapshots.*, 'enquiry_without_follow_up', 'trial_behavior_follow_up_prompt', 'in_app', 'normal',
      'An enquiry was created without a follow-up.', '/leads',
      jsonb_build_object('enquiries_without_follow_up', snapshots.enquiry_without_followup_count)
    from snapshots
    where snapshots.enquiry_without_followup_count > 0

    union all

    select snapshots.*, 'no_products_day_3', 'trial_behavior_product_setup', 'in_app', 'normal',
      'No products have been added by the third trial day.', '/products-materials',
      jsonb_build_object('trial_day', snapshots.sequence_day)
    from snapshots
    where snapshots.trial_started_at <= now() - interval '3 days'
      and snapshots.product_count = 0

    union all

    select snapshots.*, 'products_without_quotation', 'trial_behavior_first_quotation', 'in_app', 'normal',
      'Products are ready, but no quotation has been created.', '/quotations/new',
      jsonb_build_object('product_count', snapshots.product_count)
    from snapshots
    where snapshots.product_count > 0
      and snapshots.first_product_at <= now() - interval '24 hours'
      and snapshots.quotation_count = 0

    union all

    select snapshots.*, 'inactive_48h', 'trial_behavior_inactive_48h', 'whatsapp', 'normal',
      'No meaningful portal activity for 48 hours.', '/dashboard',
      jsonb_build_object('last_activity_at', snapshots.last_activity_at)
    from snapshots
    where snapshots.last_login_at is not null
      and snapshots.last_activity_at <= now() - interval '48 hours'

    union all

    select snapshots.*, 'active_five_days_left', 'trial_behavior_conversion_five_days', 'call', 'high',
      'Active account with five days left in the trial. Confirm value and discuss conversion.', '/billing/plans',
      jsonb_build_object('intent_score', snapshots.intent_score, 'intent_tier', snapshots.intent_tier)
    from snapshots
    where snapshots.trial_ends_at <= now() + interval '5 days'
      and snapshots.trial_ends_at > now() + interval '4 days'
      and snapshots.last_activity_at >= now() - interval '48 hours'

    union all

    select snapshots.*, 'inactive_five_days_left', 'trial_behavior_rescue_five_days', 'whatsapp', 'high',
      'Inactive account with five days left in the trial. Offer assisted rescue.', '/dashboard',
      jsonb_build_object('last_activity_at', snapshots.last_activity_at)
    from snapshots
    where snapshots.trial_ends_at <= now() + interval '5 days'
      and snapshots.trial_ends_at > now() + interval '4 days'
      and (snapshots.last_activity_at is null or snapshots.last_activity_at < now() - interval '48 hours')

    union all

    select snapshots.*, 'inactive_five_days_left', 'trial_behavior_rescue_five_days', 'call', 'high',
      'Inactive account with five days left in the trial. Offer assisted rescue.', '/dashboard',
      jsonb_build_object('last_activity_at', snapshots.last_activity_at)
    from snapshots
    where snapshots.trial_ends_at <= now() + interval '5 days'
      and snapshots.trial_ends_at > now() + interval '4 days'
      and (snapshots.last_activity_at is null or snapshots.last_activity_at < now() - interval '48 hours')

    union all

    select snapshots.*, 'feature_confusion_or_error', 'trial_behavior_support_escalation', 'support', 'urgent',
      'A portal error was recorded; product support should verify the user is unblocked.', '/dashboard',
      jsonb_build_object('feature_error_count_24h', snapshots.feature_error_count_24h)
    from snapshots
    where snapshots.feature_error_count_24h > 0
  ), candidates as (
    select behaviors.*
    from behaviors
    where not exists (
      select 1
      from public.trial_outreach_touchpoints as existing
      where existing.company_id = behaviors.company_id
        and existing.enrollment_id = behaviors.enrollment_id
        and existing.trigger_key = behaviors.trigger_key
        and (
          (behaviors.trigger_key = 'inactive_48h'
            and existing.scheduled_at >= now() - interval '48 hours')
          or (behaviors.trigger_key = 'feature_confusion_or_error'
            and existing.scheduled_at >= behaviors.latest_feature_error_at)
          or behaviors.trigger_key not in ('inactive_48h', 'feature_confusion_or_error')
        )
    )
  ), inserted as (
    insert into public.trial_outreach_touchpoints (
      company_id, enrollment_id, sequence_day, touchpoint_key, trigger_key,
      channel, priority, reason, recipient_profile_id, status, scheduled_at, metadata
    )
    select
      candidates.company_id,
      candidates.enrollment_id,
      candidates.sequence_day,
      candidates.touchpoint_key,
      candidates.trigger_key,
      candidates.channel,
      candidates.priority,
      candidates.reason,
      candidates.admin_profile_id,
      'queued',
      now(),
      jsonb_build_object(
        'trigger_key', candidates.trigger_key,
        'reason', candidates.reason,
        'destination_route', candidates.destination_route,
        'evidence', candidates.evidence
      )
    from candidates
    on conflict (company_id, enrollment_id, sequence_day, touchpoint_key, channel)
    do nothing
    returning id
  )
  select count(*)::integer into inserted_count from inserted;

  return coalesce(inserted_count, 0);
end;
$$;

revoke all on function public.schedule_trial_outreach_touchpoints(uuid)
from public, anon, authenticated;
grant execute on function public.schedule_trial_outreach_touchpoints(uuid)
to service_role;

drop function public.claim_trial_outreach_touchpoints(integer);

create function public.claim_trial_outreach_touchpoints(p_limit integer default 100)
returns table (
  touchpoint_id uuid,
  company_id uuid,
  enrollment_id uuid,
  sequence_day integer,
  touchpoint_key text,
  channel text,
  scheduled_at timestamptz,
  attempt_count integer,
  assigned_to_profile_id uuid,
  recipient_profile_id uuid,
  priority text,
  reason text,
  metadata jsonb
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
      and enrollments.status = 'active'
    order by
      case touchpoints.priority
        when 'urgent' then 0
        when 'high' then 1
        when 'normal' then 2
        else 3
      end,
      touchpoints.scheduled_at,
      touchpoints.created_at
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
    claimed.assigned_to_profile_id,
    claimed.recipient_profile_id,
    claimed.priority,
    claimed.reason,
    claimed.metadata
  from claimed;
end;
$$;

revoke all on function public.claim_trial_outreach_touchpoints(integer)
from public, anon, authenticated;
grant execute on function public.claim_trial_outreach_touchpoints(integer)
to service_role;

create or replace function public.publish_trial_outreach_in_app_prompt(
  p_touchpoint_id uuid,
  p_company_id uuid,
  p_recipient_profile_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  touchpoint_company_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'In-app prompt payload must be an object' using errcode = '22023';
  end if;

  select company_id into touchpoint_company_id
  from public.trial_outreach_touchpoints
  where id = p_touchpoint_id;

  if touchpoint_company_id is null or touchpoint_company_id <> p_company_id then
    raise exception 'Trial outreach touchpoint does not belong to the target company'
      using errcode = '23503';
  end if;

  insert into public.notification_events (
    company_id, event_type, source_type, source_record_id, idempotency_key, payload, occurred_at
  ) values (
    p_company_id,
    'trial_engagement_prompt',
    'trial_outreach_touchpoint',
    p_touchpoint_id::text,
    'trial-in-app:' || p_touchpoint_id::text,
    p_payload,
    now()
  )
  on conflict (company_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select id into event_id
    from public.notification_events
    where company_id = p_company_id
      and idempotency_key = 'trial-in-app:' || p_touchpoint_id::text;
  end if;

  insert into public.in_app_notification_receipts (
    company_id, event_id, recipient_user_profile_id
  )
  select p_company_id, event_id, profiles.id
  from public.users_profile as profiles
  where profiles.company_id = p_company_id
    and profiles.status = 'active'
    and profiles.auth_user_id is not null
    and (p_recipient_profile_id is null or profiles.id = p_recipient_profile_id)
  on conflict do nothing;

  return event_id;
end;
$$;

revoke all on function public.publish_trial_outreach_in_app_prompt(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.publish_trial_outreach_in_app_prompt(uuid, uuid, uuid, jsonb)
to service_role;

create or replace function public.trial_outreach_behavior_dashboard_summary(
  report_start date,
  report_end date
)
returns table (
  active_trial_count bigint,
  interventions_due_count bigint,
  no_login_24h_count bigint,
  setup_stalled_count bigint,
  no_enquiry_count bigint,
  inactive_48h_count bigint,
  high_intent_count bigint,
  value_reached_count bigint,
  adoption_signal_count bigint,
  conversion_tasks_due_count bigint,
  rescue_tasks_due_count bigint,
  support_escalation_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_trial_outreach() then
    raise exception 'Platform outreach access required' using errcode = '42501';
  end if;

  return query
  with snapshots as (
    select * from public.get_trial_outreach_behavior_snapshots(null)
    where enrollment_status = 'active'
      and subscription_status = 'trialing'
      and trial_ends_at > now()
  )
  select
    (select count(*) from snapshots),
    (select count(*) from public.trial_outreach_touchpoints
      where status in ('queued', 'due') and scheduled_at <= now()),
    (select count(*) from snapshots
      where last_login_at is null and trial_started_at <= now() - interval '24 hours'),
    (select count(*) from snapshots
      where last_login_at is not null and onboarding_status is distinct from 'completed'),
    (select count(*) from snapshots
      where onboarding_status = 'completed' and lead_count = 0),
    (select count(*) from snapshots
      where last_login_at is not null and last_activity_at <= now() - interval '48 hours'),
    (select count(*) from snapshots where is_high_intent),
    (select count(*) from snapshots where value_reached),
    (select count(*) from snapshots where adoption_signal),
    (select count(*) from public.trial_outreach_touchpoints
      where trigger_key = 'active_five_days_left' and status in ('queued', 'due')
        and scheduled_at >= report_start and scheduled_at < report_end),
    (select count(*) from public.trial_outreach_touchpoints
      where trigger_key = 'inactive_five_days_left' and status in ('queued', 'due')
        and scheduled_at >= report_start and scheduled_at < report_end),
    (select count(*) from public.trial_outreach_touchpoints
      where channel = 'support' and status in ('queued', 'due'));
end;
$$;

revoke all on function public.trial_outreach_behavior_dashboard_summary(date, date)
from public, anon;
grant execute on function public.trial_outreach_behavior_dashboard_summary(date, date)
to authenticated;

notify pgrst, 'reload schema';
