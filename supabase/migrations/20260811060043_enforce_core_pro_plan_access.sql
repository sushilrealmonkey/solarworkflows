-- Bizlee Core / Pro plan catalogue, read-only history, and server-side enforcement.

alter table public.subscription_plans
  add column yearly_price_paise integer check (yearly_price_paise > 0),
  add column seat_limit integer check (seat_limit is null or seat_limit > 0);

alter table public.subscription_plan_entitlements
  add column access_level text not null default 'full'
    check (access_level in ('full', 'read_only', 'locked'));

update public.subscription_plans
set
  display_name = case plan_key
    when 'starter' then 'Bizlee Core'
    when 'premium' then 'Bizlee Pro'
  end,
  price_paise = case plan_key
    when 'starter' then 99900
    when 'premium' then 149900
  end,
  yearly_price_paise = case plan_key
    when 'starter' then 1098900
    when 'premium' then 1648900
  end,
  seat_limit = case plan_key when 'starter' then 3 else null end,
  updated_at = now()
where plan_key in ('starter', 'premium');

insert into public.subscription_plan_entitlements (plan_key, module_key, access_level)
values
  ('starter', 'dashboard', 'full'),
  ('starter', 'customers', 'full'),
  ('starter', 'leads', 'full'),
  ('starter', 'site_surveys', 'full'),
  ('starter', 'product_master', 'full'),
  ('starter', 'product_pricing', 'full'),
  ('starter', 'quotations', 'full'),
  ('starter', 'projects', 'full'),
  ('starter', 'payments', 'full'),
  ('starter', 'documents', 'full'),
  ('starter', 'staff', 'full'),
  ('starter', 'settings', 'full'),
  ('starter', 'b2b_sales', 'read_only'),
  ('starter', 'inventory', 'read_only'),
  ('starter', 'vendors', 'read_only'),
  ('starter', 'purchases', 'read_only'),
  ('starter', 'invoices', 'read_only'),
  ('starter', 'assistant', 'locked'),
  ('premium', 'dashboard', 'full'),
  ('premium', 'assistant', 'full'),
  ('premium', 'customers', 'full'),
  ('premium', 'leads', 'full'),
  ('premium', 'site_surveys', 'full'),
  ('premium', 'product_master', 'full'),
  ('premium', 'product_pricing', 'full'),
  ('premium', 'quotations', 'full'),
  ('premium', 'projects', 'full'),
  ('premium', 'payments', 'full'),
  ('premium', 'documents', 'full'),
  ('premium', 'staff', 'full'),
  ('premium', 'settings', 'full'),
  ('premium', 'b2b_sales', 'full'),
  ('premium', 'inventory', 'full'),
  ('premium', 'vendors', 'full'),
  ('premium', 'purchases', 'full'),
  ('premium', 'invoices', 'full')
on conflict (plan_key, module_key) do update
set access_level = excluded.access_level;

create table public.subscription_plan_capabilities (
  plan_key text not null references public.subscription_plans(plan_key) on delete cascade,
  capability_key text not null,
  access_level text not null check (access_level in ('full', 'read_only', 'locked')),
  primary key (plan_key, capability_key)
);

insert into public.subscription_plan_capabilities (plan_key, capability_key, access_level)
values
  ('starter', 'customers.b2b_direct', 'read_only'),
  ('starter', 'payments.commercial', 'read_only'),
  ('starter', 'projects.inventory_operations', 'read_only'),
  ('starter', 'quotations.inventory_reservations', 'read_only'),
  ('starter', 'documents.pro_sources', 'read_only'),
  ('premium', 'customers.b2b_direct', 'full'),
  ('premium', 'payments.commercial', 'full'),
  ('premium', 'projects.inventory_operations', 'full'),
  ('premium', 'quotations.inventory_reservations', 'full'),
  ('premium', 'documents.pro_sources', 'full');

alter table public.subscription_plan_capabilities enable row level security;
revoke all on public.subscription_plan_capabilities from public, anon, authenticated;

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
      and subscription_record.trial_ends_at > statement_timestamp()
    ) then
    return 'full';
  end if;

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
    select 1 from public.subscription_plan_entitlements
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
      and subscription_record.trial_ends_at > statement_timestamp()
    ) then
    return 'full';
  end if;

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
    select 1 from public.subscription_plan_capabilities
    where capability_key = requested_capability
  ) then
    return 'read_only';
  end if;

  return 'locked';
end;
$$;

create or replace function public.subscription_has_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.subscription_module_access(requested_module) in ('full', 'read_only');
$$;

create or replace function public.subscription_can_write_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.subscription_allows_write()
    and public.subscription_module_access(requested_module) = 'full';
$$;

create or replace function public.subscription_can_write_capability(requested_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.subscription_allows_write()
    and public.subscription_capability_access(requested_capability) = 'full';
$$;

-- Keep role permission and plan permission as separate, intersecting boundaries.
create or replace function public.user_has_role_permission(module text, action text)
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
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where users_profile.auth_user_id = auth.uid()
        and users_profile.status = 'active'
        and roles.organization_id = users_profile.organization_id
        and modules.module_key = $1
        and permissions.action_key = $2
        and modules.is_active = true
    );
$$;

create or replace function public.user_has_permission(module text, action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or (
      public.user_has_role_permission($1, $2)
      and case
        when $2 = 'view'
          then public.subscription_module_access($1) in ('full', 'read_only')
        else public.subscription_can_write_module($1)
      end
    );
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
      'is_admin', public.current_user_is_company_admin(),
      'enabled_modules', '[]'::jsonb,
      'module_access', '{}'::jsonb,
      'capability_access', '{}'::jsonb,
      'seat_limit', null,
      'seats_used', 0
    );
  end if;

  effective_status := subscription_record.status;
  if subscription_record.status = 'trialing'
    and subscription_record.trial_ends_at <= statement_timestamp() then
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
    'trial_started_at', subscription_record.trial_started_at,
    'trial_ends_at', subscription_record.trial_ends_at,
    'days_remaining', case
      when effective_status = 'trialing' then greatest(
        0,
        ceil(extract(epoch from (
          subscription_record.trial_ends_at - statement_timestamp()
        )) / 86400.0)::integer
      )
      else 0
    end,
    'current_period_ends_at', subscription_record.current_period_ends_at,
    'cancel_at_period_end', subscription_record.cancel_at_period_end,
    'write_allowed', effective_status in ('trialing', 'active', 'grandfathered'),
    'is_admin', public.current_user_is_company_admin(),
    'enabled_modules', full_modules,
    'module_access', module_access,
    'capability_access', capability_access,
    'seat_limit', subscription_record.seat_limit,
    'seats_used', seats_used
  );
end;
$$;

create or replace function public.enforce_company_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  onboarding_company_id text := nullif(current_setting('app.onboarding_company_id', true), '');
begin
  if (auth.uid() is null and current_user in ('postgres', 'service_role', 'supabase_admin'))
    or public.is_super_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if onboarding_company_id is not null
    and onboarding_company_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.company_subscriptions
      where company_id = onboarding_company_id::uuid
        and status = 'trialing'
        and trial_ends_at > statement_timestamp()
    ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.subscription_can_write_module(tg_argv[0]) then
    raise exception 'This action requires an active Bizlee plan with access to the module.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_customer_plan_capability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requires_pro boolean;
begin
  if tg_op = 'INSERT' then
    requires_pro := new.customer_segment = 'b2b_direct';
  elsif tg_op = 'UPDATE' then
    requires_pro := old.customer_segment = 'b2b_direct' or new.customer_segment = 'b2b_direct';
  else
    requires_pro := old.customer_segment = 'b2b_direct';
  end if;

  if requires_pro
    and auth.uid() is not null
    and not public.is_super_admin()
    and not public.subscription_can_write_capability('customers.b2b_direct') then
    raise exception 'Business customers require Bizlee Pro.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_customer_plan_capability on public.customers;
create trigger enforce_customer_plan_capability
before insert or update or delete on public.customers
for each row execute function public.enforce_customer_plan_capability();

create or replace function public.enforce_payment_plan_capability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requires_pro boolean;
begin
  if tg_op = 'INSERT' then
    requires_pro := new.invoice_id is not null or new.proforma_invoice_id is not null or new.b2b_sale_id is not null;
  elsif tg_op = 'UPDATE' then
    requires_pro :=
      old.invoice_id is not null or old.proforma_invoice_id is not null or old.b2b_sale_id is not null
      or new.invoice_id is not null or new.proforma_invoice_id is not null or new.b2b_sale_id is not null;
  else
    requires_pro := old.invoice_id is not null or old.proforma_invoice_id is not null or old.b2b_sale_id is not null;
  end if;

  if requires_pro and auth.uid() is not null
    and not public.is_super_admin()
    and not public.subscription_can_write_capability('payments.commercial') then
    raise exception 'Invoice-linked payments require Bizlee Pro.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_payment_plan_capability on public.payments;
create trigger enforce_payment_plan_capability
before insert or update or delete on public.payments
for each row execute function public.enforce_payment_plan_capability();

create or replace function public.enforce_document_plan_capability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requires_pro boolean;
begin
  if tg_op = 'INSERT' then
    requires_pro := new.invoice_id is not null or new.proforma_invoice_id is not null or new.purchase_order_id is not null;
  elsif tg_op = 'UPDATE' then
    requires_pro :=
      old.invoice_id is not null or old.proforma_invoice_id is not null or old.purchase_order_id is not null
      or new.invoice_id is not null or new.proforma_invoice_id is not null or new.purchase_order_id is not null;
  else
    requires_pro := old.invoice_id is not null or old.proforma_invoice_id is not null or old.purchase_order_id is not null;
  end if;

  if requires_pro and auth.uid() is not null
    and not public.is_super_admin()
    and not public.subscription_can_write_capability('documents.pro_sources') then
    raise exception 'Commercial document actions require Bizlee Pro.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_document_plan_capability on public.documents;
create trigger enforce_document_plan_capability
before insert or update or delete on public.documents
for each row execute function public.enforce_document_plan_capability();

-- Apply plan write enforcement to supporting records omitted by the original migration.
do $triggers$
declare
  item record;
  trigger_name text;
begin
  for item in
    select * from (
      values
        ('bom_templates', 'product_master'),
        ('bom_template_lines', 'product_master'),
        ('product_prices', 'product_pricing'),
        ('product_price_history', 'product_pricing'),
        ('inventory_batches', 'inventory')
    ) as mapped(table_name, module_key)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      trigger_name := 'enforce_subscription_write_' || item.table_name;
      execute format('drop trigger if exists %I on public.%I', trigger_name, item.table_name);
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

create or replace function public.enforce_subscription_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_seats integer;
  occupied_seats integer;
begin
  if new.company_id is null or new.status not in ('active', 'invited') then return new; end if;

  select subscription_plans.seat_limit into allowed_seats
  from public.company_subscriptions
  join public.subscription_plans
    on subscription_plans.plan_key = company_subscriptions.plan_key
  where company_subscriptions.company_id = new.company_id
  for update of company_subscriptions;

  if allowed_seats is null then return new; end if;

  select count(*)::integer into occupied_seats
  from public.users_profile
  where company_id = new.company_id
    and status in ('active', 'invited')
    and id is distinct from new.id;

  if occupied_seats >= allowed_seats then
    raise exception 'Bizlee Core includes % total users. Deactivate a user or upgrade to Bizlee Pro.', allowed_seats
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_subscription_seat_limit on public.users_profile;
create trigger enforce_subscription_seat_limit
before insert or update of company_id, status on public.users_profile
for each row execute function public.enforce_subscription_seat_limit();

create or replace function public.enforce_core_activation_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_seats integer;
  occupied_seats integer;
begin
  select seat_limit into allowed_seats
  from public.subscription_plans where plan_key = new.plan_key;
  if allowed_seats is null then return new; end if;

  select count(*)::integer into occupied_seats
  from public.users_profile
  where company_id = new.company_id and status in ('active', 'invited');

  if occupied_seats > allowed_seats then
    raise exception 'Core activation requires % or fewer occupied seats; this workspace has %.', allowed_seats, occupied_seats
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_core_activation_seat_limit on public.company_subscriptions;
create trigger enforce_core_activation_seat_limit
before insert or update of plan_key, status on public.company_subscriptions
for each row execute function public.enforce_core_activation_seat_limit();

create or replace function public.deactivate_staff_for_seat_limit(target_profile_id uuid)
returns public.users_profile
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_for_user uuid := public.current_user_company_id_for_subscription();
  target_profile public.users_profile%rowtype;
begin
  if auth.uid() is null or not public.current_user_is_company_admin() then
    raise exception 'Company admin access required.' using errcode = '42501';
  end if;

  select * into target_profile
  from public.users_profile
  where id = target_profile_id and company_id = company_id_for_user
  for update;

  if not found then raise exception 'Staff profile not found.' using errcode = 'P0002'; end if;
  if target_profile.auth_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.' using errcode = '42501';
  end if;

  update public.users_profile set status = 'inactive', updated_at = now()
  where id = target_profile.id returning * into target_profile;

  if target_profile.auth_user_id is not null then
    update public.profiles set status = 'inactive', updated_at = now()
    where id = target_profile.auth_user_id;
    delete from auth.sessions where user_id = target_profile.auth_user_id;
  end if;

  return target_profile;
end;
$$;

-- Core quotation acceptance must not create Pro inventory reservations.
create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
begin
  select * into quotation_record
  from public.quotations where id = target_quotation_id for update;
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;

  if not public.is_super_admin() and (
    quotation_record.organization_id <> public.current_user_organization_id()
    or not public.user_has_permission('quotations', 'update')
  ) then
    raise exception 'Missing permission to accept quotation' using errcode = '42501';
  end if;

  if quotation_record.lead_id is not null then
    select * into customer_record from public.convert_lead_to_customer(quotation_record.lead_id);
  end if;
  if quotation_record.customer_id is null and customer_record.id is null then
    raise exception 'Quotation needs a customer or lead before it can be accepted' using errcode = '23503';
  end if;

  update public.quotations
  set customer_id = coalesce(quotation_record.customer_id, customer_record.id),
      status = 'accepted',
      bom_status = 'locked',
      accepted_at = coalesce(accepted_at, now()),
      updated_at = now()
  where id = target_quotation_id returning * into quotation_record;

  if public.subscription_can_write_capability('quotations.inventory_reservations') then
    perform public.sync_inventory_reservations_for_quotation(quotation_record.id);
  end if;
  perform public.create_project_from_quotation(quotation_record.id);

  select * into quotation_record from public.quotations where id = target_quotation_id;
  return quotation_record;
end;
$$;

revoke execute on function public.subscription_module_access(text) from public, anon;
revoke execute on function public.subscription_capability_access(text) from public, anon;
revoke execute on function public.subscription_can_write_module(text) from public, anon;
revoke execute on function public.subscription_can_write_capability(text) from public, anon;
revoke execute on function public.user_has_role_permission(text, text) from public, anon;
revoke execute on function public.deactivate_staff_for_seat_limit(uuid) from public, anon;
revoke execute on function public.enforce_customer_plan_capability() from public, anon, authenticated;
revoke execute on function public.enforce_payment_plan_capability() from public, anon, authenticated;
revoke execute on function public.enforce_document_plan_capability() from public, anon, authenticated;
revoke execute on function public.enforce_subscription_seat_limit() from public, anon, authenticated;
revoke execute on function public.enforce_core_activation_seat_limit() from public, anon, authenticated;
revoke execute on function public.sync_inventory_reservations_for_quotation(uuid) from authenticated;
revoke execute on function public.release_inventory_reservations_for_quotation(uuid, text) from authenticated;

grant execute on function public.subscription_module_access(text) to authenticated;
grant execute on function public.subscription_capability_access(text) to authenticated;
grant execute on function public.subscription_can_write_module(text) to authenticated;
grant execute on function public.subscription_can_write_capability(text) to authenticated;
grant execute on function public.user_has_role_permission(text, text) to authenticated;
grant execute on function public.get_current_subscription_access() to authenticated;
grant execute on function public.deactivate_staff_for_seat_limit(uuid) to authenticated;
grant execute on function public.accept_quotation(uuid) to authenticated;

-- Prevent Core users from bypassing the UI to download Pro-source documents.
drop policy if exists "Organization users can read organization document files"
on storage.objects;
create policy "Organization users can read organization document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'view')
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('site_surveys', 'view')
    or public.user_has_permission('site_surveys', 'update')
  )
  and (
    public.is_super_admin()
    or public.subscription_can_write_capability('documents.pro_sources')
    or not exists (
      select 1
      from public.documents
      where documents.file_path = storage.objects.name
        and (
          documents.invoice_id is not null
          or documents.proforma_invoice_id is not null
          or documents.purchase_order_id is not null
        )
    )
  )
);

notify pgrst, 'reload schema';
