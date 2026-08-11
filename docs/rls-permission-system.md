# RLS Permission System

SolarWorkflows uses Supabase Row Level Security as the backend enforcement layer for tenant isolation and access control. Frontend button visibility can improve usability, but it must never be treated as security.

## Platform Admin Access

Platform admins are users listed in `platform_admins` with `status = 'active'`.
`is_super_admin()` also recognizes an active `users_profile.is_super_admin`
assignment. These helpers allow trusted platform users to operate across
companies and manage platform-level reference data such as modules and
permissions.

Platform admin access is intended for platform operations, support, onboarding,
and cross-tenant administration.

## Company User Access

Current tenant workflows resolve active membership through
`users_profile.company_id` and `users_profile.organization_id`. Legacy policies
still resolve `profiles.company_id` through `get_current_user_company_id()`.
Both profile rows are kept status-aligned; new policy work must use the helper
that matches the table's existing ownership model.

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

Newer operational modules use `user_has_permission(module, action)`, whose
standard write action is `update`. Inspect the current migrations before reusing
the legacy `has_permission` action names.

## Subscription Access

RBAC and subscription authorization are separate, intersecting checks.
`user_has_role_permission(module, action)` resolves the role grant without plan
logic. `subscription_module_access(module)` and
`subscription_capability_access(capability)` return `full`, `read_only`, or
`locked`. Effective `user_has_permission(module, action)` permits views with
`full` or `read_only`, but permits writes only with `full` access and a currently
writable subscription.

Database triggers protect module writes and cross-module Pro capabilities such
as B2B customers, commercial payments, Pro-source documents, inventory
reservations, and inventory operations. Storage policy also blocks downloads of
commercial source documents for plans without the required capability. UI route
guards, hidden actions, and plan badges are explanatory controls only.

Trialing and grandfathered workspaces resolve to full access. Active paid plans
use catalogue entitlements. Expired subscriptions retain read-only access to
known non-AI modules, while Bizlee AI remains locked. Core seat limits are
enforced on `users_profile` and subscription activation by database triggers.

## Mobile API

The Expo app uses Supabase directly only for Auth. `/api/mobile/v1` validates the
Bearer token, resolves an active tenant profile, and uses a caller-JWT Supabase
client for business queries. This keeps table RLS, role permissions, and plan
access authoritative even if a mobile client is modified. Service-role calls are
restricted to explicitly trusted device-registration operations.

## Company ID Isolation

Tenant isolation compares each row's `company_id`, `organization_id`, or legacy
`tenant_id` to the matching active-profile helper. For join tables without a
direct tenant column, policies resolve ownership through the related
tenant-scoped table, such as `roles` or `profiles`.

This keeps company data separated at the database layer. If a request reaches Supabase directly, RLS still blocks cross-company reads and writes.

## Future Business Tables

Every future business table must include `company_id` unless it is truly global reference data. This includes clients, quotations, invoices, payments, inventory, purchases, vendors, projects, expenses, contractor records, documents, and reports.

Without `company_id`, RLS cannot reliably prove which tenant owns a row. Adding `company_id` from the beginning keeps policies simple, audit-friendly, and safe for a multi-tenant SaaS platform.

## Security Notes

### `settings:update` is effectively admin-equivalent

A user with the `settings:update` permission can create a custom (non-system) role via `create_settings_role` and grant it *every* permission through `apply_role_permissions`, then assign that role to any staff member. System roles remain locked (only a super admin can change their permissions), but custom roles are not. Treat `settings:update` as an administrative capability and grant it only to trusted admins — it is not a safe permission to hand to general staff.

### Deactivation revokes access at the database layer

Setting a user's status to `inactive` (via `update_settings_staff` or the admin-status edge function) denies them across both RBAC paths: `user_has_permission()` and the legacy `has_permission()` / `get_current_user_company_id()` helpers all require an active profile. Deactivation also keeps the `profiles` and `users_profile` status columns in sync and terminates the user's live auth sessions, so a deactivated user cannot continue operating with a still-valid token. Client-side sign-out is a convenience, not the enforcement point — RLS is.
# Record-scoped authorization (2026-08-11)

Tenant authorization now intersects four boundaries: functional action, record
scope, safe field projection, and subscription entitlement. Standard tenant
roles are locked: `admin`, `sales_team`, `backend_team`, `accounts`, and
`field_staff`.

`get_current_user_permissions()` is the application contract. Each row contains
`module_key`, `action_key`, and `record_scope`; clients must not reconstruct role
permissions locally. `role_module_scopes` stores the tenant role/module scope.
Multiple roles union actions and choose the broadest configured scope, while
Core/Pro entitlement may only reduce access.

Field Staff does not select from the base `projects` or `site_surveys` tables.
Reads use `get_field_projects()` and `get_field_site_surveys()`. Writes use the
narrow technical/evidence/status RPCs. The RPCs validate the active profile,
tenant, role, assignment, release state, current state, and requested transition
under a row lock. React visibility is not a confidentiality boundary.

Sales ownership is `assigned_to = current profile`, or `assigned_to is null` and
`created_by = current profile`. Reassignment removes prior access. Quotation and
Sales Order ownership is persisted and backfilled rather than inferred only at
query time.

Project installation authorization uses `project_staff_assignments`; the legacy
`assigned_installation_team` JSON is display-only. `field_released_at` is set the
first time installation is scheduled and remains set for history.

Non-admin standard roles receive no delete permission. Financial correction and
record lifecycle operations remain controlled workflows, not ordinary CRUD.
