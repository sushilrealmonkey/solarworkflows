type RedirectProfile = {
  is_super_admin: boolean | null;
};

const platformHomePath = "/companies";
const tenantHomePath = "/dashboard";

export function authenticatedHomePath(profile: RedirectProfile | null) {
  return profile?.is_super_admin ? platformHomePath : tenantHomePath;
}

export function safeAuthenticatedRedirect(
  profile: RedirectProfile | null,
  requestedPath: string,
) {
  if (profile?.is_super_admin) {
    return platformHomePath;
  }

  return requestedPath || tenantHomePath;
}

export function isPlatformPath(pathname: string) {
  return pathname === platformHomePath;
}
