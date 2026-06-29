# Architecture

SolarWorkflows is a modular React and Supabase SaaS application. The frontend is
organized around feature modules, and Supabase provides the backend security and
data boundary.

## Frontend Layers

- `src/app`: Application wiring, route definitions, navigation derivation,
  authentication context, and route protection.
- `src/layouts`: Dashboard and navigation shells.
- `src/components`: Shared UI components used across modules.
- `src/modules`: Feature-owned pages, APIs, types, components, and utilities.
- `src/services`: Shared external service clients, including Supabase.
- `src/config`: Runtime configuration.

## Module Pattern

Feature folders should remain self-contained. A typical module may include:

- page components
- detail pages
- API helpers
- type definitions
- local utilities
- module-specific presentational components

Shared code should move to `src/components`, `src/services`, or another shared
location only when multiple modules need it.

Current shared UI includes `src/components/RecordTitle.tsx`, which standardizes
selected workflow detail page headings. It is used only for the implemented
record types: Enquiry, Site Survey, Quotation, Customer, and Project.

## Route Pattern

Routes live in `src/app/routes.ts`. Navigation is derived in
`src/app/navigation.ts` so labels, module keys, and super-admin visibility stay
consistent.

When adding a module route:

- Add the route definition.
- Use the correct `moduleKey` for permissions.
- Keep descriptions factual.
- Mark platform-only routes with `superAdminOnly`.

Super-admin routes are intentionally narrow. Super admins land on `/dashboard`
and can access `/dashboard`, `/companies`, `/companies/:id`, and `/settings`.
Tenant operational routes redirect super admins back to the platform area.
Tenant users continue to use permission-filtered navigation and dashboard
routes.

## Backend Boundary

Supabase is the backend. Frontend modules should call module API helpers, and
those helpers should use the shared Supabase client. Security must remain in
Supabase RLS, not in the React component tree.

Privileged platform actions, including EPC admin invitations, setup-link resend,
workspace/admin status changes, EPC profile edits, and guarded EPC company
delete, run through Supabase Edge Functions instead of exposing service-role
capabilities to the browser.

## Data Boundary

Business tables must be tenant-owned. Existing schema uses a mix of
`company_id`, `organization_id`, and `tenant_id` depending on migration history.
Future changes must not introduce ambiguous ownership. See
[Data Model Guide](data-model-guide.md).

## UI Boundary

The UI is mobile-first. Desktop layouts may add density and side navigation, but
mobile usability must remain the default design constraint.

Workflow pages should keep action placement consistent: list and detail views
may expose next-step actions when the target workflow is already backed by
permissions and data state. Examples include enquiry to site survey/quotation,
site survey to quotation/project, quotation to site survey/project, customer to
sale/project, and project operational actions.
