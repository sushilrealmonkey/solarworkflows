# Architecture

SolarWorkflows is a modular web/mobile SaaS application. React and Expo clients
share contracts, a Node server owns backend-only HTTP routes, and Supabase
provides authentication, data, storage, workers, and the primary security boundary.

## Frontend Layers

- `src/app`: Application wiring, route definitions, navigation derivation,
  authentication context, and route protection.
- `src/layouts`: Dashboard and navigation shells.
- `src/components`: Shared UI components used across modules.
- `src/modules`: Feature-owned pages, APIs, types, components, and utilities.
- `src/services`: Shared external service clients, including Supabase.
- `src/config`: Runtime configuration.
- `apps/mobile`: Expo Router screens, native components, and mobile API client.
- `packages/contracts`: Shared wire types used by the mobile client and server.
- `packages/domain`: Framework-neutral shared domain helpers.
- `server`: Production SPA host, versioned mobile API, and WhatsApp handlers.
- `supabase`: Migrations, SQL tests, Edge Functions, and local configuration.

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

Tenant navigation also carries plan metadata. Role-based visibility and
subscription access are separate: plan badges and dialogs communicate
`read_only` or `locked` access, while route wrappers suppress write interactions.

## Backend Boundary

Supabase is the backend. Frontend modules should call module API helpers, and
those helpers should use the shared Supabase client. Security must remain in
Supabase RLS, not in the React component tree.

Privileged platform actions, including EPC admin invitations, setup-link resend,
workspace/admin status changes, EPC profile edits, and guarded EPC company
delete, run through Supabase Edge Functions instead of exposing service-role
capabilities to the browser.

The Expo client authenticates with Supabase but sends business requests to
`/api/mobile/v1`. The server resolves the active profile and performs calls with
the caller JWT so tenant RLS, role permissions, and plan access match the web
application. Service-role use is limited to explicitly trusted operations.

Verified self-service workspace creation uses the narrowly scoped
`self_create_epc_workspace` RPC. The security-definer function validates the
confirmed Auth user, prevents duplicate tenant membership, creates both tenant
identifiers, and assigns only the new workspace's locked Admin role.

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

## Subscription Boundary

`user_has_permission` is the effective authorization check and intersects RBAC
with subscription access. `full` permits role-authorized reads and writes,
`read_only` permits role-authorized reads, and `locked` denies the module.
Capability checks cover Pro-only behavior that crosses otherwise-Core modules.
Database triggers, RPCs, Edge Functions, and Storage policies remain the
enforcement layer; React and Expo checks are usability controls.
# Role-scoped application boundary

Desktop and mobile load one permission/scope response and use a central route
guard. Navigation, page actions, and API endpoints consume the same permission
contract. RLS is the final row boundary. Sensitive Field Staff screens are
separate components, so the full project/survey components never mount and do
not issue finance, inventory, document, quotation, or lifecycle requests.

Safe projections provide the minimum role-specific context. Normalized
installation assignments and `field_released_at` control field visibility; free
text team labels never authorize access.
