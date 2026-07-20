/* eslint-disable react-refresh/only-export-components */
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../services/supabaseClient";

export type UserProfile = {
  id: string;
  auth_user_id: string | null;
  full_name: string | null;
  phone: string | null;
  organization_id: string | null;
  company_id: string | null;
  status: string | null;
  is_super_admin: boolean | null;
};

export type UserPermission = {
  moduleKey: string;
  actionKey: string;
};

export type OrganizationBranding = {
  id: string | null;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  timezone: string;
  currency: string;
  createdAt: string | null;
};

type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "unassigned"
  | "inactive"
  | "ready"
  | "error";

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  profile: UserProfile | null;
  roleNames: string[];
  permissions: UserPermission[];
  organization: OrganizationBranding;
  errorMessage: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

type UserRoleNameRow = {
  role_name: string | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
  status: string | null;
  created_at: string | null;
};

type OrganizationBrandingRow = {
  organization_id: string;
  company_name: string | null;
  company_logo_url: string | null;
};

const defaultOrganization: OrganizationBranding = {
  id: null,
  name: "SolarOS",
  logoUrl: null,
  primaryColor: "#166534",
  secondaryColor: "#0f766e",
  accentColor: "#d6a31a",
  timezone: "Asia/Kolkata",
  currency: "INR",
  createdAt: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const permissionModuleKeys = [
  "dashboard",
  "customers",
  "leads",
  "projects",
  "site_surveys",
  "quotations",
  "invoices",
  "payments",
  "b2b_sales",
  "documents",
  "product_master",
  "product_pricing",
  "purchases",
  "inventory",
  "vendors",
  "staff",
  "reports",
  "settings",
];

const permissionActionKeys = ["view", "create", "update", "delete"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const activeUserIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [organization, setOrganization] =
    useState<OrganizationBranding>(defaultOrganization);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetUserState = useCallback(() => {
    setProfile(null);
    setRoleNames([]);
    setPermissions([]);
    setOrganization(defaultOrganization);
    setErrorMessage(null);
  }, []);

  const loadUserContext = useCallback(
    async (activeSession: Session | null) => {
      activeUserIdRef.current = activeSession?.user.id ?? null;

      if (!activeSession || !supabase) {
        setSession(activeSession);
        resetUserState();
        setStatus("unauthenticated");
        return;
      }

      setSession(activeSession);
      setStatus("loading");
      setErrorMessage(null);

      const { data: profileData, error: profileError } = await supabase
        .from("users_profile")
        .select(
          "id, auth_user_id, full_name, phone, organization_id, company_id, status, is_super_admin",
        )
        .eq("auth_user_id", activeSession.user.id)
        .maybeSingle();

      if (profileError) {
        setErrorMessage(profileError.message);
        setStatus("error");
        return;
      }

      if (!profileData) {
        resetUserState();
        setSession(activeSession);
        setStatus("unassigned");
        return;
      }

      const loadedProfile = profileData as UserProfile;
      setProfile(loadedProfile);

      if (loadedProfile.status !== "active") {
        setRoleNames([]);
        setPermissions([]);
        setStatus("inactive");
        return;
      }

      const { data: organizationData } = loadedProfile.organization_id
        ? await supabase
            .from("organizations")
            .select("id, name, status, created_at")
            .eq("id", loadedProfile.organization_id)
            .maybeSingle()
        : { data: null };

      const loadedOrganization = organizationData as OrganizationRow | null;

      const { data: settingsData } = await supabase.rpc(
        "get_organization_settings",
        {},
      );

      const { data: brandingData } = await supabase.rpc(
        "get_current_organization_branding",
      );
      const loadedBranding = brandingData as OrganizationBrandingRow | null;
      const tenantLogoUrl =
        loadedBranding?.organization_id === loadedProfile.organization_id &&
        typeof loadedBranding.company_logo_url === "string"
          ? loadedBranding.company_logo_url
          : null;
      const tenantDisplayName =
        loadedBranding?.organization_id === loadedProfile.organization_id &&
        typeof loadedBranding.company_name === "string" &&
        loadedBranding.company_name.trim()
          ? loadedBranding.company_name
          : null;

      setOrganization({
        id: loadedProfile.organization_id,
        name:
          tenantDisplayName ??
          (typeof settingsData?.company_name === "string" && settingsData.company_name
            ? settingsData.company_name
            : typeof loadedOrganization?.name === "string"
              ? loadedOrganization.name
              : defaultOrganization.name),
        logoUrl:
          tenantLogoUrl ??
          (typeof settingsData?.company_logo_url === "string"
            ? settingsData.company_logo_url
            : null),
        primaryColor:
          typeof settingsData?.primary_color === "string"
            ? settingsData.primary_color
            : defaultOrganization.primaryColor,
        secondaryColor:
          typeof settingsData?.secondary_color === "string"
            ? settingsData.secondary_color
            : defaultOrganization.secondaryColor,
        accentColor:
          typeof settingsData?.accent_color === "string"
            ? settingsData.accent_color
            : defaultOrganization.accentColor,
        timezone:
          typeof settingsData?.timezone === "string"
            ? settingsData.timezone
            : defaultOrganization.timezone,
        currency:
          typeof settingsData?.currency === "string"
            ? settingsData.currency
            : defaultOrganization.currency,
        createdAt: loadedOrganization?.created_at ?? null,
      });

      if (loadedProfile.is_super_admin) {
        setRoleNames(["Super Admin"]);
        setPermissions([]);
        setStatus("ready");
        return;
      }

      if (loadedOrganization?.status && loadedOrganization.status !== "active") {
        setRoleNames([]);
        setPermissions([]);
        setStatus("inactive");
        return;
      }

      const { data: roleRows, error: roleError } = await supabase.rpc(
        "get_current_user_role_names",
      );

      if (roleError) {
        throw new Error(roleError.message);
      }

      const nextRoleNames = new Set(
        ((roleRows ?? []) as UserRoleNameRow[])
          .map((row) => row.role_name)
          .filter((roleName): roleName is string => Boolean(roleName)),
      );

      const permissionClient = supabase;
      const permissionChecks = await Promise.all(
        permissionModuleKeys.flatMap((moduleKey) =>
          permissionActionKeys.map(async (actionKey) => {
            const { data, error } = await permissionClient.rpc(
              "user_has_permission",
              {
                module: moduleKey,
                action: actionKey,
              },
            );

            if (error) {
              throw new Error(error.message);
            }

            return data
              ? {
                  moduleKey,
                  actionKey,
                }
              : null;
          }),
        ),
      );

      setRoleNames(Array.from(nextRoleNames));
      setPermissions(
        permissionChecks.filter(
          (permission): permission is UserPermission => permission !== null,
        ),
      );
      setStatus("ready");
    },
    [resetUserState],
  );

  const refresh = useCallback(async () => {
    if (!supabase) {
      setStatus("unauthenticated");
      return;
    }

    const { data } = await supabase.auth.getSession();
    await loadUserContext(data.session);
  }, [loadUserContext]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      resetUserState();
      setSession(null);
      setStatus("unauthenticated");
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }

    resetUserState();
    setSession(null);
    setStatus("unauthenticated");
  }, [resetUserState]);

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      setStatus("unauthenticated");
      return undefined;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }

      if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
        void loadUserContext(nextSession);
        return;
      }

      if (event === "SIGNED_IN") {
        const nextUserId = nextSession?.user.id ?? null;

        // Supabase also emits SIGNED_IN when an existing session is confirmed
        // after a tab regains focus. Only rebuild access state for a new user.
        if (nextUserId !== activeUserIdRef.current) {
          void loadUserContext(nextSession);
        } else {
          setSession(nextSession);
        }
        return;
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setSession(nextSession);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserContext]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      roleNames,
      permissions,
      organization,
      errorMessage,
      refresh,
      signOut,
    }),
    [
      status,
      session,
      profile,
      roleNames,
      permissions,
      organization,
      errorMessage,
      refresh,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
