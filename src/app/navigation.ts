import { routes } from "./routes";

export type NavigationItem = {
  label: string;
  path: string;
  moduleKey: string;
  superAdminOnly?: boolean;
  children?: NavigationItem[];
};

const productRoutes = routes.filter((route) =>
  route.path.startsWith("/products-materials/"),
);

export const navigationItems: NavigationItem[] = routes.reduce<
  NavigationItem[]
>((items, route) => {
  if (route.path === "/products-materials/products") {
    items.push({
      label: "Products & Materials",
      path: "/products-materials/products",
      moduleKey: "product_master",
      children: productRoutes.map((productRoute) => ({
        label: productRoute.label,
        path: productRoute.path,
        moduleKey: productRoute.moduleKey,
        superAdminOnly: productRoute.superAdminOnly,
      })),
    });
    return items;
  }

  if (route.path.startsWith("/products-materials/")) {
    return items;
  }

  items.push({
    label: route.label,
    path: route.path,
    moduleKey: route.moduleKey,
    superAdminOnly: route.superAdminOnly,
  });

  return items;
}, []);
