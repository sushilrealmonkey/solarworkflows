# Technical Specification

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Supabase JavaScript client
- Supabase database, authentication, storage, migrations, and RLS
- jsPDF for generated document/PDF workflows

## Runtime Configuration

Frontend runtime configuration is read through Vite environment variables. The
current public Supabase values are expected to use:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Never expose service-role keys or private secrets in frontend code.

## Frontend Structure

```text
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

## Routing And Navigation

Routes are declared in `src/app/routes.ts`. Navigation is derived from those
route definitions in `src/app/navigation.ts`, including grouped product/material
routes and super-admin-only entries.

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
