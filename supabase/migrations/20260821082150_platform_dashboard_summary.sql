-- Super-admin daily operations reporting. The function owns the aggregate
-- queries so the dashboard does not need to read tenant tables directly.
create or replace function public.platform_dashboard_summary(
  report_start date,
  report_end date,
  trial_window_days integer default 7
)
returns table (
  client_workspace_count bigint,
  active_client_workspace_count bigint,
  inactive_client_workspace_count bigint,
  in_house_account_count bigint,
  active_trial_count bigint,
  trials_ending_soon_count bigint,
  trial_ended_count bigint,
  subscribed_workspace_count bigint,
  subscription_risk_count bigint,
  pending_admin_setup_count bigint,
  active_admin_count bigint,
  total_client_users bigint,
  active_client_users_7d bigint,
  mtd_new_client_workspaces bigint,
  mtd_new_client_users bigint,
  mtd_new_enquiries bigint,
  mtd_new_quotations bigint,
  mtd_new_projects bigint,
  total_client_customers bigint,
  active_client_projects bigint,
  period_start date,
  period_end date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can view the platform dashboard'
      using errcode = '42501';
  end if;

  if report_start is null or report_end is null or report_start >= report_end then
    raise exception 'A valid dashboard reporting period is required'
      using errcode = '22023';
  end if;

  return query
  with eligible_companies as (
    select
      companies.id as company_id,
      companies.status,
      companies.created_at
    from public.companies
    where companies.is_in_house = false
  ),
  eligible_organizations as (
    select
      organizations.id as organization_id,
      organizations.company_id
    from public.organizations
    join eligible_companies
      on eligible_companies.company_id = organizations.company_id
  ),
  primary_admins as (
    select distinct on (users_profile.organization_id)
      users_profile.organization_id,
      users_profile.status,
      users_profile.auth_user_id,
      users_profile.onboarded_at
    from public.users_profile
    join eligible_organizations
      on eligible_organizations.organization_id = users_profile.organization_id
    where coalesce(users_profile.is_super_admin, false) = false
    order by users_profile.organization_id, users_profile.created_at nulls last, users_profile.id
  ),
  client_subscriptions as (
    select
      eligible_companies.company_id,
      company_subscriptions.plan_key,
      company_subscriptions.status,
      company_subscriptions.trial_ends_at,
      company_subscriptions.current_period_ends_at
    from eligible_companies
    left join public.company_subscriptions
      on company_subscriptions.company_id = eligible_companies.company_id
  )
  select
    (select count(*) from eligible_companies),
    (select count(*) from eligible_companies where eligible_companies.status = 'active'),
    (select count(*) from eligible_companies where eligible_companies.status = 'inactive'),
    (select count(*) from public.companies where public.companies.is_in_house = true),
    (
      select count(*)
      from client_subscriptions
      where client_subscriptions.status = 'trialing'
        and client_subscriptions.trial_ends_at > statement_timestamp()
    ),
    (
      select count(*)
      from client_subscriptions
      where client_subscriptions.status = 'trialing'
        and client_subscriptions.trial_ends_at > statement_timestamp()
        and client_subscriptions.trial_ends_at <= statement_timestamp()
          + make_interval(days => greatest(coalesce(trial_window_days, 7), 0))
    ),
    (
      select count(*)
      from client_subscriptions
      where client_subscriptions.company_id is not null
        and (
          client_subscriptions.status in ('expired')
          or (
            client_subscriptions.status = 'trialing'
            and client_subscriptions.trial_ends_at <= statement_timestamp()
          )
        )
    )
    + (
      select count(*)
      from client_subscriptions
      where client_subscriptions.status is null
    ),
    (
      select count(*)
      from client_subscriptions
      where client_subscriptions.plan_key is not null
        and (
          client_subscriptions.status = 'grandfathered'
          or (
            client_subscriptions.status = 'active'
            and (
              client_subscriptions.current_period_ends_at is null
              or client_subscriptions.current_period_ends_at > statement_timestamp()
            )
          )
        )
    ),
    (
      select count(*)
      from client_subscriptions
      where client_subscriptions.plan_key is not null
        and client_subscriptions.status in ('past_due', 'suspended', 'cancelled')
    ),
    (
      select count(*)
      from eligible_organizations
      left join primary_admins
        on primary_admins.organization_id = eligible_organizations.organization_id
      where primary_admins.organization_id is null
        or (
          primary_admins.status is distinct from 'inactive'
          and (
            primary_admins.status = 'invited'
            or primary_admins.auth_user_id is null
            or primary_admins.onboarded_at is null
          )
        )
    ),
    (
      select count(*)
      from primary_admins
      where primary_admins.status = 'active'
    ),
    (
      select count(distinct users_profile.id)
      from public.users_profile
      join eligible_organizations
        on eligible_organizations.organization_id = users_profile.organization_id
      where coalesce(users_profile.is_super_admin, false) = false
    ),
    (
      select count(distinct users_profile.id)
      from public.users_profile
      join eligible_organizations
        on eligible_organizations.organization_id = users_profile.organization_id
      where coalesce(users_profile.is_super_admin, false) = false
        and users_profile.status = 'active'
        and users_profile.last_login_at >= statement_timestamp() - interval '7 days'
    ),
    (
      select count(*)
      from eligible_companies
      where eligible_companies.created_at >= report_start
        and eligible_companies.created_at < report_end
    ),
    (
      select count(distinct users_profile.id)
      from public.users_profile
      join eligible_organizations
        on eligible_organizations.organization_id = users_profile.organization_id
      where coalesce(users_profile.is_super_admin, false) = false
        and users_profile.created_at >= report_start
        and users_profile.created_at < report_end
    ),
    (
      select count(*)
      from public.leads
      join eligible_organizations
        on eligible_organizations.organization_id = leads.organization_id
      where leads.created_at >= report_start
        and leads.created_at < report_end
    ),
    (
      select count(*)
      from public.quotations
      join eligible_organizations
        on eligible_organizations.organization_id = quotations.organization_id
      where quotations.created_at >= report_start
        and quotations.created_at < report_end
    ),
    (
      select count(*)
      from public.projects
      join eligible_organizations
        on eligible_organizations.organization_id = projects.organization_id
      where projects.created_at >= report_start
        and projects.created_at < report_end
    ),
    (
      select count(*)
      from public.customers
      join eligible_organizations
        on eligible_organizations.organization_id = customers.organization_id
    ),
    (
      select count(*)
      from public.projects
      join eligible_organizations
        on eligible_organizations.organization_id = projects.organization_id
      where projects.project_status not in ('installation_completed', 'commissioned', 'cancelled')
    ),
    report_start,
    report_end;
end;
$$;

revoke all on function public.platform_dashboard_summary(date, date, integer) from public, anon;
grant execute on function public.platform_dashboard_summary(date, date, integer) to authenticated;
