type RedirectProfile = {
  is_super_admin: boolean | null;
  platform_role?: "backend_staff" | null;
};

const platformHomePath = "/dashboard";
const tenantHomePath = "/dashboard";

export function authenticatedHomePath(profile: RedirectProfile | null) {
  return profile?.platform_role === "backend_staff" ? "/whatsapp-messaging" : profile?.is_super_admin ? platformHomePath : tenantHomePath;
}

export function isPlatformPath(pathname: string) {
  return (
    pathname === "/dashboard" ||
    pathname === "/companies" ||
    pathname.startsWith("/companies/") ||
    pathname === "/whatsapp-messaging" ||
    pathname === "/platform-staff" ||
    pathname === "/settings" ||
    pathname === "/billing/plans"
  );
}
