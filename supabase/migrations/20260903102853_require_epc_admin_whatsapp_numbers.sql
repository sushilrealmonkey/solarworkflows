-- EPC primary admins must always have a WhatsApp-capable mobile number. Phone
-- confirmation remains a separate Auth-owned state, surfaced to platform staff
-- through platform_epc_company_directory().

create or replace function public.create_organization_with_admin(
  organization_name text,
  organization_slug text,
  admin_full_name text,
  admin_phone text,
  admin_email text default null,
  admin_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid := gen_random_uuid();
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
  normalized_slug text;
  normalized_admin_email text;
  normalized_admin_phone text;
  admin_profile_status text := 'pending_auth_invite';
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can create organizations'
      using errcode = '42501';
  end if;

  normalized_slug := lower(trim(organization_slug));
  normalized_admin_email := nullif(lower(trim(admin_email)), '');
  normalized_admin_phone := nullif(trim(admin_phone), '');

  if normalized_admin_email is null then
    raise exception 'Primary admin email is required'
      using errcode = '23514';
  end if;

  if normalized_admin_phone is null then
    raise exception 'Primary admin WhatsApp number is required'
      using errcode = '23514';
  end if;

  if char_length(normalized_admin_phone) < 6
    or char_length(normalized_admin_phone) > 20
    or normalized_admin_phone !~ '^[0-9+() -]+$' then
    raise exception 'Enter a valid primary admin WhatsApp number'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = normalized_admin_email
  ) then
    raise exception 'A user profile already exists for this admin email'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.users_profile
    where users_profile.phone = normalized_admin_phone
  ) then
    raise exception 'A user profile already exists for this admin WhatsApp number'
      using errcode = '23505';
  end if;

  insert into public.companies (
    id,
    company_name,
    company_slug,
    owner_name,
    owner_phone,
    owner_email,
    status
  )
  values (
    new_company_id,
    organization_name,
    'org-' || new_company_id::text,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'active'
  );

  insert into public.organizations (name, slug, subdomain, status, company_id)
  values (organization_name, normalized_slug, normalized_slug, 'active', new_company_id)
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, normalized_admin_email, normalized_admin_phone)
  on conflict (organization_id) do nothing;

  perform public.seed_epc_standard_roles(new_organization_id);

  update public.roles
  set company_id = new_company_id
  where roles.organization_id = new_organization_id
    and roles.company_id is distinct from new_company_id;

  select roles.id
  into admin_role_id
  from public.roles
  where roles.organization_id = new_organization_id
    and roles.role_key = 'admin'
  limit 1;

  if admin_role_id is null then
    raise exception 'Admin role could not be created'
      using errcode = 'P0002';
  end if;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at,
    phone_verified,
    email_verified
  )
  values (
    admin_auth_user_id,
    new_organization_id,
    new_company_id,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'invited',
    false,
    now(),
    false,
    false
  )
  on conflict (phone) where phone is not null do update
  set
    auth_user_id = coalesce(public.users_profile.auth_user_id, excluded.auth_user_id),
    organization_id = excluded.organization_id,
    company_id = excluded.company_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = 'invited',
    is_super_admin = false,
    phone_verified = false,
    updated_at = now()
  returning id into admin_profile_id;

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, null, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  if admin_auth_user_id is not null then
    admin_profile_status := 'invite_sent_pending_password';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'company_id', new_company_id,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$$;

create or replace function public.self_create_epc_workspace(
  workspace_name text,
  admin_full_name text,
  admin_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_auth_user_id uuid := auth.uid();
  current_auth_email text;
  current_auth_phone text;
  current_email_confirmed_at timestamptz;
  current_phone_confirmed_at timestamptz;
  normalized_workspace_name text;
  normalized_admin_name text;
  normalized_admin_phone text;
  slug_base text;
  workspace_slug text;
  new_company_id uuid := gen_random_uuid();
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to create a workspace'
      using errcode = '42501';
  end if;

  select
    nullif(lower(trim(users.email)), ''),
    nullif(trim(users.phone), ''),
    users.email_confirmed_at,
    users.phone_confirmed_at
  into
    current_auth_email,
    current_auth_phone,
    current_email_confirmed_at,
    current_phone_confirmed_at
  from auth.users
  where users.id = current_auth_user_id
  for update;

  if (current_auth_email is null or current_email_confirmed_at is null)
    and (current_auth_phone is null or current_phone_confirmed_at is null) then
    raise exception 'A verified email or phone number is required to create a workspace'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.users_profile
    where users_profile.auth_user_id = current_auth_user_id
  ) or exists (
    select 1
    from public.profiles
    where profiles.id = current_auth_user_id
  ) then
    raise exception 'This account already has workspace access'
      using errcode = '23505';
  end if;

  if current_auth_email is not null and exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = current_auth_email
  ) then
    raise exception 'This email is already assigned to a workspace'
      using errcode = '23505';
  end if;

  normalized_workspace_name := nullif(
    regexp_replace(trim(workspace_name), '[[:space:]]+', ' ', 'g'),
    ''
  );
  normalized_admin_name := nullif(
    regexp_replace(trim(admin_full_name), '[[:space:]]+', ' ', 'g'),
    ''
  );
  normalized_admin_phone := coalesce(
    case
      when current_phone_confirmed_at is not null then current_auth_phone
      else null
    end,
    nullif(trim(admin_phone), '')
  );

  if normalized_workspace_name is null
    or char_length(normalized_workspace_name) < 2
    or char_length(normalized_workspace_name) > 120 then
    raise exception 'Workspace name must be between 2 and 120 characters'
      using errcode = '23514';
  end if;

  if normalized_admin_name is null
    or char_length(normalized_admin_name) < 2
    or char_length(normalized_admin_name) > 120 then
    raise exception 'Full name must be between 2 and 120 characters'
      using errcode = '23514';
  end if;

  if normalized_admin_phone is null then
    raise exception 'A WhatsApp number is required to create a workspace'
      using errcode = '23514';
  end if;

  if char_length(normalized_admin_phone) < 6
    or char_length(normalized_admin_phone) > 20
    or normalized_admin_phone !~ '^[0-9+() -]+$' then
    raise exception 'Enter a valid WhatsApp number'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.users_profile
    where users_profile.phone = normalized_admin_phone
  ) or exists (
    select 1
    from public.profiles
    where profiles.phone = normalized_admin_phone
  ) then
    raise exception 'This WhatsApp number is already assigned to an account'
      using errcode = '23505';
  end if;

  slug_base := trim(
    both '-'
    from regexp_replace(lower(normalized_workspace_name), '[^a-z0-9]+', '-', 'g')
  );
  slug_base := coalesce(nullif(left(slug_base, 80), ''), 'workspace');
  workspace_slug := slug_base || '-' || left(replace(new_company_id::text, '-', ''), 8);

  insert into public.companies (
    id,
    company_name,
    company_slug,
    owner_name,
    owner_phone,
    owner_email,
    status
  )
  values (
    new_company_id,
    normalized_workspace_name,
    workspace_slug,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active'
  );

  insert into public.organizations (
    name,
    slug,
    subdomain,
    status,
    company_id
  )
  values (
    normalized_workspace_name,
    workspace_slug,
    workspace_slug,
    'active',
    new_company_id
  )
  returning id into new_organization_id;

  insert into public.organization_settings (
    organization_id,
    contact_email,
    contact_phone
  )
  values (
    new_organization_id,
    current_auth_email,
    normalized_admin_phone
  )
  on conflict (organization_id) do nothing;

  perform public.seed_epc_standard_roles(new_organization_id);

  update public.roles
  set company_id = new_company_id
  where roles.organization_id = new_organization_id
    and roles.company_id is distinct from new_company_id;

  select roles.id
  into admin_role_id
  from public.roles
  where roles.organization_id = new_organization_id
    and roles.role_key = 'admin'
  limit 1;

  if admin_role_id is null then
    raise exception 'Admin role could not be created'
      using errcode = 'P0002';
  end if;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    onboarded_at,
    phone_verified,
    email_verified
  )
  values (
    current_auth_user_id,
    new_organization_id,
    new_company_id,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active',
    false,
    now(),
    current_phone_confirmed_at is not null,
    current_email_confirmed_at is not null
  )
  returning id into admin_profile_id;

  insert into public.profiles (
    id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    created_at,
    updated_at
  )
  values (
    current_auth_user_id,
    new_organization_id,
    new_company_id,
    normalized_admin_name,
    normalized_admin_phone,
    current_auth_email,
    'active',
    false,
    now(),
    now()
  );

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, current_auth_user_id, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'company_id', new_company_id,
    'workspace_slug', workspace_slug,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id
  );
end;
$$;

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
      users_profile.phone_verified,
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
        'phone_verified', coalesce(primary_admins.phone_verified, false),
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

revoke all on function public.create_organization_with_admin(text, text, text, text, text, uuid)
from public, anon;
grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid)
to authenticated;

revoke all on function public.self_create_epc_workspace(text, text, text)
from public, anon;
grant execute on function public.self_create_epc_workspace(text, text, text)
to authenticated;

revoke all on function public.platform_epc_company_directory() from public, anon;
grant execute on function public.platform_epc_company_directory() to authenticated;

notify pgrst, 'reload schema';
