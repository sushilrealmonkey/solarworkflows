-- New self-service EPC workspaces must select and pay for a plan after setup.
-- Companies created by a Super Admin remain eligible for the invite-only trial.
-- Existing tenant subscriptions are intentionally left unchanged.
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
      trial_ends_at
    )
    values (
      new.id,
      'premium',
      'trialing',
      statement_timestamp(),
      statement_timestamp() + interval '14 days'
    )
    on conflict (company_id) do nothing;
  else
    insert into public.company_subscriptions (
      company_id,
      plan_key,
      status,
      trial_started_at,
      trial_ends_at
    )
    values (new.id, null, 'expired', null, null)
    on conflict (company_id) do nothing;
  end if;

  -- Lets the workspace-creation transaction create its initial tenant records.
  perform set_config('app.onboarding_company_id', new.id::text, true);

  return new;
end;
$$;

-- Self-service workspaces start without a subscription, but their creation
-- transaction still needs to write its initial profile and company records.
-- All later writes remain subject to the normal subscription entitlement check.
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
    if tg_op = 'DELETE' then
      return old;
    end if;

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
            and subscription.trial_ends_at > statement_timestamp()
          )
          or (
            subscription.status = 'expired'
            and subscription.plan_key is null
            and subscription.trial_started_at is null
            and subscription.trial_ends_at is null
          )
        )
    ) then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if not public.subscription_can_write_module(tg_argv[0]) then
    raise exception 'Your subscription does not include % access.', tg_argv[0]
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
