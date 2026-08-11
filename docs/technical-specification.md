# Technical Specification

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Supabase JavaScript client
- Supabase database, authentication, storage, migrations, and RLS
- Expo 57, React Native, and Expo Router for the native mobile client
- Node.js 22 for production SPA hosting and backend-only HTTP routes
- npm workspaces for `apps/*` and `packages/*`
- jsPDF for generated document/PDF workflows
- OpenAI Chat Completions, Razorpay Subscriptions, and Meta WhatsApp integrations

## Runtime Configuration

Frontend runtime configuration is read through Vite environment variables. The
current public Supabase values are expected to use:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Never expose service-role keys or private secrets in frontend code.

The Expo client reads `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_EAS_PROJECT_ID`. These are
public bundle values; Razorpay secrets, Meta credentials, worker secrets, OpenAI
keys, and the Supabase service role remain server-side.

## Frontend Structure

```text
apps/mobile/       Expo Router application
packages/          Shared mobile/API contracts and domain helpers
server/            Node server, mobile REST API, and WhatsApp handlers
src/
  app/          App wiring, routes, navigation, auth provider, route guards
  components/   Shared UI and layout-level components
  layouts/      Dashboard and navigation shells
  modules/      Feature modules grouped by domain
  services/     External clients and shared service access
  config/       Runtime configuration
```

Each module should keep its page components, API helpers, types, and utilities
inside the module folder when practical.

Shared cross-module UI belongs in `src/components`. `RecordTitle` is the shared
workflow detail heading component currently used by Enquiry, Site Survey,
Quotation, Customer, and Project detail pages.

## Routing And Navigation

Routes are declared in `src/app/routes.ts`. Navigation is derived from those
route definitions in `src/app/navigation.ts`, including grouped product/material
routes, BOM templates, super-admin-only entries, and subscription plan metadata.

Route definitions should include:

- `path`
- `label`
- `moduleKey`
- `description`
- `superAdminOnly` when needed

## Backend And Data

Supabase is the backend. Schema changes live in `supabase/migrations`, with
seed files in `supabase/seed.sql` and `supabase/seed.qa.sql`.

All tenant-owned business data must have a tenant owner column. The project rule
prefers `company_id`; existing migrations also use `organization_id` and
`tenant_id`. Any future normalization must include a migration plan, RLS review,
and compatibility review.

Generated PDFs are tracked through document metadata and Supabase storage.
Quotation PDFs use the `quotation_pdf` document type; proforma, invoice, and
purchase order PDF workflows use their own document types and the same storage
boundary.

The Node server exposes `/api/mobile/v1`, authenticated super-admin WhatsApp
endpoints, and the signed Meta webhook while preserving Vite SPA fallbacks. The
mobile API passes the caller's Supabase JWT through for tenant business reads and
writes, so RLS remains authoritative.

Subscription authorization intersects role permissions with module/capability
access levels (`full`, `read_only`, `locked`). UI guards and badges explain the
result; database functions, triggers, Edge Functions, and Storage policies
enforce writes, seats, Pro-only capabilities, and AI access.

## Security

- Enforce tenant isolation and permissions with Supabase RLS.
- Do not rely on frontend checks as security.
- Do not use user-editable metadata for authorization decisions.
- Keep privileged functions and secrets out of public client code.
- Treat storage policies as part of the security model.

## Quality Expectations

- Use TypeScript for application code.
- Keep UI mobile-first and responsive.
- Keep code modular by feature folder.
- Update docs when changing architecture, modules, schema, environment
  variables, or server handling.
