# Subscription Access and Billing

Status: implemented in the current repository. The 2026-08-11 Core/Pro access
migration must be applied before the new entitlement model is active in an
environment.

## Plans

| Plan | Monthly | Yearly | Seats | Access summary |
| --- | ---: | ---: | ---: | --- |
| Bizlee Core | ₹999 | ₹10,989 | 3 total active or invited users | Core solar workflows are writable; commercial modules remain visible as read-only history; Bizlee AI is locked. |
| Bizlee Pro | ₹1,499 | ₹16,489 | Unlimited | All configured modules and capabilities are writable, subject to role permissions. |

The yearly prices are explicit catalogue values, not client-side monthly-price
calculations. Trialing and grandfathered workspaces receive full access. Expired
or inactive subscriptions retain read-only access to known non-AI modules so
historical records are not hidden.

## Access Model

Role permissions and subscription access are independent boundaries. A request
is allowed only when both boundaries permit it:

- `user_has_role_permission(module, action)` resolves RBAC only.
- `subscription_module_access(module)` returns `full`, `read_only`, or `locked`.
- `subscription_capability_access(capability)` applies the same levels to
  cross-module business capabilities.
- `user_has_permission(module, action)` intersects RBAC and plan access. Views
  accept `full` or `read_only`; writes require `full` and an active writable
  subscription.

The web sidebar shows `Pro` or `Read only` badges. A read-only route first shows
an upgrade dialog and can then reveal historical records with write, delete,
export, PDF-generation, dispatch, receive, and workflow actions disabled. Locked
routes do not render their module content.

The database remains the enforcement boundary. Trigger functions protect writes,
capability-specific records, staff seat limits, and Pro-source Storage objects;
the React route guard is explanatory UI only.

## Core Entitlements

Core includes full access to dashboard, project-based customers, enquiries,
site surveys, Product Master and pricing, BOM templates, quotations, projects,
project payments, customer-facing documents, staff, and settings.

Core keeps B2B/direct sales, inventory, vendors, purchases, commercial invoices,
commercial payments, and documents sourced from invoices, proformas, or purchase
orders as read-only history. Quotation acceptance still creates the project, but
does not create Pro-only inventory reservations. Bizlee AI is locked.

## Seat Enforcement

Core permits three occupied seats, counting both `active` and `invited`
`users_profile` rows. Database triggers enforce the limit when staff are invited,
reactivated, or moved onto Core, including Razorpay activation. Company admins
can deactivate another staff profile to free a seat; that action also removes
the user's live Supabase Auth sessions.

## Billing Flow

- New workspaces receive a full-feature trial.
- Company admins choose monthly or yearly Core/Pro plans on `/billing/plans`.
- `create-razorpay-subscription` validates the selected catalogue price and
  blocks Core checkout when occupied seats exceed the Core limit.
- Razorpay webhooks update subscription state and create tenant-visible GST
  subscription invoices. `verify-razorpay-subscription` handles post-checkout
  verification.
- Cancellation is scheduled through `cancel-razorpay-subscription`; access
  follows the effective subscription period and status.
- Trial and subscription notification workers use the tenant notification queue.

Razorpay credentials and plan IDs are server-only. The environment template
lists the required variables; never expose them through `VITE_` or Expo public
variables.

## Change Checklist

When changing plans or entitlements, update the catalogue migration, access RPCs,
write triggers, web and mobile subscription contracts, checkout validation,
Razorpay webhook behavior, subscription SQL tests, this guide, QA coverage, and
the changelog together.
