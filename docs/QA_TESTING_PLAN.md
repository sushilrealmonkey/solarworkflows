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
