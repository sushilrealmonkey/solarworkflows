# Functionalities

This document summarizes the current and intended functional areas visible in
the repository. It does not approve new business logic by itself.

## Current Module Areas

| Area | Current intent |
| --- | --- |
| Dashboard | Tenant-aware overview and operational widgets. |
| CRM | Customers, leads, lead details, customer details, and follow-ups. |
| Site Surveys | Site survey list/detail workflows and survey records. |
| Quotations | Quotation list/detail/create workflows, proposal fields, payment terms, warranties, PDFs, BOM-related data, and accepted-quotation inventory reservations. |
| Projects | Installation project list/detail workflows and project tracking foundation. |
| Products & Materials | Product master, categories, category-scoped product types, shared catalog library support, and admin-only product pricing. |
| BOM Templates | Tenant BOM template and line foundations used by quotation BOM generation features. |
| Inventory | Inventory items, inventory detail, available/reserved stock status, reservations, received batch history, and transaction foundations. |
| Vendors | Vendor list/detail foundations. |
| Purchases | Purchase orders, pricing-restricted totals, partial stock receiving, and batch creation. |
| Invoices | Project-first invoice creation, customer-only manual item invoices, invoice items, and PDF-related components. |
| Payments | Payment list/detail foundations and project payment summary support. |
| Documents | Document metadata, generated PDF support, and storage-aware document handling. |
| Reports | Reporting page and report API foundation. |
| Settings | Organization settings, branding, and access-related settings foundation. |
| Users, Permissions, Companies, Domains | Tenant/platform administration foundations. |

## Access And Permissions

- Users authenticate through Supabase.
- Supabase RLS is the security boundary for tenant and permission enforcement.
- UI navigation can hide unavailable modules, but backend policies must still
  prevent unauthorized reads and writes.
- Platform-only areas must remain clearly separated from tenant user workflows.

## Documentation Boundary

When adding functionality, update this document only after the behavior exists
or after a product decision explicitly approves the functionality. Do not use
this file to silently expand scope.
