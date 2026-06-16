# Developer Guide

## Setup

Install dependencies:

```bash
npm install
```

Create local environment values from the example:

```bash
cp .env.example .env
```

Set Supabase values:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run preview
npm run setup:super-admin
```

For documentation-only changes, a build is usually unnecessary unless the docs
also change generated references or examples that need validation.

## Code Conventions

- Use TypeScript.
- Keep feature code inside the relevant `src/modules/<module>` folder.
- Keep shared UI in `src/components`.
- Keep external clients in `src/services`.
- Keep runtime configuration in `src/config`.
- Prefer small, focused utilities over broad shared abstractions.
- Do not hardcode tenant or company-specific production values.

## UI Conventions

- Build mobile-first.
- Keep navigation and action controls usable on small screens.
- Avoid layouts that depend on desktop width to be understandable.
- Keep shared components consistent before adding new visual patterns.

## Supabase Conventions

- Create schema changes through migrations.
- Review RLS for every table, view, RPC, and storage policy change.
- Every future business table must include a tenant owner column; the project
  rule prefers `company_id`.
- Existing tables may use `organization_id` or `tenant_id`; follow existing
  table ownership until a planned migration changes it.
- Do not expose service-role keys in frontend code.
- Inventory item creation must select an active Product Master product through
  `inventory_items.catalog_product_id`; do not recreate product/brand/model
  dropdown data inside Inventory.
- Minimum stock alerts belong to Inventory records, not Product Master records.
- Do not select, display, or update legacy price columns on `products` or
  `inventory_items`. Current admin pricing belongs to `product_prices`, and
  price changes must write `product_price_history`.
- Staff-safe purchase and batch screens must not select price-bearing tables or
  columns directly. Use the safe purchase and inventory batch RPCs for users
  without `product_pricing:view`.
- Actual purchase cost belongs to purchase lines and received
  `inventory_batches`; changing current Product Master pricing must never alter
  historical PO or batch costs.

## Super Admin Setup

Use `npm run setup:super-admin` from a trusted local or server environment to
create or reset the platform super admin Auth user. The script requires:

```text
SUPABASE_SERVICE_ROLE_KEY=
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=
SUPER_ADMIN_FULL_NAME=
```

`SUPABASE_URL` or `VITE_SUPABASE_URL` must also be available. The service-role
key is server-only and must never be exposed through `VITE_` variables or
browser code.

The script creates or updates the Supabase Auth user, marks email as confirmed,
and links active super-admin rows in `users_profile`, `profiles`, and
`platform_admins`.

## Documentation Workflow

Update docs when changing:

- routes or module structure
- environment variables
- Supabase schema, policies, storage, or seed workflow
- deployment or server handling
- product scope or accepted functionality
- developer or AI-agent conventions

`supabase/seed.qa.sql` is intentionally a no-op stub. Do not reintroduce
company-specific QA data unless a future task explicitly asks for a new
local/staging seed plan.
