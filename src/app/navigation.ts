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
  navigationRoute("/dashboard"),
  navigationRoute("/companies"),
  {
    label: "Project Sales",
    path: "/project-sales",
    children: [
      navigationRoute("/leads"),
      navigationRoute("/site-surveys"),
      navigationRoute("/quotations"),
      navigationRoute("/customers/project-based"),
      navigationRoute("/projects"),
    ],
  },
  {
    label: "Product Sales",
    path: "/product-sales",
    children: [
      navigationRoute("/customers/b2b-direct"),
      navigationRoute("/b2b-sales"),
      navigationRoute("/proforma-invoices"),
      navigationRoute("/payments"),
      navigationRoute("/invoices"),
    ],
  },
  {
    label: "Purchasing & Stock",
    path: "/stock-purchasing",
    children: [
      navigationRoute("/vendors"),
      navigationRoute("/purchases"),
      navigationRoute("/material-receive"),
      navigationRoute("/inventory"),
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
  navigationRoute("/settings"),
];
