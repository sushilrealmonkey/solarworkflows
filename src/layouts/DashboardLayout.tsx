import { useMemo, useState, type CSSProperties } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  navigationItems,
  platformNavigationItems,
  type NavigationItem,
} from "../app/navigation";
import { isPlatformPath } from "../app/redirects";
import { useAuth } from "../app/AuthProvider";
import { PortalLogo } from "../components/PortalBrand";

const linkBase =
  "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";

export function DashboardLayout() {
  const { profile, roleNames, permissions, organization, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

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
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-stone-50 text-slate-950"
      style={shellStyle}
    >
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-stone-200 bg-white px-4 py-5 shadow-sm lg:block">
        <ShellBrand />
        <SidebarNavigation items={visibleNavigationItems} />
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full bg-slate-950/35"
            onClick={() => setMobileMenuOpen(false)}
            type="button"
          />
          <aside className="relative h-full w-[min(20rem,86vw)] border-r border-stone-200 bg-white px-4 py-5 shadow-xl">
            <ShellBrand />
            <SidebarNavigation
              items={visibleNavigationItems}
              onNavigate={() => setMobileMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
                type="button"
              >
                Menu
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {organization.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {organization.timezone} / {organization.currency}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 text-right">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {profile?.full_name ?? "Workspace user"}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {profile?.is_super_admin
                    ? "Super Admin"
                    : roleNames.join(", ") || "No role assigned"}
                </p>
                {logoutError ? (
                  <p className="mt-0.5 max-w-48 truncate text-xs text-rose-700">
                    {logoutError}
                  </p>
                ) : null}
              </div>
              <button
                className="shrink-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                {isSigningOut ? "Signing out" : "Logout"}
              </button>
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

function ShellBrand() {
  const { organization } = useAuth();

  return (
    <div className="flex items-center gap-3 px-2">
      {organization.logoUrl ? (
        <>
          <img
            alt=""
            className="h-11 w-11 rounded-xl border border-stone-200 object-contain"
            src={organization.logoUrl}
          />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-950">
              {organization.name}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              Solar operations
            </p>
          </div>
        </>
      ) : (
        <PortalLogo className="h-16 w-full max-w-56 object-contain object-left" />
      )}
    </div>
  );
}

function SidebarNavigation({
  items,
  onNavigate,
}: {
  items: NavigationItem[];
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <nav className="mt-8 space-y-1" aria-label="Primary navigation">
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
                  className={`${linkBase} w-full justify-between ${
                    groupIsActive
                      ? "bg-brand-50 text-brand-900 shadow-sm"
                      : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
                  }`}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [item.path]: !isOpen,
                    }))
                  }
                  type="button"
                >
                  <span className="flex min-w-0 items-center">
                    <span
                      className="mr-3 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "var(--org-primary)" }}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span aria-hidden="true" className="text-base font-semibold">
                    {isOpen ? "-" : "+"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="mt-1 space-y-1 pl-6">
                    {item.children?.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? "bg-brand-50 text-brand-900 shadow-sm"
                              : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
                          }`
                        }
                      >
                        {child.label}
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
              className={({ isActive }) =>
                `${linkBase} ${
                  isActive
                    ? "bg-brand-50 text-brand-900 shadow-sm"
                    : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
                }`
              }
            >
              <span
                className="mr-3 h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: `var(${
                    item.moduleKey === "settings" ? "--org-accent" : "--org-primary"
                  })`,
                }}
              />
              {item.label}
            </NavLink>
          );
        })
      ) : (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-4 text-sm leading-6 text-slate-600">
          No modules are assigned to this account yet.
        </div>
      )}
    </nav>
  );
}
