-- Backend platform staff can review EPC company information, but receive no
-- direct tenant-table access and no mutation capability. The two RPCs below
-- are the only cross-tenant read surface needed by the Companies screens.
create or replace function public.can_view_epc_companies()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.is_super_admin()
    or public.has_platform_role('backend_staff');
$$;

revoke all on function public.can_view_epc_companies() from public;
grant execute on function public.can_view_epc_companies() to authenticated;

create or replace function public.platform_epc_company_directory()
returns table (company jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.can_view_epc_companies() then
    raise exception 'Only super admins and active platform staff can view EPC companies'
      using errcode = '42501';
  end if;

  return query
  with primary_admins as (
    select distinct on (users_profile.organization_id)
      users_profile.organization_id,
      users_profile.id,
      users_profile.full_name,
      users_profile.email,
      users_profile.phone,
      users_profile.status,
      users_profile.auth_user_id,
      users_profile.invited_at,
      users_profile.onboarded_at,
      users_profile.last_login_at,
      users_profile.created_at
    from public.users_profile
    where coalesce(users_profile.is_super_admin, false) = false
      and users_profile.organization_id is not null
    order by users_profile.organization_id, users_profile.created_at asc nulls last, users_profile.id
  ),
  user_counts as (
    select users_profile.organization_id, count(*)::integer as user_count
    from public.users_profile
    where coalesce(users_profile.is_super_admin, false) = false
      and users_profile.organization_id is not null
    group by users_profile.organization_id
  ),
  role_counts as (
    select roles.organization_id, count(*)::integer as role_count
    from public.roles
    where roles.organization_id is not null
    group by roles.organization_id
  )
  select jsonb_build_object(
    'id', organizations.id,
    'company_id', organizations.company_id,
    'is_in_house', coalesce(companies.is_in_house, false),
    'name', organizations.name,
    'slug', organizations.slug,
    'subdomain', organizations.subdomain,
    'custom_domain', organizations.custom_domain,
    'status', organizations.status,
    'created_at', organizations.created_at,
    'updated_at', organizations.updated_at,
    'settings', case
      when organization_settings.organization_id is null then null
      else jsonb_build_object(
        'company_name', organization_settings.company_name,
        'company_details', organization_settings.company_details,
        'contact_email', organization_settings.contact_email,
        'contact_phone', organization_settings.contact_phone,
        'contact_person', organization_settings.contact_person,
        'gst_number', organization_settings.gst_number,
        'address', organization_settings.address,
        'company_logo_url', organization_settings.company_logo_url,
        'timezone', organization_settings.timezone,
        'currency', organization_settings.currency
      )
    end,
    'admin', case
      when primary_admins.id is null then null
      else jsonb_build_object(
        'id', primary_admins.id,
        'full_name', primary_admins.full_name,
        'email', primary_admins.email,
        'phone', primary_admins.phone,
        'status', primary_admins.status,
        'auth_user_id', primary_admins.auth_user_id,
        'invited_at', primary_admins.invited_at,
        'onboarded_at', primary_admins.onboarded_at,
        'last_login_at', primary_admins.last_login_at,
        'created_at', primary_admins.created_at
      )
    end,
    'subscription', case
      when company_subscriptions.company_id is null then null
      else jsonb_build_object(
        'company_id', company_subscriptions.company_id,
        'plan_key', company_subscriptions.plan_key,
        'plan_name', subscription_plans.display_name,
        'status', company_subscriptions.status,
        'billing_period', company_subscriptions.billing_period,
        'trial_started_at', company_subscriptions.trial_started_at,
        'trial_ends_at', company_subscriptions.trial_ends_at,
        'current_period_started_at', company_subscriptions.current_period_started_at,
        'current_period_ends_at', company_subscriptions.current_period_ends_at,
        'cancel_at_period_end', coalesce(company_subscriptions.cancel_at_period_end, false)
      )
    end,
    'billing_status', case
      when company_subscriptions.company_id is null then 'free_trial_ended'
      when company_subscriptions.status = 'trialing'
        and company_subscriptions.trial_ends_at > statement_timestamp()
        then 'free_trial_active'
      when company_subscriptions.status in ('active', 'past_due', 'cancelled', 'grandfathered')
        then 'subscribed'
      else 'free_trial_ended'
    end,
    'role_count', coalesce(role_counts.role_count, 0),
    'user_count', coalesce(user_counts.user_count, 0)
  )
  from public.organizations
  left join public.companies
    on companies.id = organizations.company_id
  left join public.organization_settings
    on organization_settings.organization_id = organizations.id
  left join primary_admins
    on primary_admins.organization_id = organizations.id
  left join user_counts
    on user_counts.organization_id = organizations.id
  left join role_counts
    on role_counts.organization_id = organizations.id
  left join public.company_subscriptions
    on company_subscriptions.company_id = organizations.company_id
  left join public.subscription_plans
    on subscription_plans.plan_key = company_subscriptions.plan_key
      and subscription_plans.is_active = true
  order by organizations.created_at desc nulls last, organizations.id;
end;
$$;

revoke all on function public.platform_epc_company_directory() from public, anon;
grant execute on function public.platform_epc_company_directory() to authenticated;

create or replace function public.platform_epc_company_detail(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  directory_company jsonb;
  tenant_users jsonb;
  activity_summary jsonb;
  recent_activity jsonb;
begin
  if not public.can_view_epc_companies() then
    raise exception 'Only super admins and active platform staff can view EPC companies'
      using errcode = '42501';
  end if;

  select directory.company
  into directory_company
  from public.platform_epc_company_directory() as directory(company)
  where (directory.company ->> 'id')::uuid = p_organization_id;

  if directory_company is null then
    raise exception 'EPC company not found' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', users_profile.id,
        'full_name', users_profile.full_name,
        'email', users_profile.email,
        'phone', users_profile.phone,
        'status', users_profile.status,
        'auth_user_id', users_profile.auth_user_id,
        'invited_at', users_profile.invited_at,
        'onboarded_at', users_profile.onboarded_at,
        'last_login_at', users_profile.last_login_at,
        'created_at', users_profile.created_at,
        'roles', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', roles.id,
              'role_key', roles.role_key,
              'role_name', roles.role_name
            )
            order by roles.role_name nulls last, roles.role_key nulls last, roles.id
          )
          from public.user_roles
          join public.roles
            on roles.id = user_roles.role_id
          where roles.organization_id = p_organization_id
            and (
              user_roles.user_profile_id = users_profile.id
              or (
                users_profile.auth_user_id is not null
                and user_roles.user_id = users_profile.auth_user_id
              )
            )
        ), '[]'::jsonb)
      )
      order by users_profile.created_at asc nulls last, users_profile.id
    ),
    '[]'::jsonb
  )
  into tenant_users
  from public.users_profile
  where users_profile.organization_id = p_organization_id
    and coalesce(users_profile.is_super_admin, false) = false;

  select jsonb_build_object(
    'total_customers', (select count(*) from public.customers where organization_id = p_organization_id),
    'total_leads', (select count(*) from public.leads where organization_id = p_organization_id),
    'active_projects', (
      select count(*) from public.projects
      where organization_id = p_organization_id
        and project_status not in ('installation_completed', 'commissioned', 'cancelled')
    ),
    'completed_projects', (
      select count(*) from public.projects
      where organization_id = p_organization_id
        and project_status in ('installation_completed', 'commissioned')
    ),
    'pending_site_surveys', (
      select count(*) from public.site_surveys
      where organization_id = p_organization_id
        and survey_status in ('scheduled', 'in_progress', 'rescheduled')
    ),
    'quotations_sent', (
      select count(*) from public.quotations
      where organization_id = p_organization_id
        and status <> 'cancelled'
    ),
    'quotations_accepted', (
      select count(*) from public.quotations
      where organization_id = p_organization_id
        and status in ('accepted', 'loan_approved')
    ),
    'total_project_value', coalesce((
      select sum(total_project_amount) from public.project_payment_summary
      where organization_id = p_organization_id
    ), 0),
    'total_received_amount', coalesce((
      select sum(amount_received) from public.project_payment_summary
      where organization_id = p_organization_id
    ), 0),
    'total_balance_due', coalesce((
      select sum(balance_due) from public.project_payment_summary
      where organization_id = p_organization_id
    ), 0),
    'low_stock_items', (
      select count(*) from public.inventory_items
      where organization_id = p_organization_id
        and status = 'active'
        and current_stock <= minimum_stock
    ),
    'pending_documents', public.count_pending_documents(p_organization_id)
  )
  into activity_summary;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', logs.id,
        'module', logs.module,
        'action', logs.action,
        'description', logs.description,
        'created_at', logs.created_at
      )
      order by logs.created_at desc nulls last, logs.id
    ),
    '[]'::jsonb
  )
  into recent_activity
  from (
    select id, module, action, description, created_at
    from public.activity_logs
    where organization_id = p_organization_id
    order by created_at desc nulls last, id
    limit 8
  ) as logs;

  return directory_company || jsonb_build_object(
    'tenant_users', tenant_users,
    'activity_summary', activity_summary,
    'recent_activity', recent_activity
  );
end;
$$;

revoke all on function public.platform_epc_company_detail(uuid) from public, anon;
grant execute on function public.platform_epc_company_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
