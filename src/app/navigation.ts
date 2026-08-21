import { routes } from "./routes";
import type { PlanAccessLevel } from "../modules/billing/types";

export type NavigationItem = {
  label: string;
  path: string;
  moduleKey?: string;
  planModuleKey?: string;
  planAccess?: PlanAccessLevel;
  superAdminOnly?: boolean;
  children?: NavigationItem[];
};

const routeByPath = new Map(routes.map((route) => [route.path, route]));

function navigationRoute(path: string): NavigationItem {
  const route = routeByPath.get(path);

  if (!route) {
    throw new Error(`Missing navigation route: ${path}`);
  }

  return {
    label: route.label,
    path: route.path,
    moduleKey: route.moduleKey,
    planModuleKey: planModuleKey(path, route.moduleKey),
    superAdminOnly: route.superAdminOnly,
  };
}

function planModuleKey(path: string, fallback: string) {
  const overrides: Record<string, string> = {
    "/today": "assistant",
    "/customers/b2b-direct": "b2b_sales",
    "/b2b-sales": "b2b_sales",
    "/inventory": "inventory",
    "/vendors": "vendors",
    "/purchases": "purchases",
    "/proforma-invoices": "invoices",
    "/invoices": "invoices",
  };

  return overrides[path] ?? fallback;
}

export const navigationItems: NavigationItem[] = [
  navigationRoute("/today"),
  navigationRoute("/dashboard"),
  navigationRoute("/companies"),
  {
    label: "Project Sales",
    path: "/project-sales",
    children: [
      navigationRoute("/leads"),
      navigationRoute("/site-surveys"),
      navigationRoute("/quotations"),
      navigationRoute("/projects"),
      navigationRoute("/customers/project-based"),
    ],
  },
  {
    label: "Product Sales",
    path: "/product-sales",
    children: [
      navigationRoute("/customers/b2b-direct"),
      navigationRoute("/b2b-sales"),
    ],
  },
  {
    label: "Invoices & Payments",
    path: "/invoice-payments",
    children: [
      navigationRoute("/proforma-invoices"),
      navigationRoute("/invoices"),
      navigationRoute("/payments"),
    ],
  },
  {
    label: "Purchasing & Stock",
    path: "/stock-purchasing",
    children: [
      navigationRoute("/inventory"),
      navigationRoute("/purchases"),
      navigationRoute("/vendors"),
    ],
  },
  {
    label: "Masters",
    path: "/masters",
    children: [
      navigationRoute("/products-materials/products"),
      navigationRoute("/products-materials/categories"),
    ],
  },
  navigationRoute("/settings"),
];

export const platformNavigationItems = [
  navigationRoute("/dashboard"),
  navigationRoute("/companies"),
  navigationRoute("/platform-staff"),
  navigationRoute("/whatsapp-messaging"),
  navigationRoute("/settings"),
  navigationRoute("/billing/plans"),
];
