# Functionalities

This document summarizes the current and intended functional areas visible in
the repository. It does not approve new business logic by itself.

## Current Module Areas

| Area | Current intent |
| --- | --- |
| Dashboard | Tenant-aware overview and operational widgets. |
| CRM | Nested Project Based and B2B/Direct customer lists, leads, lead details, customer details, and follow-ups. |
| Site Surveys | Site survey list/detail workflows and survey records. |
| Quotations | Quotation list/detail/create workflows, proposal fields, payment terms, warranties, PDFs, BOM-related data, and accepted-quotation inventory reservations. |
| Projects | Installation project list/detail workflows and project tracking foundation. |
| B2B/Direct Sales | Project-free product and bulk sales to B2B/Direct customers, including sale orders, proforma invoice creation, dispatch-driven stock-out, and payment receipt tracking. |
| Products & Materials | Product master, categories, category-scoped product types, shared catalog library support, and admin-only product pricing. |
| BOM Templates | Tenant BOM template and line foundations used by quotation BOM generation features. |
| Inventory | Inventory items, inventory detail, available/reserved stock status, reservations, received batch history, and transaction foundations. |
| Vendors | Vendor list/detail foundations. |
| Purchases | Purchase orders, pricing-restricted totals, generated PO PDFs, partial stock receiving, and batch creation. |
| Proforma Invoices | Pre-payment proforma invoice creation for project, B2B, and manual customer billing, payment receipt tracking, final invoice conversion, and PI PDFs. |
| Invoices | Project-first invoice creation, customer-only manual item invoices, B2B sale invoices, proforma-origin final invoices, inventory-linked invoice item selection, and PDF-related components. |
| Payments | Payment list/detail foundations, project payment summary support, proforma invoice receipts, and B2B invoice payment receipts. |
| Documents | Document metadata, generated PDF support, and storage-aware document handling. |
| Reports | Reporting page and report API foundation. |
| Settings | Organization settings, branding, and access-related settings foundation. |
| Users, Permissions, Companies, Domains | Tenant/platform administration foundations. |
| EPC Companies | Super-admin company onboarding screen for creating tenant workspaces and first admin profiles. |
| EPC Admin Invite Activation | Supabase invite email activation for EPC company admins, linked through Supabase Auth and `users_profile`. |

## Access And Permissions

- Users authenticate through Supabase.
- Supabase RLS is the security boundary for tenant and permission enforcement.
- UI navigation can hide unavailable modules, but backend policies must still
  prevent unauthorized reads and writes.
- Platform-only areas must remain clearly separated from tenant user workflows.
- Super admins can add EPC company workspaces through the platform Companies
  page. That workflow creates the organization, settings row, default Admin
  role, role permissions, and first admin profile.
- EPC company admins activate their own accounts from the Supabase invite email
  sent during platform onboarding. The invite opens `/create-password`, where
  the admin sets a password and `sync_auth_user_profile` links the Auth user to
  the invited profile.

## Documentation Boundary

When adding functionality, update this document only after the behavior exists
or after a product decision explicitly approves the functionality. Do not use
this file to silently expand scope.
