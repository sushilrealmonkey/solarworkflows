/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
import { useMemo, useState, type CSSProperties, type FocusEvent } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  navigationItems,
  platformNavigationItems,
  type NavigationItem,
} from "../app/navigation";
import { isPlatformPath } from "../app/redirects";
import { useAuth } from "../app/AuthProvider";
import { PortalLogo, PortalLogoIcon } from "../components/PortalBrand";

const linkBase =
  "group flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";

export function DashboardLayout() {
  const { profile, permissions, organization, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const visibleNavigationItems = useMemo<NavigationItem[]>(() => {
    if (profile?.is_super_admin) {
      return platformNavigationItems;
    }

    const viewableModules = new Set(
      permissions
        .filter((permission) => permission.actionKey === "view")
        .map((permission) => permission.moduleKey),
    );

    return navigationItems.reduce<NavigationItem[]>((items, item) => {
        if (item.superAdminOnly) {
          return items;
        }

        const children = item.children?.filter(
          (child) =>
            !child.superAdminOnly &&
            Boolean(child.moduleKey && viewableModules.has(child.moduleKey)),
        );

        if (item.children && (!children || children.length === 0)) {
          return items;
        }

        if (
          !item.children &&
          (!item.moduleKey || !viewableModules.has(item.moduleKey))
        ) {
          return items;
        }

        items.push({
          ...item,
          children,
        });

        return items;
      }, []);
  }, [permissions, profile?.is_super_admin]);

  if (profile?.is_super_admin && !isPlatformPath(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  const shellStyle = {
    "--org-primary": organization.primaryColor,
    "--org-secondary": organization.secondaryColor,
    "--org-accent": organization.accentColor,
  } as CSSProperties;

  async function handleSignOut() {
    try {
      setIsSigningOut(true);
      setLogoutError(null);
      await signOut();
      setMobileMenuOpen(false);
      setUserMenuOpen(false);
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleUserMenuBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setUserMenuOpen(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#fff8f1] text-slate-950"
      style={shellStyle}
    >
      <aside
        className={`fixed inset-y-0 left-0 hidden flex-col overflow-hidden border-r border-white/10 bg-[#06173f] px-3 py-5 text-white shadow-2xl shadow-slate-950/20 transition-[width] duration-300 lg:flex ${
          sidebarCollapsed ? "w-20" : "w-60"
        }`}
      >
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <ShellBrand collapsed={sidebarCollapsed} />
          <SidebarNavigation
            collapsed={sidebarCollapsed}
            items={visibleNavigationItems}
          />
          <button
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-pressed={sidebarCollapsed}
            className="mt-3 flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-lg border border-white/10 bg-white/10 text-orange-200 transition hover:bg-orange-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
            onClick={() => setSidebarCollapsed((isCollapsed) => !isCollapsed)}
            type="button"
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>
        </div>
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full bg-slate-950/35"
            onClick={() => setMobileMenuOpen(false)}
            type="button"
          />
          <aside className="relative flex h-full w-[min(20rem,86vw)] flex-col overflow-hidden border-r border-white/10 bg-[#06173f] px-4 py-5 text-white shadow-xl">
            <button
              aria-label="Close navigation"
              className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
            >
              <CloseIcon />
            </button>
            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
              <ShellBrand />
              <SidebarNavigation
                items={visibleNavigationItems}
                onNavigate={() => setMobileMenuOpen(false)}
              />
              <MobileSidebarAccount
                isSigningOut={isSigningOut}
                logoutError={logoutError}
                name={profile?.full_name ?? "Workspace user"}
                onSignOut={() => void handleSignOut()}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <div className={`transition-[padding] duration-300 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-30 border-b border-orange-100 bg-white/90 px-4 py-3 shadow-sm shadow-orange-950/5 backdrop-blur sm:px-6 lg:px-8">
          <HeaderWaves />
          <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-950 sm:text-lg">
                  {organization.name}
                </p>
              </div>
            </div>
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-200 bg-white text-orange-700 shadow-sm lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
            >
              <MenuIcon />
            </button>
            <div
              className="relative hidden min-w-0 lg:block"
              onBlur={handleUserMenuBlur}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setUserMenuOpen(false);
                  event.currentTarget.querySelector("button")?.focus();
                }
              }}
            >
              <button
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="flex max-w-56 items-center gap-2 rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 active:bg-orange-100 sm:max-w-72"
                onClick={() => setUserMenuOpen((isOpen) => !isOpen)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-950">
                    {profile?.full_name ?? "Workspace user"}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-xs text-slate-500 transition-transform ${
                    userMenuOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              </button>
              {userMenuOpen ? (
                <div
                  aria-label="User menu"
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-56 rounded-lg border border-stone-200 bg-white p-1.5 shadow-lg"
                  role="menu"
                >
                  <button
                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 active:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSigningOut}
                    onClick={() => void handleSignOut()}
                    role="menuitem"
                    type="button"
                  >
                    {isSigningOut ? "Signing out…" : "Logout"}
                  </button>
                  {logoutError ? (
                    <p className="px-3 py-2 text-xs leading-5 text-rose-700" role="alert">
                      {logoutError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-65px)] w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MobileSidebarAccount({
  isSigningOut,
  logoutError,
  name,
  onSignOut,
}: {
  isSigningOut: boolean;
  logoutError: string | null;
  name: string;
  onSignOut: () => void;
}) {
  return (
    <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
      <p className="truncate px-2 text-sm font-semibold text-white">
        {name}
      </p>
      <button
        className="mt-3 flex w-full items-center justify-center rounded-lg border border-orange-300/40 bg-orange-400 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSigningOut}
        onClick={onSignOut}
        type="button"
      >
        {isSigningOut ? "Signing out..." : "Logout"}
      </button>
      {logoutError ? (
        <p className="mt-2 rounded-lg border border-rose-200/30 bg-rose-500/15 px-3 py-2 text-xs leading-5 text-rose-100" role="alert">
          {logoutError}
        </p>
      ) : null}
    </div>
  );
}

function ShellBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center ${
        collapsed ? "justify-center px-0" : "px-2"
      }`}
    >
      {collapsed ? (
        <PortalLogoIcon className="h-14 w-14 rounded-xl" tone="dark" />
      ) : (
        <PortalLogo className="h-12 w-full max-w-44 object-contain object-left" tone="dark" />
      )}
    </div>
  );
}

function SidebarNavigation({
  collapsed = false,
  items,
  onNavigate,
}: {
  collapsed?: boolean;
  items: NavigationItem[];
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <nav
      className={`sidebar-scroll mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-5 ${
        collapsed ? "" : "pr-1"
      }`}
      aria-label="Primary navigation"
    >
      {items.length > 0 ? (
        items.map((item) => {
          const hasChildren = Boolean(item.children?.length);
          const childIsActive = Boolean(
            item.children?.some((child) =>
              location.pathname.startsWith(child.path),
            ),
          );
          const groupIsActive = childIsActive;
          const isOpen = groupIsActive || openGroups[item.path];

          if (hasChildren) {
            return (
              <div key={item.path}>
                <button
                  className={`${linkBase} w-full ${
                    collapsed ? "justify-center px-2" : "justify-between"
                  } ${
                    groupIsActive
                      ? "bg-orange-400 text-white shadow-lg shadow-orange-950/20"
                      : "text-slate-200 hover:bg-white/10 hover:text-white"
                  }`}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [item.path]: !isOpen,
                    }))
                  }
                  title={collapsed ? item.label : undefined}
                  type="button"
                >
                  <span className={`flex min-w-0 items-center ${collapsed ? "justify-center" : ""}`}>
                    <NavigationIcon item={item} />
                    <span className={`truncate ${collapsed ? "sr-only" : "ml-3"}`}>
                      {item.label}
                    </span>
                  </span>
                  {!collapsed ? (
                    <span aria-hidden="true" className="text-base font-semibold">
                      {isOpen ? "-" : "+"}
                    </span>
                  ) : null}
                </button>
                {isOpen && !collapsed ? (
                  <div className="mt-1 space-y-1 pl-6">
                    {item.children?.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? "bg-orange-400 text-white shadow-lg shadow-orange-950/20"
                              : "text-slate-300 hover:bg-white/10 hover:text-white"
                          }`
                        }
                      >
                        <span className="truncate">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `${linkBase} ${collapsed ? "justify-center px-2" : ""} ${
                  isActive
                    ? "bg-orange-400 text-white shadow-lg shadow-orange-950/20"
                    : "text-slate-200 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <NavigationIcon item={item} />
              <span className={collapsed ? "sr-only" : "ml-3 truncate"}>
                {item.label}
              </span>
            </NavLink>
          );
        })
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-4 text-sm leading-6 text-slate-200">
          No modules are assigned to this account yet.
        </div>
      )}
    </nav>
  );
}

function NavigationIcon({ item }: { item: NavigationItem }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-current">
      <IconGlyph id={navigationIconId(item)} />
    </span>
  );
}

function navigationIconId(item: NavigationItem) {
  if (item.path === "/project-sales") return "sales";
  if (item.path === "/product-sales") return "b2b_sales";
  if (item.path === "/stock-purchasing") return "stock";
  if (item.path === "/masters") return "product_master";

  const exactRouteIcons: Record<string, string> = {
    "/leads": "leads",
    "/customers/project-based": "project_customers",
    "/customers/b2b-direct": "b2b_customers",
    "/quotations": "quotations",
    "/b2b-sales": "b2b_sales",
    "/site-surveys": "site_surveys",
    "/projects": "projects",
    "/products-materials/products": "products",
    "/products-materials/categories": "categories",
    "/products-materials/catalog-library": "catalog",
    "/inventory": "inventory",
    "/vendors": "vendors",
    "/purchases": "purchases",
    "/proforma-invoices": "proforma_invoices",
    "/invoices": "invoices",
    "/payments": "payments",
  };

  const exactIcon = exactRouteIcons[item.path];
  if (exactIcon) {
    return exactIcon;
  }

  return item.moduleKey ?? item.path;
}

function IconGlyph({ id }: { id: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  switch (id) {
    case "dashboard":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 13h6V4H4v9Z" />
          <path d="M14 20h6v-9h-6v9Z" />
          <path d="M4 20h6v-3H4v3Z" />
          <path d="M14 7h6V4h-6v3Z" />
        </svg>
      );
    case "companies":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 20V6.5L12 3l8 3.5V20" />
          <path d="M8 20v-7h8v7" />
          <path d="M8 8h.01M12 8h.01M16 8h.01" />
        </svg>
      );
    case "sales":
    case "leads":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 17.5 9 12l3.5 3.5L20 7" />
          <path d="M15 7h5v5" />
        </svg>
      );
    case "project_customers":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M3.5 20a5 5 0 0 1 10 0" />
          <path d="M16 17.5l4-4" />
          <path d="M17 13.5h3v3" />
        </svg>
      );
    case "b2b_customers":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M17 11.5a2.5 2.5 0 1 0 0-5" />
          <path d="M13.5 19a4.5 4.5 0 0 1 7 0" />
          <path d="M5 8h5v5H5V8Z" />
          <path d="M7.5 13v5" />
        </svg>
      );
    case "projects":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 6.5h6l2 2H20v10H4v-12Z" />
          <path d="M8 14h8" />
        </svg>
      );
    case "site_surveys":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M6 4h12v16H6V4Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
          <path d="m15 16 1.2 1.2L19 14.4" />
        </svg>
      );
    case "quotations":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M7 3.5h7l3 3V20.5H7v-17Z" />
          <path d="M14 3.5v3h3" />
          <path d="M9.5 11h5M9.5 15h5" />
        </svg>
      );
    case "b2b_sales":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 16.5h4l2-3 3 4 3-6 4 5" />
          <path d="M4 20h16" />
          <path d="M7 8h10" />
          <path d="M9 4h6v4H9V4Z" />
        </svg>
      );
    case "stock":
    case "product_master":
    case "products":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 8.5 12 4l8 4.5-8 4.5L4 8.5Z" />
          <path d="M4 8.5V16l8 4 8-4V8.5" />
          <path d="M12 13v7" />
        </svg>
      );
    case "categories":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M5 5h5v5H5V5Z" />
          <path d="M14 5h5v5h-5V5Z" />
          <path d="M5 14h5v5H5v-5Z" />
          <path d="M14 14h5v5h-5v-5Z" />
        </svg>
      );
    case "catalog":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 1 5 16.5v-11Z" />
          <path d="M5 16.5A2.5 2.5 0 0 0 7.5 19" />
          <path d="M9 7h6M9 11h6" />
        </svg>
      );
    case "inventory":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M5 6h14v14H5V6Z" />
          <path d="M8 6V4h8v2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case "vendors":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 19V8l8-4 8 4v11" />
          <path d="M8 19v-6h8v6" />
          <path d="M9 9h.01M12 9h.01M15 9h.01" />
        </svg>
      );
    case "purchases":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M6 7h15l-2 7H8L6 4H3" />
          <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          <path d="M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      );
    case "finance":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 7h16v11H4V7Z" />
          <path d="M7 11h4M16.5 15h.01" />
          <path d="M8 7V5h8v2" />
        </svg>
      );
    case "proforma_invoices":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M7 3.5h7l3 3V20H7V3.5Z" />
          <path d="M14 3.5v3h3" />
          <path d="M9.5 11h5" />
          <path d="M9.5 15h3" />
          <path d="M16 15h1.5" />
        </svg>
      );
    case "invoices":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M7 4h10v16l-2-1-2 1-2-1-2 1-2-1V4Z" />
          <path d="M10 8h4M10 12h4M10 16h2" />
        </svg>
      );
    case "payments":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M4 8h16v9H4V8Z" />
          <path d="M4 11h16" />
          <path d="M8 15h3" />
        </svg>
      );
    case "reports":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M5 20V4h14v16H5Z" />
          <path d="M9 16v-4M12 16V8M15 16v-6" />
        </svg>
      );
    case "settings":
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19 12a7.8 7.8 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a8.1 8.1 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.7a8.1 8.1 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5A7.8 7.8 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a8.1 8.1 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a8.1 8.1 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" className="h-5 w-5" {...common}>
          <path d="M5 5h14v14H5V5Z" />
          <path d="M9 9h6M9 13h6" />
        </svg>
      );
  }
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function HeaderWaves() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <HeaderWaveLines className="absolute inset-x-0 top-0 h-20 w-full text-orange-300/45" />
    </div>
  );
}

function HeaderWaveLines({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 1440 96"
    >
      {Array.from({ length: 7 }).map((_, index) => (
        <path
          d={`M-40 ${24 + index * 6}C180 ${-18 + index * 4} 360 ${
            6 + index * 5
          } 560 ${34 + index * 4}C780 ${66 + index * 2} 1010 ${
            74 - index * 2
          } 1480 ${18 + index * 5}`}
          key={index}
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
