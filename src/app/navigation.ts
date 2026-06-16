import { routes } from "./routes";

export type NavigationItem = {
  label: string;
  path: string;
  moduleKey?: string;
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
    superAdminOnly: route.superAdminOnly,
  };
}

export const navigationItems: NavigationItem[] = [
  {
    label: "Platform",
    path: "/platform",
    superAdminOnly: true,
    children: [navigationRoute("/companies")],
  },
  navigationRoute("/dashboard"),
  {
    label: "Sales",
    path: "/sales",
    children: [
      navigationRoute("/leads"),
      navigationRoute("/customers/project-based"),
      navigationRoute("/customers/b2b-direct"),
      navigationRoute("/quotations"),
      navigationRoute("/b2b-sales"),
    ],
  },
  {
    label: "Projects",
    path: "/projects-workflow",
    children: [
      navigationRoute("/site-surveys"),
      navigationRoute("/projects"),
    ],
  },
  {
    label: "Stock & Purchasing",
    path: "/stock-purchasing",
    children: [
      navigationRoute("/products-materials/products"),
      navigationRoute("/products-materials/categories"),
      navigationRoute("/products-materials/catalog-library"),
      navigationRoute("/inventory"),
      navigationRoute("/vendors"),
      navigationRoute("/purchases"),
    ],
  },
  {
    label: "Finance",
    path: "/finance",
    children: [
      navigationRoute("/proforma-invoices"),
      navigationRoute("/invoices"),
      navigationRoute("/payments"),
    ],
  },
  navigationRoute("/reports"),
  navigationRoute("/settings"),
];

export const platformNavigationItems = navigationItems.filter(
  (item) => item.superAdminOnly,
);
