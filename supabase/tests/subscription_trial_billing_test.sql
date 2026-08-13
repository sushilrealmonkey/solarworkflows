-- Read-only subscription foundation checks.

do $$
declare
  starter_price integer;
  starter_yearly_price integer;
  premium_price integer;
  premium_yearly_price integer;
  starter_seat_limit integer;
  trial_trigger_exists boolean;
  pro_trial_trigger_exists boolean;
  access_function regprocedure :=
    'public.get_current_subscription_access()'::regprocedure;
begin
  select price_paise, yearly_price_paise, seat_limit
  into starter_price, starter_yearly_price, starter_seat_limit
  from public.subscription_plans where plan_key = 'starter';
  select price_paise, yearly_price_paise
  into premium_price, premium_yearly_price
  from public.subscription_plans where plan_key = 'premium';

  if starter_price <> 89900 or starter_yearly_price <> 988900 then
    raise exception 'Core pricing is incorrect';
  end if;
  if premium_price <> 149900 or premium_yearly_price <> 1648900 then
    raise exception 'Pro pricing is incorrect';
  end if;
  if starter_seat_limit <> 3 then
    raise exception 'Core must allow three occupied seats';
  end if;

  if exists (
    select 1
    from public.subscription_plan_entitlements
    where plan_key = 'starter'
      and module_key in ('b2b_sales', 'inventory', 'vendors', 'purchases', 'invoices')
      and access_level <> 'read_only'
  ) then
    raise exception 'Core Pro-history modules must be read-only';
  end if;

  if exists (
    select 1
    from public.subscription_plan_entitlements
    where plan_key = 'starter'
      and module_key in (
        'dashboard', 'customers', 'leads', 'site_surveys', 'product_master',
        'product_pricing', 'quotations', 'projects', 'payments', 'documents',
        'staff', 'settings'
      )
      and access_level <> 'full'
  ) then
    raise exception 'A Core operational module is not fully enabled';
  end if;

  if not exists (
    select 1 from public.subscription_plan_entitlements
    where plan_key = 'starter' and module_key = 'assistant' and access_level = 'locked'
  ) then
    raise exception 'Bizlee AI must be locked on Core';
  end if;

  if exists (
    select 1 from public.subscription_plan_entitlements
    where plan_key = 'premium' and access_level <> 'full'
  ) then
    raise exception 'Every Pro entitlement must be fully enabled';
  end if;

  if exists (
    select 1 from public.subscription_plan_capabilities
    where plan_key = 'starter' and access_level <> 'read_only'
  ) then
    raise exception 'Core split-module capabilities must be read-only';
  end if;

  select exists (
    select 1 from pg_trigger
    where tgname = 'create_company_trial_subscription'
      and not tgisinternal
  ) into trial_trigger_exists;
  if not trial_trigger_exists then
    raise exception 'New company trial trigger is missing';
  end if;

  select exists (
    select 1 from pg_trigger
    where tgname = 'assign_pro_plan_to_trial'
      and not tgisinternal
  ) into pro_trial_trigger_exists;
  if not pro_trial_trigger_exists then
    raise exception 'Trial subscriptions must be forced onto Pro';
  end if;

  if exists (
    select 1
    from public.company_subscriptions
    where status = 'trialing'
      and plan_key is distinct from 'premium'
  ) then
    raise exception 'Every trial tenant must have the Pro plan';
  end if;

  if position(
    'app.onboarding_company_id'
    in pg_get_functiondef(
      'public.create_company_trial_subscription()'::regprocedure
    )
  ) = 0 then
    raise exception 'Trial creation must mark the onboarding transaction';
  end if;

  if position(
    '''premium'''
    in pg_get_functiondef(
      'public.create_company_trial_subscription()'::regprocedure
    )
  ) = 0 then
    raise exception 'New company trials must start on Pro';
  end if;

  if not has_function_privilege('authenticated', access_function, 'execute') then
    raise exception 'Authenticated users must read subscription access';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.deactivate_staff_for_seat_limit(uuid)',
    'execute'
  ) then
    raise exception 'Company admins need the seat-reduction RPC';
  end if;

  if has_table_privilege('authenticated', 'public.company_subscriptions', 'update') then
    raise exception 'Authenticated clients must not update subscription state';
  end if;
end;
$$;
