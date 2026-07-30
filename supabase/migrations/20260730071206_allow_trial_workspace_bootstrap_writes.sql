-- Let self-service onboarding finish after the company insert creates its
-- trial, before the new admin profile is available to tenant lookup helpers.
-- The transaction-local marker is set only by the company trial trigger.

create or replace function public.create_company_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

  perform set_config('app.onboarding_company_id', new.id::text, true);

  return new;
end;
$$;

create or replace function public.enforce_company_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  onboarding_company_id text :=
    nullif(current_setting('app.onboarding_company_id', true), '');
begin
  if (
    auth.uid() is null
    and current_user in ('postgres', 'service_role', 'supabase_admin')
  )
    or public.is_super_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- During self-service onboarding the authenticated user does not have a
  -- users_profile row yet. Permit only the transaction whose newly inserted
  -- company already owns a live trial subscription.
  if onboarding_company_id is not null
    and onboarding_company_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.company_subscriptions
      where company_subscriptions.company_id = onboarding_company_id::uuid
        and company_subscriptions.status = 'trialing'
        and company_subscriptions.trial_ends_at > statement_timestamp()
    ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.subscription_allows_write() then
    raise exception 'Your Bizlee workspace is read-only. Activate a plan to continue.'
      using errcode = '42501';
  end if;

  if not public.subscription_has_module(tg_argv[0]) then
    raise exception 'This module requires Bizlee Premium.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.create_company_trial_subscription()
from public, anon, authenticated;

revoke execute on function public.enforce_company_subscription_write()
from public, anon, authenticated;

notify pgrst, 'reload schema';
