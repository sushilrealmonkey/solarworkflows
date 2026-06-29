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
| B2B sales | `b2b_sales`, `b2b_sale_items` |
| Quotations | `quotations`, `quotation_items`, payment terms, warranties, BOM items |
| Products and BOM | `product_categories`, `products`, `bom_templates`, `bom_template_lines` |
| Inventory and procurement | `inventory_items`, `inventory_transactions`, `inventory_reservations`, `inventory_batches`, vendors, purchase orders, purchase order items |
| Finance | `payments`, `project_payment_summary`, proforma invoices, invoices, invoice items |
| Documents and storage metadata | `documents`, generated PDF support for quotations, proforma invoices, invoices, and purchase orders, organization document storage |
| Reporting and system support | dashboard/report foundations, activity logs, notifications, system settings |
| Catalog library | Shared admin-managed catalog defaults for categories, product types, and brands |

Proforma invoices are separate pre-payment finance records. They use
`proforma_invoices` and `proforma_invoice_items`, carry both `company_id` and
`organization_id`, and can link to a project, quotation, B2B sale, or manual
customer billing context. Payments can link to `payments.proforma_invoice_id`;
after the proforma is fully paid, `create_invoice_from_proforma_invoice`
copies item snapshots into the official `invoices` ledger and records the
trace through `invoices.proforma_invoice_id`.

Invoice records currently use nullable `project_id`, `quotation_id`, and
`b2b_sale_id` links so the UI can support project invoices, B2B sale invoices,
and customer-only manual item invoices without adding separate official invoice
tables.

Invoice line items can optionally link to `inventory_items` through
`invoice_items.inventory_item_id`. The invoice line still stores item name,
unit, price, GST, and description snapshots so historical invoices remain
stable if inventory metadata changes later. This link is for item selection and
traceability only; it does not introduce stock movement.

Customers are split by `customers.customer_segment`: `project_based` customers
belong to solar installation workflows, while `b2b_direct` customers are
installers, retailers, or direct buyers for project-free product sales.
`customers.customer_type` remains the subtype field for project-based customers;
B2B/Direct customers are normalized to the internal `b2b_installer` subtype and
do not carry `assigned_to`.

B2B/Direct product sales use `b2b_sales` and `b2b_sale_items` for project-free
sales to B2B/Direct customers. These tables carry both `company_id` and
`organization_id`: `company_id` satisfies the future business-table rule, while
`organization_id` keeps compatibility with current customer, inventory,
invoice, and payment tables. A B2B/Direct sale can generate one linked
proforma invoice through `b2b_sales.proforma_invoice_id`; after payment, the
final invoice links through `invoices.b2b_sale_id` and
`invoices.proforma_invoice_id`. B2B payments can link to the sale, proforma
invoice, and final invoice through `payments.b2b_sale_id`,
`payments.proforma_invoice_id`, and `payments.invoice_id`.

B2B sales also store customer snapshot fields on the sale record:
`billing_address`, `delivery_address`, and `gst_number`. These values preserve
the billing context used for the sale and for generated proforma PDFs even if
customer profile data changes later.

B2B sale items and proforma invoice items support line-level
`discount_amount`. The database constrains discounts to non-negative values,
caps effective discounts at the line gross amount in defaulting triggers, and
calculates line totals after discount. `create_proforma_invoice_from_b2b_sale`
copies the sale item discount snapshots into `proforma_invoice_items` so the
proforma totals match the originating B2B sale.

B2B stock movement happens only when a confirmed sale is dispatched. Dispatch
creates `stock_out` rows in `inventory_transactions` with
`reference_type = 'b2b_sale'`; draft, confirmed, and invoiced sales do not
directly reduce `inventory_items.current_stock`.

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

Generated quotation, proforma invoice, invoice, and purchase order PDFs are
stored through the same `documents` metadata and organization document storage
flow. Quotation detail pages use `quotation_pdf` documents for stored previews
and downloads. Because PO PDFs include price-bearing purchase totals, generation
requires both `documents:create` and purchase pricing visibility.

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
