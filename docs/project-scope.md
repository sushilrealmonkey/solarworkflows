# Project Scope

SolarWorkflows is a multi-tenant SaaS foundation for solar installation and
solar operations management. The app is built as a modular React and Supabase
platform that can support multiple tenant organizations with isolated users,
permissions, records, documents, inventory, projects, finance records, and
reports.

## In Scope

- Mobile-first authenticated web application shell.
- Tenant-aware module structure under `src/modules`.
- Supabase-backed authentication, database, storage, migrations, and RLS.
- Platform and tenant access concepts, including admin-only platform areas.
- Module foundations for dashboard, CRM, site surveys, quotations, projects,
  products/materials, inventory, vendors, purchases, invoices, payments,
  documents, reports, settings, users, companies, permissions, domains,
  BOM templates, and catalog library.
- Documentation, testing plans, and conventions that help developers and AI
  agents work safely over time.

## Out Of Scope Until Explicitly Approved

- New business workflows beyond the current repository behavior.
- Company-specific production defaults or hardcoded tenant values.
- New backend services outside Supabase unless a future architecture decision
  explicitly adds them.
- Destructive schema rewrites without a migration and rollback plan.
- Security decisions based only on frontend visibility.

## Product Boundary

The current project should be treated as a SaaS platform foundation. Future work
may add deeper solar business workflows, but every feature must preserve tenant
isolation, TypeScript safety, mobile-first UI, and modular ownership.

## Tenant Boundary

Every business record must be owned by a tenant. The project rule prefers
`company_id` for future business tables. Existing migrations also use
`organization_id` and `tenant_id`; do not mix ownership columns casually. Any
normalization must be planned as a schema migration with RLS review.
