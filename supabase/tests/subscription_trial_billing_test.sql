-- Read-only subscription foundation checks.

do $$
declare
  starter_price integer;
  premium_price integer;
  trial_trigger_exists boolean;
  access_function regprocedure :=
    'public.get_current_subscription_access()'::regprocedure;
begin
  select price_paise into starter_price
  from public.subscription_plans where plan_key = 'starter';
  select price_paise into premium_price
  from public.subscription_plans where plan_key = 'premium';

  if starter_price <> 89900 then
    raise exception 'Starter must cost 89900 paise';
  end if;
  if premium_price <> 149900 then
    raise exception 'Premium must cost 149900 paise';
  end if;

  if exists (
    select 1
    from public.subscription_plan_entitlements
    where plan_key = 'starter'
      and module_key in (
        'b2b_sales',
        'product_master',
        'inventory',
        'vendors',
        'purchases',
        'invoices',
        'payments',
        'assistant'
      )
  ) then
    raise exception 'Starter unexpectedly contains a Premium module';
  end if;

  if not exists (
    select 1
    from public.subscription_plan_entitlements
    where plan_key = 'starter' and module_key = 'quotations'
  ) then
    raise exception 'Starter must include unlimited quotation access';
  end if;

  select exists (
    select 1 from pg_trigger
    where tgname = 'create_company_trial_subscription'
      and not tgisinternal
  ) into trial_trigger_exists;
  if not trial_trigger_exists then
    raise exception 'New company trial trigger is missing';
  end if;

  if position(
    'app.onboarding_company_id'
    in pg_get_functiondef(
      'public.create_company_trial_subscription()'::regprocedure
    )
  ) = 0 then
    raise exception 'Trial creation must mark the onboarding transaction';
  end if;

  if not has_function_privilege('authenticated', access_function, 'execute') then
    raise exception 'Authenticated users must read subscription access';
  end if;

  if has_table_privilege('authenticated', 'public.company_subscriptions', 'update') then
    raise exception 'Authenticated clients must not update subscription state';
  end if;
end;
$$;
