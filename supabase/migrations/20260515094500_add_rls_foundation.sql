-- Returns the company_id attached to the currently authenticated user's profile.
-- This is the core tenant lookup used by company-scoped RLS policies.
create or replace function public.get_current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profiles.company_id
  from public.profiles
  where profiles.id = auth.uid()
  limit 1;
$$;

-- Returns true when the current authenticated user is an active platform admin.
-- Platform admins can operate across tenants and manage platform-level reference data.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins
    where platform_admins.user_id = auth.uid()
      and platform_admins.status = 'active'
  );
$$;

-- Returns true when the current user has a permission through any assigned role.
-- Platform admins automatically pass every permission check.
create or replace function public.has_permission(module_key text, action_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.user_roles
      join public.roles on roles.id = user_roles.role_id
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where user_roles.user_id = auth.uid()
        and roles.company_id = public.get_current_user_company_id()
        and modules.module_key = $1
        and permissions.action_key = $2
        and modules.is_active = true
    );
$$;

-- Returns true when the target company is the current user's company.
-- Platform admins pass this check for any company.
create or replace function public.is_company_user(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or (
      target_company_id is not null
      and target_company_id = public.get_current_user_company_id()
    );
$$;

-- RLS is enabled for platform admin data because it controls platform-wide access.
alter table public.platform_admins enable row level security;

-- RLS is enabled for all tenant, access-control, global reference, log, and notification tables.
alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.domains enable row level security;
alter table public.profiles enable row level security;
alter table public.modules enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;

-- Platform admins can manage the list of platform admins.
create policy "Platform admins can manage platform admins"
on public.platform_admins
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Platform admins can view, create, update, and delete all companies.
create policy "Platform admins can manage companies"
on public.companies
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view their own company record with companies view permission.
create policy "Company users can view own company"
on public.companies
for select
to authenticated
using (
  id = public.get_current_user_company_id()
  and public.has_permission('companies', 'view')
);

-- Company users can update their own company only with the companies edit permission.
create policy "Company users can update own company with permission"
on public.companies
for update
to authenticated
using (
  id = public.get_current_user_company_id()
  and public.has_permission('companies', 'edit')
)
with check (
  id = public.get_current_user_company_id()
  and public.has_permission('companies', 'edit')
);

-- Company users can delete their own company only with the companies delete permission.
create policy "Company users can delete own company with permission"
on public.companies
for delete
to authenticated
using (
  id = public.get_current_user_company_id()
  and public.has_permission('companies', 'delete')
);

-- Platform admins can manage all company settings.
create policy "Platform admins can manage company settings"
on public.company_settings
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view settings for their own company with companies view permission.
create policy "Company users can view own company settings"
on public.company_settings
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('companies', 'view')
);

-- Company users can create settings only inside their own company with companies create permission.
create policy "Company users can create own company settings with permission"
on public.company_settings
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('companies', 'create')
);

-- Company users can update settings only inside their own company with companies edit permission.
create policy "Company users can update own company settings with permission"
on public.company_settings
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('companies', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('companies', 'edit')
);

-- Company users can delete settings only inside their own company with companies delete permission.
create policy "Company users can delete own company settings with permission"
on public.company_settings
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('companies', 'delete')
);

-- Platform admins can view, create, update, and delete all domains.
create policy "Platform admins can manage domains"
on public.domains
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view domains for their own company with domains view permission.
create policy "Company users can view own domains"
on public.domains
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('domains', 'view')
);

-- Company users can create domains only for their own company with domains create permission.
create policy "Company users can create own domains with permission"
on public.domains
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('domains', 'create')
);

-- Company users can update domains only for their own company with domains edit permission.
create policy "Company users can update own domains with permission"
on public.domains
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('domains', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('domains', 'edit')
);

-- Company users can delete domains only for their own company with domains delete permission.
create policy "Company users can delete own domains with permission"
on public.domains
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('domains', 'delete')
);

-- Platform admins can manage all profiles.
create policy "Platform admins can manage profiles"
on public.profiles
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view users from their own company with users view permission.
create policy "Company users can view own company profiles"
on public.profiles
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('users', 'view')
);

-- Company users can create profiles only inside their own company with users create permission.
create policy "Company users can create own company profiles with permission"
on public.profiles
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('users', 'create')
);

-- Company users can update profiles only inside their own company with users edit permission.
create policy "Company users can update own company profiles with permission"
on public.profiles
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('users', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('users', 'edit')
);

-- Company users can delete profiles only inside their own company with users delete permission.
create policy "Company users can delete own company profiles with permission"
on public.profiles
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('users', 'delete')
);

-- Authenticated users can view modules because modules are global permission reference data.
create policy "Authenticated users can view modules"
on public.modules
for select
to authenticated
using (true);

-- Platform admins can manage module reference data.
create policy "Platform admins can manage modules"
on public.modules
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Authenticated users can view permissions because permissions are global reference data.
create policy "Authenticated users can view permissions"
on public.permissions
for select
to authenticated
using (true);

-- Platform admins can manage permission reference data.
create policy "Platform admins can manage permissions"
on public.permissions
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Platform admins can manage all roles across companies.
create policy "Platform admins can manage roles"
on public.roles
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view roles from their own company with permissions view permission.
create policy "Company users can view own company roles"
on public.roles
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('permissions', 'view')
);

-- Company users can create roles only inside their own company with permissions create permission.
create policy "Company users can create own company roles with permission"
on public.roles
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('permissions', 'create')
);

-- Company users can update roles only inside their own company with permissions edit permission.
create policy "Company users can update own company roles with permission"
on public.roles
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('permissions', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('permissions', 'edit')
);

-- Company users can delete roles only inside their own company with permissions delete permission.
create policy "Company users can delete own company roles with permission"
on public.roles
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('permissions', 'delete')
);

-- Platform admins can manage all role-permission assignments.
create policy "Platform admins can manage role permissions"
on public.role_permissions
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view role permissions for roles in their own company with permissions view permission.
create policy "Company users can view own company role permissions"
on public.role_permissions
for select
to authenticated
using (
  public.has_permission('permissions', 'view')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can create role permissions only for roles in their own company with permissions create permission.
create policy "Company users can create own company role permissions with permission"
on public.role_permissions
for insert
to authenticated
with check (
  public.has_permission('permissions', 'create')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can update role permissions only for roles in their own company with permissions edit permission.
create policy "Company users can update own company role permissions with permission"
on public.role_permissions
for update
to authenticated
using (
  public.has_permission('permissions', 'edit')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
)
with check (
  public.has_permission('permissions', 'edit')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can delete role permissions only for roles in their own company with permissions delete permission.
create policy "Company users can delete own company role permissions with permission"
on public.role_permissions
for delete
to authenticated
using (
  public.has_permission('permissions', 'delete')
  and exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Platform admins can manage all user-role assignments.
create policy "Platform admins can manage user roles"
on public.user_roles
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view user roles for users and roles in their own company with permissions view permission.
create policy "Company users can view own company user roles"
on public.user_roles
for select
to authenticated
using (
  public.has_permission('permissions', 'view')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.company_id = public.get_current_user_company_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can assign roles only inside their own company with permissions create permission.
create policy "Company users can create own company user roles with permission"
on public.user_roles
for insert
to authenticated
with check (
  public.has_permission('permissions', 'create')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.company_id = public.get_current_user_company_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can update role assignments only inside their own company with permissions edit permission.
create policy "Company users can update own company user roles with permission"
on public.user_roles
for update
to authenticated
using (
  public.has_permission('permissions', 'edit')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.company_id = public.get_current_user_company_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
)
with check (
  public.has_permission('permissions', 'edit')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.company_id = public.get_current_user_company_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Company users can remove role assignments only inside their own company with permissions delete permission.
create policy "Company users can delete own company user roles with permission"
on public.user_roles
for delete
to authenticated
using (
  public.has_permission('permissions', 'delete')
  and exists (
    select 1
    from public.profiles
    where profiles.id = user_roles.user_id
      and profiles.company_id = public.get_current_user_company_id()
  )
  and exists (
    select 1
    from public.roles
    where roles.id = user_roles.role_id
      and roles.company_id = public.get_current_user_company_id()
  )
);

-- Platform admins can manage all activity logs.
create policy "Platform admins can manage activity logs"
on public.activity_logs
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view activity logs for their own company with activity_logs view permission.
create policy "Company users can view own company activity logs"
on public.activity_logs
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('activity_logs', 'view')
);

-- Company users can create activity logs only for their own company with activity_logs create permission.
create policy "Company users can create own company activity logs with permission"
on public.activity_logs
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('activity_logs', 'create')
);

-- Company users can update activity logs only for their own company with activity_logs edit permission.
create policy "Company users can update own company activity logs with permission"
on public.activity_logs
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('activity_logs', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('activity_logs', 'edit')
);

-- Company users can delete activity logs only for their own company with activity_logs delete permission.
create policy "Company users can delete own company activity logs with permission"
on public.activity_logs
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('activity_logs', 'delete')
);

-- Platform admins can manage all notifications.
create policy "Platform admins can manage notifications"
on public.notifications
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- Company users can only view notifications for their own company with notifications view permission.
create policy "Company users can view own company notifications"
on public.notifications
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('notifications', 'view')
);

-- Company users can create notifications only for their own company with notifications create permission.
create policy "Company users can create own company notifications with permission"
on public.notifications
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('notifications', 'create')
);

-- Company users can update notifications only for their own company with notifications edit permission.
create policy "Company users can update own company notifications with permission"
on public.notifications
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('notifications', 'edit')
)
with check (
  company_id = public.get_current_user_company_id()
  and public.has_permission('notifications', 'edit')
);

-- Company users can delete notifications only for their own company with notifications delete permission.
create policy "Company users can delete own company notifications with permission"
on public.notifications
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and public.has_permission('notifications', 'delete')
);
