-- Step 4 onboarding foundation.
-- This migration adds organization-oriented onboarding while preserving the existing
-- companies/profiles foundation created by earlier migrations.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  subdomain text,
  custom_domain text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.organizations add column if not exists id uuid default gen_random_uuid();
alter table public.organizations add column if not exists name text;
alter table public.organizations add column if not exists slug text;
alter table public.organizations add column if not exists subdomain text;
alter table public.organizations add column if not exists custom_domain text;
alter table public.organizations add column if not exists status text default 'active';
alter table public.organizations add column if not exists created_at timestamptz default now();
alter table public.organizations add column if not exists updated_at timestamptz default now();

create unique index if not exists organizations_slug_unique
on public.organizations (slug);

create unique index if not exists organizations_subdomain_unique
on public.organizations (subdomain)
where subdomain is not null;

create unique index if not exists organizations_custom_domain_unique
on public.organizations (custom_domain)
where custom_domain is not null;

drop trigger if exists set_organizations_updated_at on public.organizations;

create trigger set_organizations_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  company_logo_url text,
  primary_color text,
  secondary_color text,
  address text,
  contact_email text,
  contact_phone text,
  gst_number text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.organization_settings add column if not exists id uuid default gen_random_uuid();
alter table public.organization_settings add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.organization_settings add column if not exists company_logo_url text;
alter table public.organization_settings add column if not exists primary_color text;
alter table public.organization_settings add column if not exists secondary_color text;
alter table public.organization_settings add column if not exists address text;
alter table public.organization_settings add column if not exists contact_email text;
alter table public.organization_settings add column if not exists contact_phone text;
alter table public.organization_settings add column if not exists gst_number text;
alter table public.organization_settings add column if not exists created_at timestamptz default now();
alter table public.organization_settings add column if not exists updated_at timestamptz default now();

create unique index if not exists organization_settings_organization_id_unique
on public.organization_settings (organization_id);

drop trigger if exists set_organization_settings_updated_at on public.organization_settings;

create trigger set_organization_settings_updated_at
before update on public.organization_settings
for each row
execute function public.set_updated_at();

-- The existing profiles table is the user profile foundation. These columns add
-- organization tenancy and super-admin support without duplicating profile data.
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.profiles add column if not exists is_super_admin boolean default false;
alter table public.profiles alter column is_super_admin set default false;
update public.profiles
set is_super_admin = false
where is_super_admin is null;
alter table public.profiles alter column is_super_admin set not null;

-- Roles now support organization-owned roles in addition to the earlier company_id foundation.
alter table public.roles add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- users_profile is an organization-facing compatibility view over profiles.
-- Supabase RLS still applies through the underlying profiles table.
create or replace view public.users_profile
with (security_invoker = true)
as
select
  profiles.id,
  profiles.organization_id,
  profiles.company_id,
  profiles.full_name,
  profiles.phone,
  profiles.email,
  profiles.status,
  profiles.is_super_admin,
  profiles.created_at,
  profiles.updated_at
from public.profiles;

-- Seed organization onboarding modules. These are global reference rows.
insert into public.modules (module_key, module_name, description, sort_order, is_active)
values
  ('dashboard', 'Dashboard', 'Dashboard access', 300, true),
  ('customers', 'Customers', 'Customer management', 310, true),
  ('leads', 'Enquiries', 'Lead management', 320, true),
  ('projects', 'Projects', 'Project management', 330, true),
  ('site_surveys', 'Site Surveys', 'Site survey management', 340, true),
  ('quotations', 'Quotations', 'Quotation management', 350, true),
  ('invoices', 'Tax Invoices', 'Invoice management', 360, true),
  ('payments', 'Payments', 'Payment management', 370, true),
  ('documents', 'Documents', 'Document management', 380, true),
  ('inventory', 'Inventory', 'Inventory access foundation', 390, true),
  ('vendors', 'Suppliers', 'Vendor management', 400, true),
  ('staff', 'Staff', 'Organization staff management', 410, true),
  ('reports', 'Reports', 'Reports access', 420, true),
  ('settings', 'Settings', 'Organization settings management', 430, true)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- Seed default CRUD permissions for every onboarding module.
insert into public.permissions (module_id, action_key, action_name)
select
  modules.id,
  actions.action_key,
  actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('update', 'Update'),
    ('delete', 'Delete')
) as actions(action_key, action_name)
where modules.module_key in (
  'dashboard',
  'customers',
  'leads',
  'projects',
  'site_surveys',
  'quotations',
  'invoices',
  'payments',
  'documents',
  'inventory',
  'vendors',
  'staff',
  'reports',
  'settings'
)
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

-- Returns true when the current user is a Realmonkey super admin.
-- Platform admins from the earlier foundation are also treated as super admins.
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
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_super_admin = true
        and profiles.status = 'active'
    );
$$;

-- Returns the authenticated user's organization_id from profiles.
-- This is the tenant lookup for organization-scoped RLS policies.
create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profiles.organization_id
  from public.profiles
  where profiles.id = auth.uid()
  limit 1;
$$;

-- Returns true when the current user has the requested module/action permission.
-- Super admins automatically pass every permission check.
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
      from public.user_roles
      join public.roles on roles.id = user_roles.role_id
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where user_roles.user_id = auth.uid()
        and roles.organization_id = public.current_user_organization_id()
        and modules.module_key = $1
        and permissions.action_key = $2
        and modules.is_active = true
    );
$$;

-- Creates an organization, default settings, an Admin role, and grants that role
-- all available permissions. If admin_auth_user_id is provided, the function also
-- creates or updates the admin profile and assigns the Admin role. If auth signup
-- happens separately, the return payload includes pending_admin_profile status.
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

    insert into public.user_roles (user_id, role_id)
    values (admin_auth_user_id, admin_role_id)
    on conflict (user_id, role_id) do nothing;

    admin_profile_status := 'linked_to_auth_user';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'admin_role_id', admin_role_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status,
    'pending_admin_profile', case
      when admin_auth_user_id is null then jsonb_build_object(
        'full_name', admin_full_name,
        'phone', admin_phone,
        'email', admin_email,
        'organization_id', new_organization_id,
        'role_id', admin_role_id
      )
      else null
    end
  );
end;
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.user_has_permission(text, text) to authenticated;
grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- Super admins can read and write every organization.
create policy "Super admins can manage organizations"
on public.organizations
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can read only their assigned organization.
create policy "Organization users can view own organization"
on public.organizations
for select
to authenticated
using (id = public.current_user_organization_id());

-- Organization admins can update their own organization when they have settings update permission.
create policy "Organization admins can update own organization"
on public.organizations
for update
to authenticated
using (
  id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
)
with check (
  id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
);

-- Super admins can read and write all organization settings.
create policy "Super admins can manage organization settings"
on public.organization_settings
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can read settings only for their own organization.
create policy "Organization users can view own organization settings"
on public.organization_settings
for select
to authenticated
using (organization_id = public.current_user_organization_id());

-- Organization admins can create settings only for their own organization.
create policy "Organization admins can create own organization settings"
on public.organization_settings
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'create')
);

-- Organization admins can update settings only for their own organization.
create policy "Organization admins can update own organization settings"
on public.organization_settings
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
);

-- Organization admins can delete settings only when they explicitly have settings delete permission.
create policy "Organization admins can delete own organization settings"
on public.organization_settings
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'delete')
);

-- Super admins can manage all user profiles.
create policy "Super admins can manage organization profiles"
on public.profiles
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Staff can read their own profile; users with staff view permission can read organization profiles.
create policy "Organization users can view assigned organization profiles"
on public.profiles
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    id = auth.uid()
    or public.user_has_permission('staff', 'view')
  )
);

-- Organization admins can create users only inside their organization.
create policy "Organization admins can create assigned organization profiles"
on public.profiles
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('staff', 'create')
);

-- Organization admins can update users only inside their organization.
create policy "Organization admins can update assigned organization profiles"
on public.profiles
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    id = auth.uid()
    or public.user_has_permission('staff', 'update')
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and (
    id = auth.uid()
    or public.user_has_permission('staff', 'update')
  )
);

-- User deletion is restricted to users with staff delete permission.
create policy "Organization admins can delete assigned organization profiles"
on public.profiles
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('staff', 'delete')
);

-- Super admins can manage all organization roles.
create policy "Super admins can manage organization roles"
on public.roles
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization admins can view roles in their organization.
create policy "Organization admins can view assigned organization roles"
on public.roles
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'view')
);

-- Organization admins can create roles in their organization.
create policy "Organization admins can create assigned organization roles"
on public.roles
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'create')
);

-- Organization admins can update roles in their organization.
create policy "Organization admins can update assigned organization roles"
on public.roles
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'update')
);

-- Role deletion requires explicit settings delete permission.
create policy "Organization admins can delete assigned organization roles"
on public.roles
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('settings', 'delete')
);

-- Super admins can manage all organization role permissions.
create policy "Super admins can manage organization role permissions"
on public.role_permissions
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization admins can view role permissions for roles in their organization.
create policy "Organization admins can view assigned organization role permissions"
on public.role_permissions
for select
to authenticated
using (
  public.user_has_permission('settings', 'view')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Organization admins can create role permissions for roles in their organization.
create policy "Organization admins can create assigned organization role permissions"
on public.role_permissions
for insert
to authenticated
with check (
  public.user_has_permission('settings', 'create')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Organization admins can update role permissions for roles in their organization.
create policy "Organization admins can update assigned organization role permissions"
on public.role_permissions
for update
to authenticated
using (
  public.user_has_permission('settings', 'update')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
)
with check (
  public.user_has_permission('settings', 'update')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Role permission deletion requires explicit settings delete permission.
create policy "Organization admins can delete assigned organization role permissions"
on public.role_permissions
for delete
to authenticated
using (
  public.user_has_permission('settings', 'delete')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Super admins can manage all organization user role assignments.
create policy "Super admins can manage organization user roles"
on public.user_roles
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization admins can view user roles only for users and roles in their organization.
create policy "Organization admins can view assigned organization user roles"
on public.user_roles
for select
to authenticated
using (
  public.user_has_permission('staff', 'view')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.organization_id = public.current_user_organization_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Organization admins can assign roles only inside their organization.
create policy "Organization admins can create assigned organization user roles"
on public.user_roles
for insert
to authenticated
with check (
  public.user_has_permission('staff', 'create')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.organization_id = public.current_user_organization_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Organization admins can update role assignments only inside their organization.
create policy "Organization admins can update assigned organization user roles"
on public.user_roles
for update
to authenticated
using (
  public.user_has_permission('staff', 'update')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.organization_id = public.current_user_organization_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
)
with check (
  public.user_has_permission('staff', 'update')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.organization_id = public.current_user_organization_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);

-- Role assignment deletion requires explicit staff delete permission.
create policy "Organization admins can delete assigned organization user roles"
on public.user_roles
for delete
to authenticated
using (
  public.user_has_permission('staff', 'delete')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.organization_id = public.current_user_organization_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.organization_id = public.current_user_organization_id()
  )
);
