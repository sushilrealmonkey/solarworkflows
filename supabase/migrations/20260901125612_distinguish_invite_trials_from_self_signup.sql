-- A trial is an explicit commercial decision made by a Super Admin, not the
-- default state of a self-service signup. Keep the origin with the subscription
-- so every API and database policy can make the same access decision.
alter table public.company_subscriptions
  add column if not exists trial_access_source text not null default 'paid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_subscriptions_trial_access_source_check'
      and conrelid = 'public.company_subscriptions'::regclass
  ) then
    alter table public.company_subscriptions
      add constraint company_subscriptions_trial_access_source_check
      check (trial_access_source in ('super_admin_invite', 'self_signup', 'paid'));
  end if;
end;
$$;

-- Correct legacy trial rows. A company whose first workspace profile was
-- invited is the only historical trial that can be identified as an admin
-- invitation. All other trial rows must select and pay for a plan.
with trial_origins as (
  select
    subscriptions.company_id,
    (
      select profiles.invited_at is not null
      from public.users_profile profiles
      where profiles.company_id = subscriptions.company_id
      order by profiles.created_at, profiles.id
      limit 1
    ) as is_super_admin_invite
  from public.company_subscriptions subscriptions
  where subscriptions.status = 'trialing'
)
update public.company_subscriptions subscriptions
set
  status = case
    when coalesce(trial_origins.is_super_admin_invite, false) then subscriptions.status
    else 'expired'
  end,
  plan_key = case
    when coalesce(trial_origins.is_super_admin_invite, false) then subscriptions.plan_key
    else null
  end,
  trial_started_at = case
    when coalesce(trial_origins.is_super_admin_invite, false) then subscriptions.trial_started_at
    else null
  end,
  trial_ends_at = case
    when coalesce(trial_origins.is_super_admin_invite, false) then subscriptions.trial_ends_at
    else null
  end,
  trial_access_source = case
    when coalesce(trial_origins.is_super_admin_invite, false) then 'super_admin_invite'
    else 'self_signup'
  end
from trial_origins
where subscriptions.company_id = trial_origins.company_id;

create or replace function public.create_company_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_super_admin() then
    insert into public.company_subscriptions (
      company_id,
      plan_key,
      status,
      trial_started_at,
      trial_ends_at,
      trial_access_source
    )
    values (
      new.id,
      'premium',
      'trialing',
      statement_timestamp(),
      statement_timestamp() + interval '14 days',
      'super_admin_invite'
    )
    on conflict (company_id) do nothing;
  else
    insert into public.company_subscriptions (
      company_id,
      plan_key,
      status,
      trial_started_at,
      trial_ends_at,
      trial_access_source
    )
    values (new.id, null, 'expired', null, null, 'self_signup')
    on conflict (company_id) do nothing;
  end if;

  -- Lets the workspace-creation transaction create its initial tenant records.
  perform set_config('app.onboarding_company_id', new.id::text, true);

  return new;
end;
$$;

create or replace function public.subscription_allows_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_subscriptions subscriptions
      where subscriptions.company_id = public.current_user_company_id_for_subscription()
        and (
          subscriptions.status = 'grandfathered'
          or (
            subscriptions.status = 'trialing'
            and subscriptions.trial_access_source = 'super_admin_invite'
            and subscriptions.trial_ends_at > statement_timestamp()
          )
          or (
            subscriptions.status = 'active'
            and (
              subscriptions.current_period_ends_at is null
              or subscriptions.current_period_ends_at > statement_timestamp()
            )
          )
        )
    );
$$;

create or replace function public.subscription_module_access(requested_module text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  subscription_record public.company_subscriptions%rowtype;
  resolved_access text;
begin
  if public.is_super_admin() then return 'full'; end if;

  select * into subscription_record
  from public.company_subscriptions
  where company_id = public.current_user_company_id_for_subscription()
  limit 1;

  if not found then return 'locked'; end if;

  if subscription_record.status = 'grandfathered'
    or (
      subscription_record.status = 'trialing'
      and subscription_record.trial_access_source = 'super_admin_invite'
      and subscription_record.trial_ends_at > statement_timestamp()
    ) then
    return 'full';
  end if;

  -- A trial without a Super Admin invitation cannot become a read-only
  -- workspace. It must complete payment before entering any module.
  if subscription_record.status = 'trialing' then return 'locked'; end if;

  if subscription_record.status = 'active'
    and (
      subscription_record.current_period_ends_at is null
      or subscription_record.current_period_ends_at > statement_timestamp()
    ) then
    select access_level into resolved_access
    from public.subscription_plan_entitlements
    where plan_key = subscription_record.plan_key
      and module_key = requested_module;
    return coalesce(resolved_access, 'locked');
  end if;

  if requested_module = 'assistant' then return 'locked'; end if;

  if exists (
    select 1
    from public.subscription_plan_entitlements
    where module_key = requested_module
  ) then
    return 'read_only';
  end if;

  return 'locked';
end;
$$;

create or replace function public.subscription_capability_access(requested_capability text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  subscription_record public.company_subscriptions%rowtype;
  resolved_access text;
begin
  if public.is_super_admin() then return 'full'; end if;

  select * into subscription_record
  from public.company_subscriptions
  where company_id = public.current_user_company_id_for_subscription()
  limit 1;

  if not found then return 'locked'; end if;

  if subscription_record.status = 'grandfathered'
    or (
      subscription_record.status = 'trialing'
      and subscription_record.trial_access_source = 'super_admin_invite'
      and subscription_record.trial_ends_at > statement_timestamp()
    ) then
    return 'full';
  end if;

  if subscription_record.status = 'trialing' then return 'locked'; end if;

  if subscription_record.status = 'active'
    and (
      subscription_record.current_period_ends_at is null
      or subscription_record.current_period_ends_at > statement_timestamp()
    ) then
    select access_level into resolved_access
    from public.subscription_plan_capabilities
    where plan_key = subscription_record.plan_key
      and capability_key = requested_capability;
    return coalesce(resolved_access, 'locked');
  end if;

  if exists (
    select 1
    from public.subscription_plan_capabilities
    where capability_key = requested_capability
  ) then
    return 'read_only';
  end if;

  return 'locked';
end;
$$;

create or replace function public.get_current_subscription_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  subscription_record record;
  effective_status text;
  is_invitation_trial boolean := false;
  module_access jsonb;
  capability_access jsonb;
  full_modules jsonb;
  seats_used integer := 0;
begin
  select
    company_subscriptions.*,
    subscription_plans.display_name,
    subscription_plans.price_paise as monthly_price_paise,
    subscription_plans.yearly_price_paise,
    subscription_plans.currency,
    subscription_plans.seat_limit
  into subscription_record
  from public.company_subscriptions
  left join public.subscription_plans
    on subscription_plans.plan_key = company_subscriptions.plan_key
  where company_subscriptions.company_id = public.current_user_company_id_for_subscription()
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'expired',
      'billing_period', 'monthly',
      'days_remaining', 0,
      'write_allowed', false,
      'is_invitation_trial', false,
      'is_admin', public.current_user_is_company_admin(),
      'enabled_modules', '[]'::jsonb,
      'module_access', '{}'::jsonb,
      'capability_access', '{}'::jsonb,
      'seat_limit', null,
      'seats_used', 0
    );
  end if;

  is_invitation_trial :=
    subscription_record.status = 'trialing'
    and subscription_record.trial_access_source = 'super_admin_invite'
    and subscription_record.trial_ends_at > statement_timestamp();

  effective_status := subscription_record.status;
  if subscription_record.status = 'trialing' and not is_invitation_trial then
    effective_status := 'expired';
  elsif subscription_record.status = 'active'
    and subscription_record.current_period_ends_at is not null
    and subscription_record.current_period_ends_at <= statement_timestamp() then
    effective_status := 'expired';
  end if;

  select coalesce(
    jsonb_object_agg(keys.module_key, public.subscription_module_access(keys.module_key)),
    '{}'::jsonb
  ) into module_access
  from (
    select distinct module_key from public.subscription_plan_entitlements
  ) keys;

  select coalesce(
    jsonb_object_agg(keys.capability_key, public.subscription_capability_access(keys.capability_key)),
    '{}'::jsonb
  ) into capability_access
  from (
    select distinct capability_key from public.subscription_plan_capabilities
  ) keys;

  select coalesce(jsonb_agg(keys.module_key order by keys.module_key), '[]'::jsonb)
  into full_modules
  from (
    select distinct module_key
    from public.subscription_plan_entitlements
    where public.subscription_module_access(module_key) = 'full'
  ) keys;

  select count(*)::integer into seats_used
  from public.users_profile
  where company_id = subscription_record.company_id
    and status in ('active', 'invited');

  return jsonb_build_object(
    'company_id', subscription_record.company_id,
    'plan_key', subscription_record.plan_key,
    'plan_name', subscription_record.display_name,
    'price_paise', case
      when subscription_record.billing_period = 'yearly'
        then subscription_record.yearly_price_paise
      else subscription_record.monthly_price_paise
    end,
    'monthly_price_paise', subscription_record.monthly_price_paise,
    'yearly_price_paise', subscription_record.yearly_price_paise,
    'currency', subscription_record.currency,
    'billing_period', subscription_record.billing_period,
    'status', effective_status,
    'trial_started_at', case
      when is_invitation_trial then subscription_record.trial_started_at
      else null
    end,
    'trial_ends_at', case
      when is_invitation_trial then subscription_record.trial_ends_at
      else null
    end,
    'days_remaining', case
      when is_invitation_trial then greatest(
        0,
        ceil(extract(epoch from (
          subscription_record.trial_ends_at - statement_timestamp()
        )) / 86400.0)::integer
      )
      else 0
    end,
    'current_period_ends_at', subscription_record.current_period_ends_at,
    'cancel_at_period_end', subscription_record.cancel_at_period_end,
    'write_allowed', effective_status in ('active', 'grandfathered') or is_invitation_trial,
    'is_invitation_trial', is_invitation_trial,
    'is_admin', public.current_user_is_company_admin(),
    'enabled_modules', full_modules,
    'module_access', module_access,
    'capability_access', capability_access,
    'seat_limit', subscription_record.seat_limit,
    'seats_used', seats_used
  );
end;
$$;

-- Permit initial self-service setup records only in the creating transaction;
-- all later tenant writes require an active paid plan or a verified invite trial.
create or replace function public.enforce_company_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  onboarding_company_id text := nullif(current_setting('app.onboarding_company_id', true), '');
begin
  if (
    auth.uid() is null
    and current_user in ('postgres', 'supabase_admin', 'service_role')
  ) or public.is_super_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if onboarding_company_id is not null
    and onboarding_company_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.company_subscriptions subscription
      where subscription.company_id = onboarding_company_id::uuid
        and (
          (
            subscription.status = 'trialing'
            and subscription.trial_access_source = 'super_admin_invite'
            and subscription.trial_ends_at > statement_timestamp()
          )
          or (
            subscription.status = 'expired'
            and subscription.plan_key is null
            and subscription.trial_started_at is null
            and subscription.trial_ends_at is null
            and subscription.trial_access_source = 'self_signup'
          )
        )
    ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.subscription_can_write_module(tg_argv[0]) then
    raise exception 'Your subscription does not include % access.', tg_argv[0]
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
