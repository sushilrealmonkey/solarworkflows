# Project Vision

SolarWorkflows should become a dependable SaaS workspace for solar businesses
to manage customers, leads, surveys, quotations, installations, inventory,
procurement, billing, payments, documents, reporting, and team access from one
tenant-isolated platform.

## Product Principles

- Tenant isolation is a product feature, not only a technical requirement.
- Solar operations should feel organized, traceable, and easy to run on mobile.
- Platform administration should support many companies without leaking data
  between tenants.
- Permissions must be enforced in Supabase RLS; UI hiding is only a usability
  layer.
- Business rules should be introduced deliberately and documented when they
  become real implementation decisions.

## Experience Goals

- Mobile-first workflows for field, sales, finance, inventory, and admin users.
- Clear module navigation with consistent list, detail, create, and edit
  patterns.
- Reliable document and PDF handling for quotations, invoices, customer files,
  and operational records.
- Audit-friendly records that can explain who changed what and when.
- A developer experience where each module is easy to locate, test, and extend.

## Long-Term Direction

The platform can grow into an operational system of record for solar companies.
Future modules should connect naturally, but they should not bypass the core
rules: tenant ownership, RLS, TypeScript, Supabase-backed data, and modular code.
