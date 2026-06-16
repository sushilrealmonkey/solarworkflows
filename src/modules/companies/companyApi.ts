import { supabase } from "../../services/supabaseClient";
import type {
  CreatePlatformCompanyFormValues,
  CreatePlatformCompanyResult,
  PlatformCompany,
  PlatformCompanyAdmin,
} from "./types";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  status: string | null;
  created_at: string | null;
};

type UserProfileRow = PlatformCompanyAdmin & {
  organization_id: string | null;
  created_at: string | null;
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
    .select("id, name, slug, subdomain, status, created_at")
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
      "id, organization_id, full_name, email, phone, status, auth_user_id, created_at",
    )
    .in("organization_id", organizationIds)
    .eq("is_super_admin", false)
    .order("created_at", { ascending: true });

  if (profileError) {
    throw new Error(profileError.message);
  }

  const adminByOrganizationId = new Map<string, PlatformCompanyAdmin>();

  for (const profile of (profileData ?? []) as UserProfileRow[]) {
    if (!profile.organization_id || adminByOrganizationId.has(profile.organization_id)) {
      continue;
    }

    adminByOrganizationId.set(profile.organization_id, {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      status: profile.status,
      auth_user_id: profile.auth_user_id,
    });
  }

  return organizations.map((organization) => ({
    ...organization,
    admin: adminByOrganizationId.get(organization.id) ?? null,
  })) satisfies PlatformCompany[];
}

export async function createPlatformCompany(
  values: CreatePlatformCompanyFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_organization_with_admin", {
    organization_name: values.organization_name.trim(),
    organization_slug: values.organization_slug.trim(),
    admin_full_name: values.admin_full_name.trim(),
    admin_phone: nullable(values.admin_phone),
    admin_email: nullable(values.admin_email),
    admin_auth_user_id: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as CreatePlatformCompanyResult;
}
