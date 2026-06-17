# Change Log

Notable project changes should be recorded here in reverse chronological order.
Keep entries short and factual.

## 2026-06-17

- Added a Super Admin dashboard with EPC-level platform metrics, company setup
  status, and recent activity.
- Changed super-admin navigation to Dashboard, EPC Companies, and Settings, with
  `/dashboard` as the super-admin landing route.
- Added a route-backed EPC company detail page with company profile fields,
  primary admin setup state, workspace access summary, activity snapshot, edit
  actions, and Phase 2 subscription/financial placeholders.
- Added trusted Edge Function actions for EPC company profile updates and
  guarded delete; guarded delete blocks companies with operational records and
  directs admins to mark them inactive instead.
- Added platform-level Super Admin Settings placeholders for onboarding defaults
  and future subscription controls.
- Added a shared dashboard-shell logout button backed by Supabase
  `auth.signOut()` for every authenticated user.

## 2026-06-16

- Restricted super-admin navigation and redirects to the platform EPC Companies
  area, while keeping tenant users on the permission-filtered dashboard flow.
- Expanded EPC Companies into a super-admin management console with search,
  status filters, setup queue, workspace status actions, admin status actions,
  and setup-link resend support.
- Extended the `invite-epc-company-admin` Edge Function with trusted
  super-admin actions for setup links and workspace/admin status changes.
- Added Supabase invite email activation for EPC admins through the
  `invite-epc-company-admin` Edge Function and `/create-password` route.
- Added a trusted `setup:super-admin` script for creating or resetting the
  platform super admin Auth user and linked profile rows.
- Added a super-admin-only EPC Companies page for tenant workspace onboarding
  through the existing `create_organization_with_admin` RPC.
- Added Platform navigation for super admins and documented the service-role
  boundary for super admin credential setup.

## 2026-06-15

- Added Proforma Invoices as separate pre-payment finance records with PI
  payments, final invoice conversion, B2B sale links, and PI PDF generation.
- Split Customers into nested Project Based and B2B/Direct customer lists using
  `customers.customer_segment`.
- Updated B2B/Direct Sales to select active B2B/Direct customers and support
  sale creation from a B2B/Direct customer profile.
- Added backend customer normalization so Project Based customers stay free of
  business fields and B2B/Direct customers have no subtype or assignee choices.

## 2026-06-13

- Added a dedicated B2B Sales workflow for project-free installer product sales,
  including B2B customer fields, sale/order tables, invoice links,
  dispatch-driven inventory stock-out, and B2B invoice payments.
- Added generated purchase order PDF support through the shared document storage
  workflow, including purchase order document metadata and pricing-aware access
  checks.
- Added nullable inventory item links for invoice lines and changed invoice item
  entry to use inventory dropdown selection instead of manual product naming.

## 2026-06-12

- Added admin-only product pricing tables, price history, and pricing
  permissions.
- Added purchase partial receiving with inventory batch cost records.
- Added `receive_purchase_order_items` RPC support for controlled purchase
  receiving, automatic `stock_in` inventory transactions, received quantity
  tracking, and `partially_received` purchase order status.
- Added an inventory-only receiving permission path so warehouse/staff users can
  receive quantities without product pricing access; pricing users can still
  edit received cost and update current Product Master purchase price.
- Updated Product, Inventory, and Purchase screens to hide purchase/selling
  prices from users without product pricing permission.
- Updated Purchase list actions to use the Receive Stock workflow and fixed
  desktop action buttons so they no longer trigger row navigation.
- Updated purchase and inventory types for received quantities and
  `last_received_at`.
- Applied pending Supabase migrations for product pricing, batch receiving, and
  inventory-only purchase receiving to the linked remote database.
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
