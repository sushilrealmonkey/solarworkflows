# Change Log

Notable project changes should be recorded here in reverse chronological order.
Keep entries short and factual.

## 2026-06-12

- Added admin-only product pricing tables, price history, and pricing
  permissions.
- Added purchase partial receiving with inventory batch cost records.
- Updated Product, Inventory, and Purchase screens to hide purchase/selling
  prices from users without product pricing permission.
- Documented pricing, batch receiving, and staff-safe data access rules.

## 2026-06-06

- Added inventory reservations for accepted quotations, including soft holds,
  shortage tracking, release on cancelled/rejected/expired quotations, and
  conversion to stock-out on material dispatch.
- Updated invoice creation UX to prioritize project invoices while preserving
  customer-only manual item invoices.
- Documented project-first invoice QA coverage and the existing nullable
  project/quotation invoice links.

## 2026-06-05

- Established the project documentation foundation in `docs/`.
- Added scope, vision, functionality, technical specification, server handling,
  architecture, developer, AI agent, and data model guides.
- Updated the documentation index and linked existing RLS and QA testing docs.
- Documented current multi-tenant guardrails, Supabase usage, module structure,
  and the `company_id` / `organization_id` / `tenant_id` ownership naming
  reality.
