# QA Testing Plan

The previous QA seed dataset has been retired. Do not use company-specific
dummy workflow data for default testing.

## Current Test Data Approach

- Run the default migrations and `supabase/seed.sql` for structural modules and
  permissions.
- Create tenant test data through the app UI.
- Use Product Master to create categories, product types, and products before
  creating inventory items.
- Create inventory items by selecting Product Master products; manage minimum
  stock alerts in Inventory.

## Inventory Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Product setup | Create a product with category, product type, unit, GST, brand, and model/specifications. | Product appears in Product Master and can be selected from Inventory. |
| Product pricing | As an admin with `product_pricing:update`, edit purchase price, selling price, GST, and effective date from Product Detail. | Current price updates and a price history row is recorded. |
| Staff price visibility | As a user without `product_pricing:view`, inspect Product Master, Inventory, Purchase list, and Purchase detail. | Purchase price, selling price, unit cost, and PO totals are not visible. |
| Inventory create | Create inventory from an active Product Master product. | Inventory row links to the product and shows derived category/product metadata. |
| Inventory minimum stock | Set minimum stock on the inventory item. | Low-stock warnings use the inventory minimum stock value. |
| Inventory batches | Receive stock against a purchase order, then open inventory detail. | Received batch history appears; unit cost appears only for pricing users. |
| Inventory duplicate guard | Try to create a second active inventory item for the same product. | Save is blocked. |
| Product Master | Inspect product create/edit/detail screens. | Product Master does not show or submit minimum stock fields. |
| Reservations | Accept a quotation whose BOM uses Product Master products. | Reservations find inventory through `catalog_product_id`. |
| Partial receiving | Receive only part of a purchase order line. | Stock increases by the received quantity, line received quantity updates, and PO status becomes partially received. |
| Historical cost | Change current Product Master price after receiving stock. | Existing purchase order line and inventory batch actual unit cost remain unchanged. |
| Receive price update | Receive stock with "update current Product Master purchase price" selected. | Product current purchase price changes and history source is recorded as purchase receive. |

## Customer Segment Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Project customer | Create a customer under Project Based Customers or convert a lead. | Customer saves with `customer_segment = 'project_based'` and appears in installation workflow customer pickers. |
| B2B/Direct customer | Create or edit a B2B/Direct customer with subtype `b2b_installer`, `retailer`, or `distributor`. | Customer saves with `customer_segment = 'b2b_direct'` and appears in B2B/Direct Sales customer selection. |
| Segment isolation | Open project, quotation, and site survey customer selectors. | B2B/Direct customers do not appear in installation workflow selectors. |
| Detail actions | Open a B2B/Direct customer detail page. | Create Sale, View Sales, View Invoices, and View Payments actions appear according to permissions. |

## B2B/Direct Sales Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Sale create | Create a B2B/Direct sale with multiple active inventory products. | Sale is saved as draft with item snapshots and calculated totals. |
| Pricing access | Create a B2B/Direct sale as a user without `product_pricing:view`. | Product selling prices are not prefilled, but manual unit price entry works. |
| Confirm sale | Confirm a draft B2B/Direct sale. | Sale status changes to confirmed and remains editable only through allowed actions. |
| Dispatch stock | Dispatch a confirmed B2B/Direct sale. | Inventory creates one `stock_out` transaction per item and stock decreases once. |
| Duplicate dispatch | Try to dispatch an already dispatched B2B/Direct sale. | Dispatch is blocked and stock is not reduced again. |
| Stock shortage | Dispatch a sale whose quantity exceeds available stock after reservations. | Dispatch is blocked with an out-of-stock warning. |
| Proforma creation | Create a proforma invoice from a B2B/Direct sale. | A linked PI is created with matching item rows and `b2b_sale_id`. |
| B2B/Direct payment | Record partial and full payments from the B2B/Direct sale or PI detail page. | Payments link to the sale/PI and PI balance/status recalculates. |
| Final invoice creation | Fully pay the linked PI, then create the final invoice. | A final invoice is created with copied item snapshots and links to the PI and B2B sale. |
| Project isolation | Create, proforma, pay, invoice, and dispatch a B2B/Direct sale. | No project record is created or required. |

## Proforma Invoice Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Project PI | Create a proforma invoice for a project customer with linked project/quotation items. | PI saves with calculated totals and can generate a PI PDF. |
| Manual PI | Create a customer-only proforma invoice with inventory-linked items. | PI saves without requiring a project or B2B sale. |
| Partial payment | Record a partial received payment against a PI. | PI status becomes `partially_paid` and balance decreases. |
| Full payment | Record received payments covering the PI total. | PI status becomes `paid` and the Create Invoice action becomes available. |
| Conversion guard | Try to create a final invoice from an unpaid, cancelled, or already converted PI. | Conversion is blocked and no duplicate final invoice is created. |
| PDF storage | Generate and regenerate a PI PDF. | A `proforma_invoice_pdf` document is stored and preview opens from the PI detail page. |
