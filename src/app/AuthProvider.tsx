/* eslint-disable react-refresh/only-export-components */
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
};

type UserRoleNameRow = {
  role_name: string | null;
};

const defaultOrganization: OrganizationBranding = {
  id: null,
  name: "SolarWorkflows",
  logoUrl: null,
  primaryColor: "#166534",
  secondaryColor: "#0f766e",
  accentColor: "#d6a31a",
  timezone: "Asia/Kolkata",
  currency: "INR",
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
  "inventory",
  "vendors",
  "staff",
  "reports",
  "settings",
];

const permissionActionKeys = ["view", "create", "update", "delete"];

export function AuthProvider({ children }: { children: ReactNode }) {
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
          "id, auth_user_id, full_name, phone, organization_id, status, is_super_admin",
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
            .select("id, name")
            .eq("id", loadedProfile.organization_id)
            .maybeSingle()
        : { data: null };

      const { data: settingsData } = await supabase.rpc(
        "get_organization_settings",
        {},
      );

      setOrganization({
        id: loadedProfile.organization_id,
        name:
          typeof settingsData?.company_name === "string" && settingsData.company_name
            ? settingsData.company_name
            : typeof organizationData?.name === "string"
              ? organizationData.name
              : defaultOrganization.name,
        logoUrl:
          typeof settingsData?.company_logo_url === "string"
            ? settingsData.company_logo_url
            : null,
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
      });

      if (loadedProfile.is_super_admin) {
        setRoleNames(["Super Admin"]);
        setPermissions([]);
        setStatus("ready");
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

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      setStatus("unauthenticated");
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        void loadUserContext(data.session);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        void loadUserContext(nextSession);
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
