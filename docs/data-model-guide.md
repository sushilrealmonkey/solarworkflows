# Data Model Guide

SolarWorkflows uses Supabase Postgres migrations under `supabase/migrations`.
This guide summarizes the current data model families and tenant ownership
rules so future changes stay consistent.

## Tenant Ownership

The repository contains three ownership names because the schema evolved over
time:

- `company_id`: Required by the project rules for future business tables.
- `organization_id`: Used by many current module tables and helpers.
- `tenant_id`: Used by several product, BOM, quotation-support, and catalog
  tables.

Do not add another ownership name. When editing an existing table, keep the
table's current ownership convention unless a planned migration normalizes it.
When adding a new business table, use `company_id` unless the user approves a
specific compatibility exception.

## Current Table Families

| Family | Examples |
| --- | --- |
| Platform and tenant foundation | `platform_admins`, `companies`, `organizations`, settings, domains, profiles, users profile |
| Access control | `modules`, `permissions`, `roles`, `role_permissions`, `user_roles` |
| CRM | `customers`, `leads`, `lead_followups` |
| Field operations | `site_surveys`, `projects` |
| Quotations | `quotations`, `quotation_items`, payment terms, warranties, BOM items |
| Products and BOM | `product_categories`, `product_types`, `products`, `bom_templates`, `bom_template_lines` |
| Inventory and procurement | `inventory_items`, `inventory_transactions`, `inventory_reservations`, `inventory_batches`, vendors, purchase orders, purchase order items |
| Finance | `payments`, `project_payment_summary`, invoices, invoice items |
| Documents and storage metadata | `documents`, generated PDF support, organization document storage |
| Reporting and system support | dashboard/report foundations, activity logs, notifications, system settings |
| Catalog library | Shared admin-managed catalog defaults for categories, product types, and brands |

Invoice records currently use nullable `project_id` and `quotation_id` links so
the UI can support both project-first invoices and customer-only manual item
invoices without adding a separate invoice table.

Inventory reservations are soft operational holds created when a quotation is
accepted. `inventory_reservations` carries both `company_id` and
`organization_id`: `company_id` follows the future business-table rule, while
`organization_id` keeps compatibility with the existing quotation and inventory
tables. Physical stock remains in `inventory_items.current_stock`; availability
is calculated from current stock minus active/partial reservation quantities.

Inventory items now link to Product Master through
`inventory_items.catalog_product_id`. Product Master owns product, category,
product type, brand/model, HSN, GST, and pricing metadata. Inventory owns stock
quantities, ledger transactions, reservations, opening stock, and minimum stock
alert thresholds. Legacy inventory master columns/tables may remain for older
rows, but new inventory records should use Product Master products.

Product purchase and selling prices are admin-only data. Current prices live in
`product_prices`, while `product_price_history` records each manual or purchase
receiving change. Legacy `products.purchase_price`, `products.selling_price`,
`inventory_items.purchase_price`, and `inventory_items.selling_price` remain for
schema compatibility only and must not be selected, displayed, or updated by new
application code.

Actual received purchase cost is stored per stock lot in `inventory_batches`.
Purchase receiving can be partial; `purchase_order_items.received_quantity`
tracks line progress, and each received batch stores the actual unit purchase
price, GST, bill number, vendor, and received date. Normal inventory staff access
batch history through staff-safe RPCs that omit cost fields unless the user has
`product_pricing:view`.

## RLS Expectations

- Enable RLS on tenant-accessible tables.
- Policies must compare the row's tenant owner to the current user's tenant.
- Permission checks should use approved helper functions and module/action keys.
- DELETE policies must require delete permission.
- Views, RPCs, and storage policies require the same tenant isolation review as
  tables.

## Seed Data

- `supabase/seed.sql` is the default seed file.
- `supabase/seed.qa.sql` is currently a no-op stub. The previous QA dummy
  workflow dataset was retired; create tenant test data through the app UI.

## Change Checklist

Before adding or changing data structures:

- Identify the tenant owner column.
- Confirm RLS policies for select, insert, update, and delete.
- Confirm related records cannot cross tenants.
- Add or update indexes for tenant-scoped lookups.
- Update this guide and the changelog when the model changes.
