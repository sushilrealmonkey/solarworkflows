alter table public.company_subscriptions
  add column billing_period text not null default 'monthly'
    check (billing_period in ('monthly', 'yearly'));

create or replace function public.get_current_subscription_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with current_subscription as (
    select
      company_subscriptions.*,
      subscription_plans.display_name,
      subscription_plans.price_paise,
      subscription_plans.currency,
      case
        when company_subscriptions.status = 'trialing'
          and company_subscriptions.trial_ends_at <= statement_timestamp()
          then 'expired'
        when company_subscriptions.status = 'active'
          and company_subscriptions.current_period_ends_at is not null
          and company_subscriptions.current_period_ends_at <= statement_timestamp()
          then 'expired'
        else company_subscriptions.status
      end as effective_status
    from public.company_subscriptions
    left join public.subscription_plans
      on subscription_plans.plan_key = company_subscriptions.plan_key
    where company_subscriptions.company_id =
      public.current_user_company_id_for_subscription()
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', current_subscription.company_id,
        'plan_key', current_subscription.plan_key,
        'plan_name', current_subscription.display_name,
        'price_paise', current_subscription.price_paise,
        'currency', current_subscription.currency,
        'billing_period', current_subscription.billing_period,
        'status', current_subscription.effective_status,
        'trial_started_at', current_subscription.trial_started_at,
        'trial_ends_at', current_subscription.trial_ends_at,
        'days_remaining', case
          when current_subscription.effective_status = 'trialing'
            then greatest(
              0,
              ceil(extract(epoch from (
                current_subscription.trial_ends_at - statement_timestamp()
              )) / 86400.0)::integer
            )
          else 0
        end,
        'current_period_ends_at', current_subscription.current_period_ends_at,
        'cancel_at_period_end', current_subscription.cancel_at_period_end,
        'write_allowed', current_subscription.effective_status in (
          'trialing',
          'active',
          'grandfathered'
        ),
        'is_admin', public.current_user_is_company_admin(),
        'enabled_modules', case
          when current_subscription.effective_status in ('trialing', 'grandfathered')
            then (
              select coalesce(
                jsonb_agg(distinct modules.module_key order by modules.module_key),
                '[]'::jsonb
              )
              from public.modules
              where modules.is_active = true
            ) || '["assistant"]'::jsonb
          else (
            select coalesce(
              jsonb_agg(
                subscription_plan_entitlements.module_key
                order by subscription_plan_entitlements.module_key
              ),
              '[]'::jsonb
            )
            from public.subscription_plan_entitlements
            where subscription_plan_entitlements.plan_key =
              current_subscription.plan_key
          )
        end
      )
      from current_subscription
    ),
    jsonb_build_object(
      'status', 'expired',
      'billing_period', 'monthly',
      'days_remaining', 0,
      'write_allowed', false,
      'is_admin', public.current_user_is_company_admin(),
      'enabled_modules', '[]'::jsonb
    )
  );
$$;

grant execute on function public.get_current_subscription_access()
to authenticated;

notify pgrst, 'reload schema';
