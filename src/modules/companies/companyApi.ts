import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../services/supabaseClient";
import { deriveCompanyBillingStatus, slugify } from "./companyUtils";
import type {
  CreatePlatformCompanyFormValues,
  CreatePlatformCompanyResult,
  PlatformActivityLog,
  PlatformCompany,
  PlatformCompanyActionResult,
  PlatformCompanyActivitySummary,
  PlatformCompanyAdmin,
  PlatformTenantUser,
  PlatformTenantUserRole,
  PlatformCompanySettings,
  PlatformCompanySubscription,
  UpdatePlatformCompanyFormValues,
} from "./types";

type OrganizationRow = {
  id: string;
  company_id: string | null;
  name: string;
  slug: string;
  subdomain: string | null;
  custom_domain: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SubscriptionPlanRow = {
  plan_key: string;
  display_name: string | null;
};

type CompanyClassificationRow = {
  id: string;
  is_in_house: boolean;
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

type DashboardSummaryRow = PlatformCompanyActivitySummary & {
  organization_id: string;
};

type TenantRoleRow = PlatformTenantUserRole & {
  organization_id: string | null;
};

type UserRoleAssignmentRow = {
  user_profile_id: string | null;
  user_id: string | null;
  role_id: string;
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

function nullablePhone(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== "+91" ? trimmed : null;
}

export async function fetchPlatformCompanies() {
  const client = requireSupabase();

  const { data: organizationsData, error: organizationsError } = await client
    .from("organizations")
    .select(
      "id, company_id, name, slug, subdomain, custom_domain, status, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (organizationsError) {
    throw new Error(organizationsError.message);
  }

  const organizations = (organizationsData ?? []) as OrganizationRow[];
  const organizationIds = organizations.map((organization) => organization.id);
  const companyIds = organizations
    .map((organization) => organization.company_id)
    .filter((companyId): companyId is string => Boolean(companyId));

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
    { data: companyData, error: companyError },
    { data: subscriptionData, error: subscriptionError },
    { data: planData, error: planError },
  ] = await Promise.all([
    client
      .from("organization_settings")
      .select(
        "organization_id, company_name, company_details, contact_email, contact_phone, contact_person, gst_number, address, company_logo_url, timezone, currency",
      )
      .in("organization_id", organizationIds),
    client
      .from("roles")
      .select("organization_id")
      .in("organization_id", organizationIds),
    client
      .from("companies")
      .select("id, is_in_house")
      .in("id", companyIds),
    client
      .from("company_subscriptions")
      .select(
        "company_id, plan_key, status, billing_period, trial_started_at, trial_ends_at, current_period_started_at, current_period_ends_at, cancel_at_period_end",
      )
      .in("company_id", companyIds),
    client
      .from("subscription_plans")
      .select("plan_key, display_name")
      .eq("is_active", true),
  ]);

  if (settingsError) {
    throw new Error(settingsError.message);
  }

  if (roleError) {
    throw new Error(roleError.message);
  }

  if (companyError) {
    throw new Error(companyError.message);
  }

  if (subscriptionError) {
    throw new Error(subscriptionError.message);
  }

  if (planError) {
    throw new Error(planError.message);
  }

  const planNameByKey = new Map(
    ((planData ?? []) as SubscriptionPlanRow[]).map((plan) => [
      plan.plan_key,
      plan.display_name,
    ]),
  );
  const subscriptionByCompanyId = new Map<string, PlatformCompanySubscription>();

  const inHouseByCompanyId = new Map(
    ((companyData ?? []) as CompanyClassificationRow[]).map((company) => [
      company.id,
      company.is_in_house,
    ]),
  );

  for (const subscription of (subscriptionData ?? []) as Omit<
    PlatformCompanySubscription,
    "plan_name"
  >[]) {
    subscriptionByCompanyId.set(subscription.company_id, {
      ...subscription,
      plan_name: subscription.plan_key
        ? planNameByKey.get(subscription.plan_key) ?? null
        : null,
    });
  }

  const settingsByOrganizationId = new Map<string, PlatformCompanySettings>();
  for (const settings of (settingsData ?? []) as OrganizationSettingsRow[]) {
    if (!settings.organization_id) {
      continue;
    }

    settingsByOrganizationId.set(settings.organization_id, {
      company_name: settings.company_name,
      company_details: settings.company_details,
      contact_email: settings.contact_email,
      contact_phone: settings.contact_phone,
      contact_person: settings.contact_person,
      gst_number: settings.gst_number,
      address: settings.address,
      company_logo_url: settings.company_logo_url,
      timezone: settings.timezone,
      currency: settings.currency,
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
    is_in_house: organization.company_id
      ? inHouseByCompanyId.get(organization.company_id) ?? false
      : false,
    subscription: organization.company_id
      ? subscriptionByCompanyId.get(organization.company_id) ?? null
      : null,
    billing_status: deriveCompanyBillingStatus(
      organization.company_id
        ? subscriptionByCompanyId.get(organization.company_id) ?? null
        : null,
    ),
    settings: settingsByOrganizationId.get(organization.id) ?? null,
    admin: adminByOrganizationId.get(organization.id) ?? null,
    role_count: roleCountByOrganizationId.get(organization.id) ?? 0,
    user_count: userCountByOrganizationId.get(organization.id) ?? 0,
  })) satisfies PlatformCompany[];
}

export async function fetchPlatformCompany(organizationId: string) {
  const companies = await fetchPlatformCompanies();
  const company = companies.find((item) => item.id === organizationId);

  if (!company) {
    throw new Error("EPC company not found.");
  }

  const [summaryByOrganizationId, recentActivity, tenantUsers] = await Promise.all([
    fetchDashboardSummaryByOrganizationId(),
    fetchPlatformActivityLogs(organizationId, 8),
    fetchPlatformTenantUsers(organizationId),
  ]);

  return {
    ...company,
    tenant_users: tenantUsers,
    activity_summary:
      summaryByOrganizationId.get(organizationId) ?? emptyActivitySummary(),
    recent_activity: recentActivity,
  } satisfies PlatformCompany;
}

async function fetchPlatformTenantUsers(
  organizationId: string,
): Promise<PlatformTenantUser[]> {
  const client = requireSupabase();
  const [profilesResult, rolesResult] = await Promise.all([
    client
      .from("users_profile")
      .select(
        "id, full_name, email, phone, status, auth_user_id, invited_at, onboarded_at, last_login_at, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("is_super_admin", false)
      .order("created_at", { ascending: true }),
    client
      .from("roles")
      .select("id, organization_id, role_key, role_name")
      .eq("organization_id", organizationId),
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  if (rolesResult.error) {
    throw new Error(rolesResult.error.message);
  }

  const profiles = (profilesResult.data ?? []) as PlatformCompanyAdmin[];
  const roles = (rolesResult.data ?? []) as TenantRoleRow[];
  const roleIds = roles.map((role) => role.id);
  const roleById = new Map(
    roles.map((role) => [
      role.id,
      {
        id: role.id,
        role_key: role.role_key,
        role_name: role.role_name,
      } satisfies PlatformTenantUserRole,
    ]),
  );

  let assignments: UserRoleAssignmentRow[] = [];

  if (roleIds.length > 0) {
    const { data, error } = await client
      .from("user_roles")
      .select("user_profile_id, user_id, role_id")
      .in("role_id", roleIds);

    if (error) {
      throw new Error(error.message);
    }

    assignments = (data ?? []) as UserRoleAssignmentRow[];
  }

  return profiles.map((profile) => {
    const assignedRoleIds = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.user_profile_id === profile.id ||
            (profile.auth_user_id !== null &&
              assignment.user_id === profile.auth_user_id),
        )
        .map((assignment) => assignment.role_id),
    );

    return {
      ...profile,
      roles: Array.from(assignedRoleIds)
        .map((roleId) => roleById.get(roleId))
        .filter((role): role is PlatformTenantUserRole => Boolean(role))
        .sort((left, right) =>
          (left.role_name ?? left.role_key ?? "").localeCompare(
            right.role_name ?? right.role_key ?? "",
          ),
        ),
    };
  });
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
        organization_slug: slugify(values.organization_name),
        admin_full_name: values.admin_full_name.trim(),
        admin_phone: nullablePhone(values.admin_phone),
        admin_email: nullable(values.admin_email),
      },
    },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
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

export async function updatePlatformCompanyProfile(
  organizationId: string,
  values: UpdatePlatformCompanyFormValues,
) {
  return invokeCompanyAction({
    action: "update_company_profile",
    organization_id: organizationId,
    organization_name: values.organization_name.trim(),
    organization_slug: values.organization_slug.trim(),
    subdomain: nullable(values.subdomain),
    custom_domain: nullable(values.custom_domain),
    company_logo_url: nullable(values.company_logo_url),
    address: nullable(values.address),
    contact_person: nullable(values.contact_person),
    contact_email: nullable(values.contact_email),
    contact_phone: nullable(values.contact_phone),
    gst_number: nullable(values.gst_number),
    timezone: nullable(values.timezone),
    currency: nullable(values.currency),
    admin_full_name: values.admin_full_name.trim(),
    admin_email: nullable(values.admin_email),
    admin_phone: nullable(values.admin_phone),
  });
}

export async function guardedDeletePlatformCompany(organizationId: string) {
  return invokeCompanyAction({
    action: "guarded_delete_company",
    organization_id: organizationId,
  });
}

async function invokeCompanyAction(body: Record<string, unknown>) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(
    "invite-epc-company-admin",
    { body },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data as PlatformCompanyActionResult;
}

async function fetchDashboardSummaryByOrganizationId() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("dashboard_summary");

  if (error) {
    throw new Error(error.message);
  }

  const summaryByOrganizationId = new Map<string, PlatformCompanyActivitySummary>();

  for (const row of (data ?? []) as DashboardSummaryRow[]) {
    summaryByOrganizationId.set(row.organization_id, {
      total_customers: Number(row.total_customers ?? 0),
      total_leads: Number(row.total_leads ?? 0),
      active_projects: Number(row.active_projects ?? 0),
      completed_projects: Number(row.completed_projects ?? 0),
      pending_site_surveys: Number(row.pending_site_surveys ?? 0),
      quotations_sent: Number(row.quotations_sent ?? 0),
      quotations_accepted: Number(row.quotations_accepted ?? 0),
      total_project_value: Number(row.total_project_value ?? 0),
      total_received_amount: Number(row.total_received_amount ?? 0),
      total_balance_due: Number(row.total_balance_due ?? 0),
      low_stock_items: Number(row.low_stock_items ?? 0),
      pending_documents: Number(row.pending_documents ?? 0),
    });
  }

  return summaryByOrganizationId;
}

async function fetchPlatformActivityLogs(
  organizationId: string | null,
  limit: number,
) {
  const client = requireSupabase();
  let query = client
    .from("activity_logs")
    .select("id, module, action, description, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PlatformActivityLog[];
}

function emptyActivitySummary(): PlatformCompanyActivitySummary {
  return {
    total_customers: 0,
    total_leads: 0,
    active_projects: 0,
    completed_projects: 0,
    pending_site_surveys: 0,
    quotations_sent: 0,
    quotations_accepted: 0,
    total_project_value: 0,
    total_received_amount: 0,
    total_balance_due: 0,
    low_stock_items: 0,
    pending_documents: 0,
  };
}

async function getFunctionErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as unknown;

      if (isErrorBody(body)) {
        return body.error;
      }
    } catch {
      return error.message;
    }
  }

  return error instanceof Error ? error.message : "Action failed.";
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    value.error.trim().length > 0
  );
}
