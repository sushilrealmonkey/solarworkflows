# SolarWorkflows / Bizlee

SolarWorkflows is the source repository for Bizlee, a multi-tenant SaaS
workspace for solar EPC companies. It includes a React web application, an Expo
mobile application, a Node API/server layer, shared TypeScript packages, and a
Supabase backend with authentication, Postgres, RLS, Storage, Edge Functions,
and scheduled workers.

## Implemented Product Areas

- Tenant and platform authentication, onboarding, roles, and permissions
- CRM, site surveys, quotations, projects, BOM templates, and documents
- Product master, inventory, vendors, purchases, B2B sales, invoices, and payments
- Bizlee AI daily brief and read-only data chat
- Core/Pro subscriptions, trials, Razorpay billing, GST invoices, and plan access
- In-app, mobile push, and opt-in WhatsApp notifications
- Super-admin company, staff, subscription, and WhatsApp operations
- Expo mobile workspace with dashboard, record lists/details, customer and
  enquiry creation, notifications, deep links, and push registration

Business behavior is implemented only where represented in the current code and
migrations. Do not infer new workflows from this overview.

## Tech Stack

- React 19, TypeScript, Vite, Tailwind CSS, and React Router
- Expo 57, React Native, and Expo Router
- Node.js 22 production server and versioned mobile REST API
- Supabase Auth, Postgres, RLS, Storage, Edge Functions, Realtime, Cron, and Vault
- OpenAI for the permission-scoped Bizlee AI experience
- Razorpay subscriptions and Meta WhatsApp integrations

## Repository Layout

```text
apps/mobile/       Expo mobile application
packages/          Shared contracts and domain packages
server/            Node server, mobile API, and WhatsApp endpoints
src/               React web application
supabase/          Migrations, tests, configuration, and Edge Functions
docs/              Product, architecture, operations, QA, and change history
```

## Getting Started

1. Install workspace dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure the required public Supabase
   values. Keep service-role, provider, and worker secrets server-side.

3. Start or verify the web application:

   ```bash
   npm run dev
   npm run build
   npm run lint
   ```

4. Configure `apps/mobile/.env.local` from its example, then start or type-check
   the mobile application:

   ```bash
   npm run mobile:start
   npm run mobile:check
   ```

Additional checks include `npm run contracts:check`, `npm run test:webhook`, and
`npm run test:mobile-api`.

## Documentation

Start with [the documentation index](docs/README.md). It links the current scope,
implemented functionality, architecture, data model, subscription access model,
mobile application/API guide, deployment notes, QA plan, and change log.

## Project Guardrails

- Preserve tenant isolation and enforce authorization in Supabase/RLS.
- Every new business table must use `company_id`; respect existing ownership
  columns when changing older tables.
- Never hardcode company-specific production values or expose server secrets.
- Keep TypeScript code modular and all user interfaces mobile-first.
- Do not add business logic unless it is explicitly approved.
