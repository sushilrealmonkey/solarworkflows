# RLS Permission System

SolarWorkflows uses Supabase Row Level Security as the backend enforcement layer for tenant isolation and access control. Frontend button visibility can improve usability, but it must never be treated as security.

## Platform Admin Access

Platform admins are users listed in `platform_admins` with `status = 'active'`. The `is_platform_admin()` helper allows active platform admins to operate across all companies and manage platform-level reference data such as modules and permissions.

Platform admin access is intended for platform operations, support, onboarding,
and cross-tenant administration.

## Company User Access

Company users are linked to a tenant through `profiles.company_id`. The `get_current_user_company_id()` helper returns the authenticated user's company, and `is_company_user(target_company_id)` confirms whether a requested row belongs to that company.

Company users can only see rows belonging to their own company. They cannot see another company's settings, users, roles, role assignments, domains, logs, or notifications.

## Permission Checking

Permissions are checked with:

```sql
public.has_permission(module_key text, action_key text)
```

This returns true when the user is an active platform admin or when the user's assigned roles include the requested module/action pair through `user_roles`, `role_permissions`, `permissions`, and `modules`.

The standard actions are:

- `view`
- `create`
- `edit`
- `delete`
- `export`
- `approve`

Delete policies must always check the `delete` action. Staff without a matching delete permission should not be able to delete records, even if the frontend accidentally shows a delete control.

## Company ID Isolation

Tenant isolation is enforced by comparing each row's `company_id` to the current user's `profiles.company_id`. For join tables without a direct `company_id`, policies resolve ownership through the related company-scoped table, such as `roles` or `profiles`.

This keeps company data separated at the database layer. If a request reaches Supabase directly, RLS still blocks cross-company reads and writes.

## Future Business Tables

Every future business table must include `company_id` unless it is truly global reference data. This includes clients, quotations, invoices, payments, inventory, purchases, vendors, projects, expenses, contractor records, documents, and reports.

Without `company_id`, RLS cannot reliably prove which tenant owns a row. Adding `company_id` from the beginning keeps policies simple, audit-friendly, and safe for a multi-tenant SaaS platform.

## Security Notes

### `settings:update` is effectively admin-equivalent

A user with the `settings:update` permission can create a custom (non-system) role via `create_settings_role` and grant it *every* permission through `apply_role_permissions`, then assign that role to any staff member. System roles remain locked (only a super admin can change their permissions), but custom roles are not. Treat `settings:update` as an administrative capability and grant it only to trusted admins — it is not a safe permission to hand to general staff.

### Deactivation revokes access at the database layer

Setting a user's status to `inactive` (via `update_settings_staff` or the admin-status edge function) denies them across both RBAC paths: `user_has_permission()` and the legacy `has_permission()` / `get_current_user_company_id()` helpers all require an active profile. Deactivation also keeps the `profiles` and `users_profile` status columns in sync and terminates the user's live auth sessions, so a deactivated user cannot continue operating with a still-valid token. Client-side sign-out is a convenience, not the enforcement point — RLS is.
