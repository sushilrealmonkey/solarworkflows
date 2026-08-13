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
| Universal title | Open Enquiry, Site Survey, Quotation, Customer, and Project detail pages. | Each page shows record type, customer/site name, and code/related record/status/phone metadata without layout overlap on mobile. |

## B2B/Direct Sales Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Sale create | Create a B2B/Direct sale with multiple active inventory products. | Sale is saved as draft with item snapshots and calculated totals. |
| Customer snapshots | Create a B2B/Direct sale from a customer with billing address, delivery address, and GST number values. | The sale stores the billing/delivery/GST snapshot values and generated proforma context uses those values. |
| Item discount | Add a line-level discount to a B2B/Direct sale item. | Line total and sale totals subtract the discount before GST, and negative discounts are blocked. |
| Pricing access | Create a B2B/Direct sale as a user without `product_pricing:view`. | Product selling prices are not prefilled, but manual unit price entry works. |
| Confirm sale | Confirm a draft B2B/Direct sale. | Sale status changes to confirmed and remains editable only through allowed actions. |
| Dispatch stock | Dispatch a confirmed B2B/Direct sale. | Inventory creates one `stock_out` transaction per item and stock decreases once. |
| Duplicate dispatch | Try to dispatch an already dispatched B2B/Direct sale. | Dispatch is blocked and stock is not reduced again. |
| Stock shortage | Dispatch a sale whose quantity exceeds available stock after reservations. | Dispatch is blocked with an out-of-stock warning. |
| Proforma creation | Create a proforma invoice from a B2B/Direct sale. | A linked PI is created with matching item rows, copied item discounts, and `b2b_sale_id`. |
| B2B/Direct payment | Record partial and full payments from the B2B/Direct sale or PI detail page. | Payments link to the sale/PI and PI balance/status recalculates. |
| Final invoice creation | Fully pay the linked PI, then create the final invoice. | A final invoice is created with copied item snapshots and links to the PI and B2B sale. |
| Project isolation | Create, proforma, pay, invoice, and dispatch a B2B/Direct sale. | No project record is created or required. |

## Proforma Invoice Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Project PI | Create a proforma invoice for a project customer with linked project/quotation items. | PI saves with calculated totals and can generate a PI PDF. |
| Manual PI | Create a customer-only proforma invoice with inventory-linked items. | PI saves without requiring a project or B2B sale. |
| PI item discount | Create or generate a PI with item-level discounts. | PI item totals and PDF totals reflect discounts before GST. |
| Partial payment | Record a partial received payment against a PI. | PI status becomes `partially_paid` and balance decreases. |
| Full payment | Record received payments covering the PI total. | PI status becomes `paid` and the Create Invoice action becomes available. |
| Conversion guard | Try to create a final invoice from an unpaid, cancelled, or already converted PI. | Conversion is blocked and no duplicate final invoice is created. |
| PDF storage | Generate and regenerate a PI PDF. | A `proforma_invoice_pdf` document is stored and preview opens from the PI detail page. |

## Quotation Validation

| Area | Scenario | Expected Result |
| --- | --- | --- |
| Quotation PDF storage | Open a quotation detail page with `documents:create` access and no existing stored PDF. | A quotation PDF is generated, stored as a `quotation_pdf` document, and exposed as a download/preview action. |
| Quotation PDF reuse | Reopen the same quotation detail page after a PDF exists. | The stored PDF preview URL is reused rather than creating a duplicate document. |
| Quotation discount totals | Enter a turnkey discount on a quotation. | Taxable amount, GST, total, detail view, and PDF summary use the discounted turnkey calculation consistently. |

## Subscription And Plan Validation

| Scenario | Action | Expected result |
| --- | --- | --- |
| Trial access | Use a tenant with an unexpired trial. | All configured modules and Bizlee AI are available, subject to role permissions. |
| Core catalogue | Open Billing & Plans. | Core shows ₹899 monthly, ₹9,889 yearly, and three total seats; Pro shows ₹1,499 monthly, ₹16,489 yearly, and unlimited seats. |
| Core full modules | As a Core user, create/update a project-based customer, enquiry, survey, BOM template, quotation, project, or project payment. | The action succeeds only when the user's role also grants it. |
| Core read-only history | Open B2B sales, inventory, vendors, purchases, proformas, or invoices. | A read-only upgrade dialog appears; choosing history shows records with write, delete, export, PDF, dispatch, and receive actions disabled. |
| Core capability guard | Attempt a direct API/database write for a B2B customer, commercial payment, commercial document, or inventory operation. | Database enforcement rejects the write even if the UI is bypassed. |
| Core quotation acceptance | Accept a quotation on Core. | The quotation and project progress, but no Pro-only inventory reservation is created. |
| Pro access | Repeat the commercial flows on Pro with suitable RBAC. | Full module and capability actions succeed. |
| AI plan guard | Call both assistant Edge Functions on Core and Pro. | Core receives `403`; Pro succeeds when tenant/profile permissions are valid. |
| Core seat limit | Reach three active/invited profiles, then invite or reactivate another. | The database rejects the fourth occupied seat. Deactivating another user frees a seat and revokes that user's sessions. |
| Core checkout guard | Try selecting Core while more than three seats are occupied. | Checkout/activation is blocked until seats are reduced. |
| Expired subscription | Expire a test subscription. | Known modules remain read-only, writes fail server-side, and AI stays locked. |
| Storage bypass | Request a Pro-source invoice/proforma/PO object directly as Core. | Storage policy denies the download. |

## Mobile Application Validation

| Scenario | Action | Expected result |
| --- | --- | --- |
| Auth and enrollment | Sign in with an existing tenant user and with a verified unassigned user. | Tenant users enter the app; unassigned users can create one workspace through enrollment. |
| Session context | Load the app as users with different roles/plans. | Branding, tenant, roles, action permissions, module/capability access, and seat usage match the web session. |
| Resource reads | Search and open each supported resource. | Lists are tenant/permission scoped and detail routes return only accessible records. |
| Mobile creates | Create a project-based customer and an enquiry. | Valid input creates a tenant-owned row; missing permission, duplicates, and invalid fields return stable request-ID errors. |
| Unsupported create | POST to another resource. | API returns a method/permission error and creates nothing. |
| Notifications | Open notifications and mark one/all read. | Receipt state and unread count update only for the current user. |
| Push registration | Register and revoke a real device, then publish an in-app notification. | An active device queues push delivery; a revoked device does not. |
| Deep links | Open a configured production `/mobile` link. | The correct installed environment opens without crossing dev/staging/production package IDs. |

## Notifications And Integration Validation

| Scenario | Action | Expected result |
| --- | --- | --- |
| WhatsApp reply alert | Receive a customer reply mapped to a tenant conversation. | The reply is persisted once and eligible tenant administrators receive the configured reply alert; webhook retries do not duplicate it. |
| Notification privacy | Generate a requested daily summary. | Only bounded aggregate counts reach OpenAI/WhatsApp; customer names, phone numbers, raw notes, and amounts are absent. |
| Subsidy pricing | Create or recalculate quotation/project payment records with subsidy. | Subsidy remains informational and pricing totals stay consistent across quotation, project, and payment views. |
# Record-scoped role acceptance

- Test all five standard roles in two companies and on Core and Pro.
- Verify Sales ownership loss immediately after reassignment.
- Verify Backend has operational queues but cannot mutate finance.
- Verify Accounts can manage finance but cannot mutate operations or stock.
- Verify Field Staff sees only assigned surveys and assigned/released projects.
- Verify only the two allowed forward transitions appear and succeed.
- Attempt protected-column updates through REST; all must fail.
- Verify another assignee's survey evidence cannot be read, changed, or deleted.
- Verify Field project details generate no finance, invoice, document, inventory,
  quotation, export, archive, restore, or delete requests.
- Verify inactive profiles, removed assignments, archived rows, simultaneous
  transitions, and cross-company assignment attempts.
- Run `record_scoped_roles_test.sql`, Supabase Security Advisor, Performance
  Advisor, and representative `EXPLAIN (ANALYZE, BUFFERS)` checks before release.
