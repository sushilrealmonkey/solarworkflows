# Project Scope

SolarWorkflows is a multi-tenant SaaS product for solar installation and solar
operations management. The repository contains modular web and native mobile
clients, a Node server, and a Supabase backend supporting tenant organizations
with isolated users, permissions, records, documents, inventory, projects,
finance records, and reports.

## In Scope

- Mobile-first authenticated web application and Expo mobile application.
- Tenant-aware module structure under `src/modules`.
- Supabase-backed authentication, database, storage, migrations, and RLS.
- Platform and tenant access concepts, including admin-only platform areas.
- Implemented modules for dashboard, CRM, site surveys, quotations, projects,
  products/materials, inventory, vendors, purchases, invoices, payments,
  documents, reports, settings, users, companies, permissions, domains,
  BOM templates, and catalog library.
- Permission-scoped Bizlee AI, Core/Pro subscription access, Razorpay billing,
  in-app/mobile push notifications, and Meta WhatsApp operations.
- A versioned mobile REST API that preserves tenant, role, plan, and RLS checks.
- Documentation, testing plans, and conventions that help developers and AI
  agents work safely over time.

## Out Of Scope Until Explicitly Approved

- New business workflows beyond the current repository behavior.
- Company-specific production defaults or hardcoded tenant values.
- New backend services outside the existing Supabase and Node server boundaries
  unless a future architecture decision explicitly adds them.
- Destructive schema rewrites without a migration and rollback plan.
- Security decisions based only on frontend visibility.

## Product Boundary

The current project is an actively implemented SaaS platform. Future work may
deepen solar business workflows, but every feature must preserve tenant
isolation, TypeScript safety, mobile-first UI, and modular ownership.

## Tenant Boundary

Every business record must be owned by a tenant. The project rule prefers
`company_id` for future business tables. Existing migrations also use
`organization_id` and `tenant_id`; do not mix ownership columns casually. Any
normalization must be planned as a schema migration with RLS review.
