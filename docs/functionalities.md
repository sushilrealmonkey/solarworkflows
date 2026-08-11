# Functionalities

This document summarizes the current and intended functional areas visible in
the repository. It does not approve new business logic by itself.

## Current Module Areas

| Area | Current intent |
| --- | --- |
| Dashboard | Tenant-aware overview and operational widgets; super admins see EPC-level platform metrics and recent activity. |
| Bizlee AI (Assistant) | Pro-only tenant `/today` screen with a daily brief (prioritized cards, record links, and prompts, cached per user/day) and streaming data chat. Both Edge Functions call OpenAI through a fixed read-only tool layer under the caller JWT; RLS and server-side plan checks govern access. Super admins are excluded. |
| CRM | Nested Project Based and B2B/Direct customer lists, enquiry list/detail workflows, customer details, follow-ups, universal record titles, and next-step workflow actions. |
| Site Surveys | Site survey list/detail workflows, survey records, customer/enquiry links, status updates, and quotation/project next-step actions. |
| Quotations | Quotation list/detail/create/edit workflows, proposal fields, discounts, payment terms, warranties, stored PDFs, BOM-related data, and accepted-quotation inventory reservations. |
| Projects | Installation project list/detail workflows, payment/document/invoice/material panels, universal record titles, and project tracking foundation. |
| B2B/Direct Sales | Project-free product and bulk sales to B2B/Direct customers, including sale orders, item discounts, customer billing/delivery snapshots, proforma invoice creation, dispatch-driven stock-out, and payment receipt tracking. |
| Products & Materials | Product master, categories, category-scoped product types, shared catalog library support, and admin-only product pricing. |
| BOM Templates | Routed tenant list/detail workspace under Product & Materials for reusable product-and-quantity rules used by quotation BOM generation. |
| Inventory | Inventory items, inventory detail, available/reserved stock status, reservations, received batch history, and transaction foundations. |
| Vendors | Vendor list/detail foundations. |
| Purchases | Purchase orders, pricing-restricted totals, generated PO PDFs, partial stock receiving, and batch creation. |
| Proforma Invoices | Pre-payment proforma invoice creation for project, B2B, and manual customer billing, payment receipt tracking, final invoice conversion, and PI PDFs. |
| Invoices | Project-first invoice creation, customer-only manual item invoices, B2B sale invoices, proforma-origin final invoices, inventory-linked invoice item selection, and PDF-related components. |
| Payments | Payment list/detail foundations, project payment summary support, proforma invoice receipts, and B2B invoice payment receipts. |
| Documents | Document metadata, generated PDF support for quotations, proforma invoices, invoices, and purchase orders, and storage-aware document handling. |
| Reports | Reporting page and report API foundation. |
| Settings | Tenant organization, branding, notification, billing invoice, staff, access, and subscription settings; super admins see platform controls. |
| Users, Permissions, Companies, Domains | Tenant/platform administration, platform-staff invitations, standard roles, and permission management. |
| EPC Companies | Super-admin company management console for creating tenant workspaces, inviting first admins, tracking setup, managing workspace/admin status, editing company profile fields, reviewing a route-backed detail page, and guarded setup-only deletion. |
| EPC Admin Invite Activation | Supabase invite email activation for EPC company admins, linked through Supabase Auth and `users_profile`. |
| Subscriptions & Billing | Full-feature trials, monthly/yearly Bizlee Core and Pro plans, Razorpay checkout/webhooks/cancellation, GST subscription invoices, plan badges, read-only history, and Core seat enforcement. |
| Notifications | Tenant-scoped in-app notifications, unread state, optional Expo push delivery, and opt-in WhatsApp lifecycle/daily-summary notifications. |
| Mobile App | Expo tenant workspace with auth/enrollment, branded home/dashboard, record search/detail, customer and enquiry creation, notifications, deep links, and push registration through `/api/mobile/v1`. |
| WhatsApp Operations | Super-admin outreach inbox/campaign workspace plus tenant notification delivery and administrator alerts for customer replies. |

## Access And Permissions

- Users authenticate through Supabase.
- Supabase RLS is the security boundary for tenant and permission enforcement.
- UI navigation can hide unavailable modules, but backend policies must still
  prevent unauthorized reads and writes.
- Role permissions and plan access intersect. `read_only` allows historical
  reads but blocks writes and workflow actions; `locked` blocks module access.
- Bizlee Core provides full solar-project workflows, a three-seat limit, and
  read-only commercial history. Bizlee Pro provides full configured access and
  unlimited seats. Trials and grandfathered subscriptions receive full access.
- Platform-only areas must remain clearly separated from tenant user workflows.
- Super admins land on `/dashboard` and only see platform navigation:
  Dashboard, EPC Companies, and Settings. Tenant operational routes redirect
  super admins back to the platform area.
- Super admins can add EPC company workspaces through the platform Companies
  page. That workflow creates the organization, settings row, default Admin
  role, role permissions, and first admin profile.
- Verified email/password or Google users without tenant access are routed to
  `/onboarding`. They can create one EPC workspace; the transactional setup
  creates linked company and organization records, seeds the locked standard
  roles, and assigns the creator the Admin role.
- Super admins can resend admin setup links and mark EPC workspaces or primary
  admin profiles active/inactive from the EPC Companies page.
- Super admins can open `/companies/:id` to review full EPC company details,
  edit company/admin profile fields, review activity metrics, see Phase 2
  subscription placeholders, and perform guarded delete. Guarded delete only
  succeeds for setup-only companies; companies with operational records should
  be marked inactive instead.
- EPC company admins activate their own accounts from the Supabase invite email
  sent during platform onboarding. The invite opens `/create-password`, where
  the admin sets a password and `sync_auth_user_profile` links the Auth user to
  the invited profile.
- Every authenticated dashboard user has a shared Logout button in the shell
  header. Logout calls Supabase `auth.signOut()` and returns the user to
  `/login`.
- Workflow detail pages use a shared record-title format only where implemented:
  record type, customer/site name, and `record code / related record / status /
  phone` metadata. This is currently applied to Enquiry, Site Survey,
  Quotation, Customer, and Project detail pages.

## Documentation Boundary

When adding functionality, update this document only after the behavior exists
or after a product decision explicitly approves the functionality. Do not use
this file to silently expand scope.
