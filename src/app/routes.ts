export type AppRoute = {
  path: string;
  label: string;
  moduleKey: string;
  description: string;
  superAdminOnly?: boolean;
};

export const routes: AppRoute[] = [
  {
    path: "/companies",
    label: "EPC Companies",
    moduleKey: "companies",
    description: "Super-admin onboarding for solar EPC tenant workspaces and primary admins.",
    superAdminOnly: true,
  },
  {
    path: "/dashboard",
    label: "Dashboard",
    moduleKey: "dashboard",
    description: "A tenant-aware overview for future solar operations metrics.",
  },
  {
    path: "/customers/project-based",
    label: "Project Customers",
    moduleKey: "customers",
    description: "Solar installation customers linked to leads, surveys, quotations, and projects.",
  },
  {
    path: "/customers/b2b-direct",
    label: "B2B/Direct Customers",
    moduleKey: "customers",
    description: "Installer, retailer, and direct product-sale customers.",
  },
  {
    path: "/leads",
    label: "Leads",
    moduleKey: "leads",
    description: "Lead capture, tracking, and conversion workflows will live here.",
  },
  {
    path: "/site-surveys",
    label: "Site Surveys",
    moduleKey: "site_surveys",
    description: "Site inspection planning and survey records will live here.",
  },
  {
    path: "/quotations",
    label: "Quotations",
    moduleKey: "quotations",
    description: "Solar proposal and quotation workflows will live here.",
  },
  {
    path: "/projects",
    label: "Projects",
    moduleKey: "projects",
    description: "Installation projects and delivery tracking will live here.",
  },
  {
    path: "/payments",
    label: "Payments",
    moduleKey: "payments",
    description: "Payment milestones and receipts will live here.",
  },
  {
    path: "/b2b-sales",
    label: "B2B/Direct Sales",
    moduleKey: "b2b_sales",
    description: "Project-free product and bulk sales to B2B/Direct customers.",
  },
  {
    path: "/products-materials/products",
    label: "Products",
    moduleKey: "product_master",
    description: "Central products and materials catalog for inventory, purchases, quotations, projects, and reports.",
  },
  {
    path: "/products-materials/categories",
    label: "Categories",
    moduleKey: "product_master",
    description: "Category master for product grouping, type, display order, and future BOM/reporting workflows.",
  },
  {
    path: "/products-materials/catalog-library",
    label: "Catalog Library",
    moduleKey: "product_master",
    description: "Admin-managed shared default categories, product types, and brand suggestions for tenant catalog setup.",
    superAdminOnly: true,
  },
  {
    path: "/inventory",
    label: "Inventory",
    moduleKey: "inventory",
    description: "Solar stock, equipment, and material tracking will live here.",
  },
  {
    path: "/vendors",
    label: "Vendors",
    moduleKey: "vendors",
    description: "Vendor records and procurement contacts will live here.",
  },
  {
    path: "/purchases",
    label: "Purchases",
    moduleKey: "inventory",
    description: "Purchase orders and stock receiving workflows will live here.",
  },
  {
    path: "/invoices",
    label: "Invoices",
    moduleKey: "invoices",
    description: "Invoice generation and billing status will live here.",
  },
  {
    path: "/proforma-invoices",
    label: "Proforma Invoices",
    moduleKey: "invoices",
    description: "Pre-payment proforma invoices and conversion to final invoices.",
  },
  {
    path: "/reports",
    label: "Reports",
    moduleKey: "reports",
    description: "Operational reporting and audit-aware insights will live here.",
  },
  {
    path: "/settings",
    label: "Settings",
    moduleKey: "settings",
    description: "Organization preferences, branding, and access settings will live here.",
  },
];
