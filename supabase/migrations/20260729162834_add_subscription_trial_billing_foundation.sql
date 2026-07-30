-- Bizlee trial, plan entitlements, subscription access, and reminder state.

create table public.subscription_plans (
  plan_key text primary key check (plan_key in ('starter', 'premium')),
  display_name text not null,
  price_paise integer not null check (price_paise > 0),
  currency text not null default 'INR',
  billing_period text not null default 'monthly' check (billing_period = 'monthly'),
  razorpay_plan_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscription_plan_entitlements (
  plan_key text not null references public.subscription_plans(plan_key) on delete cascade,
  module_key text not null,
  primary key (plan_key, module_key)
);

create table public.company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  plan_key text references public.subscription_plans(plan_key),
  status text not null check (
    status in ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'suspended', 'grandfathered')
  ),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  razorpay_customer_id text,
  razorpay_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'trialing'
    or (trial_started_at is not null and trial_ends_at is not null)
  )
);

create table public.subscription_notification_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null check (milestone in ('day_7', 'day_3', 'day_1', 'expired')),
  delivered_at timestamptz not null default now(),
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, user_id, milestone)
);

create table public.subscription_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create trigger set_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();

create trigger set_company_subscriptions_updated_at
before update on public.company_subscriptions
for each row execute function public.set_updated_at();

insert into public.subscription_plans (
  plan_key,
  display_name,
  price_paise,
  currency,
  billing_period
)
values
  ('starter', 'Bizlee Starter', 89900, 'INR', 'monthly'),
  ('premium', 'Bizlee Premium', 149900, 'INR', 'monthly')
on conflict (plan_key) do update
set
  display_name = excluded.display_name,
  price_paise = excluded.price_paise,
  currency = excluded.currency,
  billing_period = excluded.billing_period,
  is_active = true;

insert into public.subscription_plan_entitlements (plan_key, module_key)
values
  ('starter', 'dashboard'),
  ('starter', 'customers'),
  ('starter', 'leads'),
  ('starter', 'site_surveys'),
  ('starter', 'quotations'),
  ('starter', 'projects'),
  ('starter', 'documents'),
  ('starter', 'staff'),
  ('starter', 'settings'),
  ('premium', 'dashboard'),
  ('premium', 'assistant'),
  ('premium', 'customers'),
  ('premium', 'leads'),
  ('premium', 'site_surveys'),
  ('premium', 'quotations'),
  ('premium', 'projects'),
  ('premium', 'documents'),
  ('premium', 'b2b_sales'),
  ('premium', 'product_master'),
  ('premium', 'product_pricing'),
  ('premium', 'inventory'),
  ('premium', 'vendors'),
  ('premium', 'purchases'),
  ('premium', 'invoices'),
  ('premium', 'payments'),
  ('premium', 'staff'),
  ('premium', 'reports'),
  ('premium', 'settings')
on conflict do nothing;

-- Preserve every tenant that existed before this migration.
insert into public.company_subscriptions (company_id, plan_key, status)
select companies.id, 'premium', 'grandfathered'
from public.companies
on conflict (company_id) do nothing;

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

  return new;
end;
$$;

create trigger create_company_trial_subscription
after insert on public.companies
for each row execute function public.create_company_trial_subscription();

create or replace function public.current_user_company_id_for_subscription()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users_profile.company_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;
$$;

create or replace function public.current_user_is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.users_profile
      join public.user_roles on (
        user_roles.user_profile_id = users_profile.id
        or user_roles.user_id = users_profile.auth_user_id
      )
      join public.roles on roles.id = user_roles.role_id
      where users_profile.auth_user_id = auth.uid()
        and users_profile.status = 'active'
        and roles.organization_id = users_profile.organization_id
        and roles.role_key = 'admin'
    );
$$;

create or replace function public.subscription_has_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_subscriptions
      where company_subscriptions.company_id = public.current_user_company_id_for_subscription()
        and (
          company_subscriptions.status in ('trialing', 'grandfathered')
          or exists (
            select 1
            from public.subscription_plan_entitlements
            where subscription_plan_entitlements.plan_key = company_subscriptions.plan_key
              and subscription_plan_entitlements.module_key = requested_module
          )
        )
    );
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
      from public.company_subscriptions
      where company_subscriptions.company_id = public.current_user_company_id_for_subscription()
        and (
          company_subscriptions.status = 'grandfathered'
          or (
            company_subscriptions.status = 'trialing'
            and company_subscriptions.trial_ends_at > statement_timestamp()
          )
          or (
            company_subscriptions.status = 'active'
            and (
              company_subscriptions.current_period_ends_at is null
              or company_subscriptions.current_period_ends_at > statement_timestamp()
            )
          )
        )
    );
$$;

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
    where company_subscriptions.company_id = public.current_user_company_id_for_subscription()
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
              select coalesce(jsonb_agg(distinct modules.module_key order by modules.module_key), '[]'::jsonb)
              from public.modules
              where modules.is_active = true
            ) || '["assistant"]'::jsonb
          else (
            select coalesce(jsonb_agg(subscription_plan_entitlements.module_key order by subscription_plan_entitlements.module_key), '[]'::jsonb)
            from public.subscription_plan_entitlements
            where subscription_plan_entitlements.plan_key = current_subscription.plan_key
          )
        end
      )
      from current_subscription
    ),
    jsonb_build_object(
      'status', 'expired',
      'days_remaining', 0,
      'write_allowed', false,
      'is_admin', public.current_user_is_company_admin(),
      'enabled_modules', '[]'::jsonb
    )
  );
$$;

-- Subscription access is an additional boundary; role permissions still apply.
create or replace function public.user_has_permission(module text, action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or (
      public.subscription_has_module($1)
      and ($2 = 'view' or public.subscription_allows_write())
      and exists (
        select 1
        from public.users_profile
        join public.user_roles on (
          user_roles.user_profile_id = users_profile.id
          or user_roles.user_id = users_profile.auth_user_id
        )
        join public.roles on roles.id = user_roles.role_id
        join public.role_permissions on role_permissions.role_id = roles.id
        join public.permissions on permissions.id = role_permissions.permission_id
        join public.modules on modules.id = permissions.module_id
        where users_profile.auth_user_id = auth.uid()
          and users_profile.status = 'active'
          and roles.organization_id = users_profile.organization_id
          and modules.module_key = $1
          and permissions.action_key = $2
          and modules.is_active = true
      )
    );
$$;

create or replace function public.dismiss_subscription_notification(
  notification_milestone text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if notification_milestone not in ('day_7', 'day_3', 'day_1') then
    raise exception 'This subscription notification cannot be dismissed'
      using errcode = '23514';
  end if;

  insert into public.subscription_notification_state (
    company_id,
    user_id,
    milestone,
    delivered_at,
    dismissed_at
  )
  values (
    public.current_user_company_id_for_subscription(),
    auth.uid(),
    notification_milestone,
    now(),
    now()
  )
  on conflict (company_id, user_id, milestone) do update
  set dismissed_at = excluded.dismissed_at;
end;
$$;

create or replace function public.enforce_company_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    auth.uid() is null
    and current_user in ('postgres', 'service_role', 'supabase_admin')
  )
    or public.is_super_admin() then
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

do $triggers$
declare
  item record;
  trigger_name text;
begin
  for item in
    select *
    from (
      values
        ('customers', 'customers'),
        ('leads', 'leads'),
        ('lead_followups', 'leads'),
        ('site_surveys', 'site_surveys'),
        ('quotations', 'quotations'),
        ('quotation_items', 'quotations'),
        ('quotation_payment_terms', 'quotations'),
        ('quotation_warranties', 'quotations'),
        ('quotation_bom_items', 'quotations'),
        ('projects', 'projects'),
        ('b2b_sales', 'b2b_sales'),
        ('b2b_sale_items', 'b2b_sales'),
        ('products', 'product_master'),
        ('product_categories', 'product_master'),
        ('inventory_items', 'inventory'),
        ('inventory_transactions', 'inventory'),
        ('inventory_reservations', 'inventory'),
        ('vendors', 'vendors'),
        ('purchase_orders', 'purchases'),
        ('purchase_order_items', 'purchases'),
        ('proforma_invoices', 'invoices'),
        ('proforma_invoice_items', 'invoices'),
        ('invoices', 'invoices'),
        ('invoice_items', 'invoices'),
        ('payments', 'payments'),
        ('documents', 'documents'),
        ('organization_documents', 'documents')
    ) as mapped(table_name, module_key)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      trigger_name := 'enforce_subscription_write_' || item.table_name;
      execute format(
        'drop trigger if exists %I on public.%I',
        trigger_name,
        item.table_name
      );
      execute format(
        'create trigger %I before insert or update or delete on public.%I
         for each row execute function public.enforce_company_subscription_write(%L)',
        trigger_name,
        item.table_name,
        item.module_key
      );
    end if;
  end loop;
end;
$triggers$;

alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_entitlements enable row level security;
alter table public.company_subscriptions enable row level security;
alter table public.subscription_notification_state enable row level security;
alter table public.subscription_webhook_events enable row level security;

create policy "Authenticated users can view active subscription plans"
on public.subscription_plans for select to authenticated
using (is_active = true);

create policy "Authenticated users can view plan entitlements"
on public.subscription_plan_entitlements for select to authenticated
using (true);

create policy "Tenant users can view own company subscription"
on public.company_subscriptions for select to authenticated
using (
  public.is_super_admin()
  or company_id = public.current_user_company_id_for_subscription()
);

create policy "Tenant users can view own subscription notification state"
on public.subscription_notification_state for select to authenticated
using (
  company_id = public.current_user_company_id_for_subscription()
  and user_id = auth.uid()
);

create policy "Tenant users can insert own subscription notification state"
on public.subscription_notification_state for insert to authenticated
with check (
  company_id = public.current_user_company_id_for_subscription()
  and user_id = auth.uid()
);

create policy "Tenant users can update own subscription notification state"
on public.subscription_notification_state for update to authenticated
using (
  company_id = public.current_user_company_id_for_subscription()
  and user_id = auth.uid()
)
with check (
  company_id = public.current_user_company_id_for_subscription()
  and user_id = auth.uid()
);

grant select on public.subscription_plans to authenticated;
grant select on public.subscription_plan_entitlements to authenticated;
grant select on public.company_subscriptions to authenticated;
grant select, insert, update on public.subscription_notification_state to authenticated;

revoke all on public.subscription_webhook_events from anon, authenticated;
revoke all on public.company_subscriptions from anon;

revoke execute on function public.create_company_trial_subscription() from public, anon, authenticated;
revoke execute on function public.enforce_company_subscription_write() from public, anon, authenticated;
grant execute on function public.current_user_company_id_for_subscription() to authenticated;
grant execute on function public.current_user_is_company_admin() to authenticated;
grant execute on function public.subscription_has_module(text) to authenticated;
grant execute on function public.subscription_allows_write() to authenticated;
grant execute on function public.get_current_subscription_access() to authenticated;
grant execute on function public.user_has_permission(text, text) to authenticated;
grant execute on function public.dismiss_subscription_notification(text) to authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'process-bizlee-trial-reminders-daily';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  if exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_reminder_project_url'
  ) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'trial_reminder_worker_secret'
  ) then
    perform cron.schedule(
      'process-bizlee-trial-reminders-daily',
      '30 3 * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'trial_reminder_project_url'
          ) || '/functions/v1/process-trial-reminders',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'trial_reminder_worker_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice
      'Trial reminder Cron was not scheduled because its Vault secrets are not provisioned.';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
