import { supabase } from "../../services/supabaseClient";
import type { UserProfile } from "../../app/AuthProvider";
import type {
  OrganizationSettings,
  OrganizationSettingsFormValues,
  PermissionAction,
  PermissionOption,
  RoleFormValues,
  SettingsRole,
  SettingsStaff,
  StaffFormValues,
} from "./types";

export const permissionModules = [
  "dashboard",
  "customers",
  "leads",
  "site_surveys",
  "quotations",
  "projects",
  "payments",
  "documents",
  "inventory",
  "vendors",
  "invoices",
  "reports",
  "settings",
] as const;

export const permissionActions: PermissionAction[] = [
  "view",
  "create",
  "update",
  "delete",
];

type ModuleRow = {
  id: string;
  module_key: string;
  module_name: string;
  sort_order: number | null;
};

type PermissionRow = {
  id: string;
  module_id: string;
  action_key: string;
  action_name: string;
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireOrganization(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function fetchOrganizationSettings() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_organization_settings", {});

  if (error) {
    throw new Error(error.message);
  }

  return data as OrganizationSettings;
}

export async function updateOrganizationSettings(
  values: OrganizationSettingsFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_organization_settings", {
    settings: values,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as OrganizationSettings;
}

export async function fetchSettingsStaff() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_settings_staff");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SettingsStaff[];
}

export async function createStaff(values: StaffFormValues) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_settings_staff", {
    full_name: values.full_name,
    phone: values.phone,
    email: values.email,
    role_id: nullable(values.role_id),
    status: values.status,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SettingsStaff;
}

export async function updateStaff(id: string, values: StaffFormValues) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_settings_staff", {
    target_profile_id: id,
    full_name: values.full_name,
    phone: values.phone,
    email: values.email,
    role_id: nullable(values.role_id),
    status: values.status,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SettingsStaff;
}

export async function fetchSettingsRoles() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_settings_roles");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SettingsRole[];
}

export async function createRole(
  profile: UserProfile | null,
  values: RoleFormValues,
) {
  requireOrganization(profile);

  const client = requireSupabase();
  const { data, error } = await client.rpc("create_settings_role", {
    role_name: values.role_name,
    description: values.description,
    permission_ids: values.permission_ids,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SettingsRole;
}

export async function updateRole(id: string, values: RoleFormValues) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_settings_role", {
    target_role_id: id,
    role_name: values.role_name,
    description: values.description,
    permission_ids: values.permission_ids,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SettingsRole;
}

export async function deleteRole(id: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("delete_settings_role", {
    target_role_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchPermissionOptions() {
  const client = requireSupabase();
  const { data: moduleData, error: moduleError } = await client
    .from("modules")
    .select("id, module_key, module_name, sort_order")
    .in("module_key", [...permissionModules])
    .order("sort_order", { ascending: true });

  if (moduleError) {
    throw new Error(moduleError.message);
  }

  const modules = (moduleData ?? []) as ModuleRow[];
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const { data: permissionData, error: permissionError } = await client
    .from("permissions")
    .select("id, module_id, action_key, action_name")
    .in(
      "module_id",
      modules.map((module) => module.id),
    )
    .in("action_key", permissionActions);

  if (permissionError) {
    throw new Error(permissionError.message);
  }

  return ((permissionData ?? []) as PermissionRow[])
    .map((permission) => {
      const module = moduleById.get(permission.module_id);

      if (!module || !isPermissionAction(permission.action_key)) {
        return null;
      }

      return {
        id: permission.id,
        module_id: permission.module_id,
        module_key: module.module_key,
        module_name: module.module_name,
        action_key: permission.action_key,
        action_name: permission.action_name,
      } satisfies PermissionOption;
    })
    .filter((permission): permission is PermissionOption => permission !== null);
}

function isPermissionAction(value: string): value is PermissionAction {
  return permissionActions.includes(value as PermissionAction);
}
