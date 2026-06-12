-- Step 5 authentication foundation.
-- Supabase Auth owns OTP delivery and auth.users. This migration creates the
-- database-side bridge that lets pre-created organization users attach to their
-- auth account after a successful WhatsApp/SMS OTP login.

do $$
begin
  if exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relname = 'users_profile'
      and pg_class.relkind in ('v', 'm')
  ) then
    drop view public.users_profile;
  end if;
end;
$$;

create table if not exists public.users_profile (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  full_name text,
  phone text,
  email text,
  status text default 'invited',
  is_super_admin boolean default false,
  last_login_at timestamptz,
  invited_at timestamptz,
  onboarded_at timestamptz,
  phone_verified boolean default false,
  email_verified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.users_profile add column if not exists id uuid default gen_random_uuid();
alter table public.users_profile add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.users_profile add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.users_profile add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.users_profile add column if not exists full_name text;
alter table public.users_profile add column if not exists phone text;
alter table public.users_profile add column if not exists email text;
alter table public.users_profile add column if not exists status text default 'invited';
alter table public.users_profile add column if not exists is_super_admin boolean default false;
alter table public.users_profile add column if not exists last_login_at timestamptz;
alter table public.users_profile add column if not exists invited_at timestamptz;
alter table public.users_profile add column if not exists onboarded_at timestamptz;
alter table public.users_profile add column if not exists phone_verified boolean default false;
alter table public.users_profile add column if not exists email_verified boolean default false;
alter table public.users_profile add column if not exists created_at timestamptz default now();
alter table public.users_profile add column if not exists updated_at timestamptz default now();

update public.users_profile
set
  status = coalesce(status, 'invited'),
  is_super_admin = coalesce(is_super_admin, false),
  phone_verified = coalesce(phone_verified, false),
  email_verified = coalesce(email_verified, false),
  invited_at = coalesce(invited_at, created_at, now());

alter table public.users_profile alter column is_super_admin set default false;
alter table public.users_profile alter column phone_verified set default false;
alter table public.users_profile alter column email_verified set default false;

create unique index if not exists users_profile_phone_unique
on public.users_profile (phone)
where phone is not null;

create unique index if not exists users_profile_email_unique
on public.users_profile (lower(email))
where email is not null;

create index if not exists users_profile_organization_id_idx
on public.users_profile (organization_id);

drop trigger if exists set_users_profile_updated_at on public.users_profile;

create trigger set_users_profile_updated_at
before update on public.users_profile
for each row
execute function public.set_updated_at();

-- Migrate existing auth-bound profiles into the invitation-friendly table.
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
  onboarded_at,
  created_at,
  updated_at
)
select
  profiles.id,
  profiles.organization_id,
  profiles.company_id,
  profiles.full_name,
  profiles.phone,
  profiles.email,
  profiles.status,
  coalesce(profiles.is_super_admin, false),
  profiles.created_at,
  profiles.created_at,
  profiles.created_at,
  profiles.updated_at
from public.profiles
on conflict (auth_user_id) do update
set
  organization_id = excluded.organization_id,
  company_id = excluded.company_id,
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  status = excluded.status,
  is_super_admin = excluded.is_super_admin,
  updated_at = now();

-- user_roles keeps the original auth-user reference for compatibility and now
-- also supports invitation-time assignment through users_profile.id.
alter table public.user_roles add column if not exists user_profile_id uuid references public.users_profile(id) on delete cascade;

update public.user_roles
set user_profile_id = users_profile.id
from public.users_profile
where user_roles.user_profile_id is null
  and user_roles.user_id = users_profile.auth_user_id;

create unique index if not exists user_roles_user_profile_id_role_id_unique
on public.user_roles (user_profile_id, role_id)
where user_profile_id is not null;

-- Super admin checks now use users_profile so invited/auth-linked users have one
-- canonical profile table. Existing platform_admins still count as super admins.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
        and users_profile.is_super_admin = true
        and users_profile.status = 'active'
    );
$$;

-- Returns the current authenticated user's organization from users_profile.
-- Unknown OTP signups return null and therefore fail tenant RLS checks.
create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users_profile.organization_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;
$$;

-- Permission checks resolve the auth user to users_profile, then check either the
-- invitation profile role link or the older auth-user role link.
create or replace function public.user_has_permission(module text, action text)
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

-- Syncs the current Supabase Auth user to a pre-created users_profile row.
-- Unknown phone/email values are denied instead of creating a new tenant or user.
create or replace function public.sync_auth_user_profile()
returns public.users_profile
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_auth_user_id uuid := auth.uid();
  auth_phone text;
  auth_email text;
  auth_phone_confirmed_at timestamptz;
  auth_email_confirmed_at timestamptz;
  matched_profile public.users_profile%rowtype;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to sync a user profile'
      using errcode = '42501';
  end if;

  select
    nullif(trim(users.phone), ''),
    nullif(lower(trim(users.email)), ''),
    users.phone_confirmed_at,
    users.email_confirmed_at
  into
    auth_phone,
    auth_email,
    auth_phone_confirmed_at,
    auth_email_confirmed_at
  from auth.users
  where users.id = current_auth_user_id;

  select *
  into matched_profile
  from public.users_profile
  where users_profile.auth_user_id = current_auth_user_id
    or (
      users_profile.auth_user_id is null
      and auth_phone is not null
      and users_profile.phone = auth_phone
    )
    or (
      users_profile.auth_user_id is null
      and auth_email is not null
      and lower(users_profile.email) = auth_email
    )
  order by
    (users_profile.auth_user_id = current_auth_user_id) desc,
    (auth_phone is not null and users_profile.phone = auth_phone) desc,
    users_profile.created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'No invited user profile found for this phone or email'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    auth_user_id = coalesce(users_profile.auth_user_id, current_auth_user_id),
    email = coalesce(users_profile.email, auth_email),
    phone = coalesce(users_profile.phone, auth_phone),
    status = case
      when users_profile.status = 'invited' then 'active'
      else users_profile.status
    end,
    last_login_at = now(),
    onboarded_at = coalesce(users_profile.onboarded_at, now()),
    phone_verified = users_profile.phone_verified or auth_phone_confirmed_at is not null,
    email_verified = users_profile.email_verified or auth_email_confirmed_at is not null,
    updated_at = now()
  where users_profile.id = matched_profile.id
  returning * into matched_profile;

  -- Keep the older auth-bound profiles table in sync for policies and code that
  -- still read public.profiles during the transition.
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
    matched_profile.organization_id,
    matched_profile.company_id,
    matched_profile.full_name,
    matched_profile.phone,
    matched_profile.email,
    matched_profile.status,
    matched_profile.is_super_admin,
    coalesce(matched_profile.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    organization_id = excluded.organization_id,
    company_id = excluded.company_id,
    full_name = excluded.full_name,
    phone = excluded.phone,
    email = excluded.email,
    status = excluded.status,
    is_super_admin = excluded.is_super_admin,
    updated_at = now();

  update public.user_roles target_user_roles
  set user_id = current_auth_user_id
  where target_user_roles.user_profile_id = matched_profile.id
    and target_user_roles.user_id is null
    and not exists (
      select 1
      from public.user_roles existing_user_roles
      where existing_user_roles.user_id = current_auth_user_id
        and existing_user_roles.role_id = target_user_roles.role_id
    );

  return matched_profile;
end;
$$;

-- Replaces the Step 4 onboarding RPC so it always creates a users_profile row.
-- If auth signup has not happened yet, the row waits for phone OTP sync.
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
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
  normalized_slug text;
  admin_profile_status text := 'pending_auth_signup';
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can create organizations'
      using errcode = '42501';
  end if;

  normalized_slug := lower(trim(organization_slug));

  insert into public.organizations (name, slug, subdomain, status)
  values (organization_name, normalized_slug, normalized_slug, 'active')
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, admin_email, admin_phone)
  on conflict (organization_id) do nothing;

  insert into public.roles (organization_id, role_name, description, is_system_role)
  values (
    new_organization_id,
    'Admin',
    'Default organization admin role with all permissions',
    true
  )
  returning id into admin_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select admin_role_id, permissions.id
  from public.permissions
  on conflict (role_id, permission_id) do nothing;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
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
    admin_full_name,
    admin_phone,
    admin_email,
    case when admin_auth_user_id is null then 'invited' else 'active' end,
    false,
    now(),
    false,
    false
  )
  on conflict (phone) where phone is not null do update
  set
    auth_user_id = coalesce(public.users_profile.auth_user_id, excluded.auth_user_id),
    organization_id = excluded.organization_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = excluded.status,
    is_super_admin = false,
    updated_at = now()
  returning id into admin_profile_id;

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, admin_auth_user_id, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  if admin_auth_user_id is not null then
    insert into public.profiles (
      id,
      organization_id,
      full_name,
      phone,
      email,
      status,
      is_super_admin
    )
    values (
      admin_auth_user_id,
      new_organization_id,
      admin_full_name,
      admin_phone,
      admin_email,
      'active',
      false
    )
    on conflict (id) do update
    set
      organization_id = excluded.organization_id,
      full_name = excluded.full_name,
      phone = excluded.phone,
      email = excluded.email,
      status = excluded.status,
      is_super_admin = false,
      updated_at = now();

    admin_profile_status := 'linked_to_auth_user';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$$;

grant execute on function public.sync_auth_user_profile() to authenticated;
grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid) to authenticated;

alter table public.users_profile enable row level security;

-- Super admins can read and write all user profile rows.
create policy "Super admins can manage users profile"
on public.users_profile
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Authenticated users can read their own linked profile after OTP sync.
create policy "Users can view own users profile"
on public.users_profile
for select
to authenticated
using (auth_user_id = auth.uid());

-- Organization admins can view users inside their organization.
create policy "Organization admins can view organization users profile"
on public.users_profile
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('staff', 'view')
);

-- Organization admins can pre-create invited staff only inside their organization.
create policy "Organization admins can create organization users profile"
on public.users_profile
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and auth_user_id is null
  and coalesce(is_super_admin, false) = false
  and public.user_has_permission('staff', 'create')
);

-- Users can update their own basic profile; admins can update staff in their organization.
create policy "Organization users can update organization users profile"
on public.users_profile
for update
to authenticated
using (
  auth_user_id = auth.uid()
  or (
    organization_id = public.current_user_organization_id()
    and public.user_has_permission('staff', 'update')
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and coalesce(is_super_admin, false) = false
);

-- Staff deletion requires explicit staff delete permission and never crosses tenants.
create policy "Organization admins can delete organization users profile"
on public.users_profile
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('staff', 'delete')
);
