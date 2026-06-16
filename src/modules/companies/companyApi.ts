import { supabase } from "../../services/supabaseClient";
import type {
  CreatePlatformCompanyFormValues,
  CreatePlatformCompanyResult,
  PlatformCompany,
  PlatformCompanyActionResult,
  PlatformCompanyAdmin,
  PlatformCompanySettings,
} from "./types";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  custom_domain: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type UserProfileRow = PlatformCompanyAdmin & {
  organization_id: string | null;
};

type OrganizationSettingsRow = PlatformCompanySettings & {
  organization_id: string | null;
};

type OrganizationOwnedRow = {
  organization_id: string | null;
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function fetchPlatformCompanies() {
  const client = requireSupabase();

  const { data: organizationsData, error: organizationsError } = await client
    .from("organizations")
    .select("id, name, slug, subdomain, custom_domain, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (organizationsError) {
    throw new Error(organizationsError.message);
  }

  const organizations = (organizationsData ?? []) as OrganizationRow[];
  const organizationIds = organizations.map((organization) => organization.id);

  if (organizationIds.length === 0) {
    return [];
  }

  const { data: profileData, error: profileError } = await client
    .from("users_profile")
    .select(
      "id, organization_id, full_name, email, phone, status, auth_user_id, invited_at, onboarded_at, last_login_at, created_at",
    )
    .in("organization_id", organizationIds)
    .eq("is_super_admin", false)
    .order("created_at", { ascending: true });

  if (profileError) {
    throw new Error(profileError.message);
  }

  const adminByOrganizationId = new Map<string, PlatformCompanyAdmin>();
  const userCountByOrganizationId = new Map<string, number>();

  for (const profile of (profileData ?? []) as UserProfileRow[]) {
    if (!profile.organization_id) {
      continue;
    }

    userCountByOrganizationId.set(
      profile.organization_id,
      (userCountByOrganizationId.get(profile.organization_id) ?? 0) + 1,
    );

    if (!adminByOrganizationId.has(profile.organization_id)) {
      adminByOrganizationId.set(profile.organization_id, {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        status: profile.status,
        auth_user_id: profile.auth_user_id,
        invited_at: profile.invited_at,
        onboarded_at: profile.onboarded_at,
        last_login_at: profile.last_login_at,
        created_at: profile.created_at,
      });
    }
  }

  const [
    { data: settingsData, error: settingsError },
    { data: roleData, error: roleError },
  ] = await Promise.all([
    client
      .from("organization_settings")
      .select(
        "organization_id, contact_email, contact_phone, gst_number, address, company_logo_url",
      )
      .in("organization_id", organizationIds),
    client
      .from("roles")
      .select("organization_id")
      .in("organization_id", organizationIds),
  ]);

  if (settingsError) {
    throw new Error(settingsError.message);
  }

  if (roleError) {
    throw new Error(roleError.message);
  }

  const settingsByOrganizationId = new Map<string, PlatformCompanySettings>();
  for (const settings of (settingsData ?? []) as OrganizationSettingsRow[]) {
    if (!settings.organization_id) {
      continue;
    }

    settingsByOrganizationId.set(settings.organization_id, {
      contact_email: settings.contact_email,
      contact_phone: settings.contact_phone,
      gst_number: settings.gst_number,
      address: settings.address,
      company_logo_url: settings.company_logo_url,
    });
  }

  const roleCountByOrganizationId = new Map<string, number>();
  for (const role of (roleData ?? []) as OrganizationOwnedRow[]) {
    if (!role.organization_id) {
      continue;
    }

    roleCountByOrganizationId.set(
      role.organization_id,
      (roleCountByOrganizationId.get(role.organization_id) ?? 0) + 1,
    );
  }

  return organizations.map((organization) => ({
    ...organization,
    settings: settingsByOrganizationId.get(organization.id) ?? null,
    admin: adminByOrganizationId.get(organization.id) ?? null,
    role_count: roleCountByOrganizationId.get(organization.id) ?? 0,
    user_count: userCountByOrganizationId.get(organization.id) ?? 0,
  })) satisfies PlatformCompany[];
}

export async function createPlatformCompany(
  values: CreatePlatformCompanyFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(
    "invite-epc-company-admin",
    {
      body: {
        organization_name: values.organization_name.trim(),
        organization_slug: values.organization_slug.trim(),
        admin_full_name: values.admin_full_name.trim(),
        admin_phone: nullable(values.admin_phone),
        admin_email: nullable(values.admin_email),
      },
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as CreatePlatformCompanyResult;
}

export async function sendPlatformAdminSetupLink(adminProfileId: string) {
  return invokeCompanyAction({
    action: "send_admin_setup_link",
    admin_profile_id: adminProfileId,
  });
}

export async function updatePlatformCompanyStatus(
  organizationId: string,
  status: "active" | "inactive",
) {
  return invokeCompanyAction({
    action: "update_company_status",
    organization_id: organizationId,
    status,
  });
}

export async function updatePlatformAdminStatus(
  adminProfileId: string,
  status: "invited" | "active" | "inactive",
) {
  return invokeCompanyAction({
    action: "update_admin_status",
    admin_profile_id: adminProfileId,
    status,
  });
}

async function invokeCompanyAction(body: Record<string, unknown>) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(
    "invite-epc-company-admin",
    { body },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as PlatformCompanyActionResult;
}
