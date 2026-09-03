import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  parseTrialExtensionDays,
  trialExtensionEndsAt,
} from "./trial-extension.ts";

type InviteRequestBody = {
  action?:
    | "create_company"
    | "send_admin_setup_link"
    | "update_company_status"
    | "update_admin_status"
    | "update_company_profile"
    | "guarded_delete_company"
    | "extend_expired_trial";
  admin_profile_id?: string;
  organization_id?: string;
  organization_name?: string;
  organization_slug?: string;
  subdomain?: string | null;
  custom_domain?: string | null;
  admin_full_name?: string;
  admin_email?: string;
  admin_phone?: string | null;
  company_logo_url?: string | null;
  address?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  gst_number?: string | null;
  timezone?: string | null;
  currency?: string | null;
  status?: string;
  trial_extension_days?: number;
};

type AdminProfileRow = {
  id: string;
  auth_user_id: string | null;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  onboarded_at: string | null;
};

type StorageBucketRow = {
  id: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  const response = await handleInviteRequest(request);
  response.headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(request));
  response.headers.append("Vary", "Origin");
  return response;
});

async function handleInviteRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return jsonResponse({}, 204);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const appBaseUrl = resolveAppBaseUrl(request);
    const authorization = request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse({ error: "Authentication is required" }, 401);
    }

    const body = await request.json() as InviteRequestBody;
    const action = body.action ?? "create_company";

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const { data: isSuperAdmin, error: adminCheckError } =
      await callerClient.rpc("is_super_admin");

    if (adminCheckError) {
      return jsonResponse({ error: adminCheckError.message }, 403);
    }

    if (!isSuperAdmin) {
      return jsonResponse({ error: "Only super admins can invite EPC admins" }, 403);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (action === "send_admin_setup_link") {
      return await sendAdminSetupLink(serviceClient, body, appBaseUrl);
    }

    if (action === "update_company_status") {
      return await updateCompanyStatus(serviceClient, body);
    }

    if (action === "update_admin_status") {
      return await updateAdminStatus(serviceClient, body);
    }

    if (action === "update_company_profile") {
      return await updateCompanyProfile(serviceClient, body);
    }

    if (action === "guarded_delete_company") {
      return await guardedDeleteCompany(serviceClient, body);
    }

    if (action === "extend_expired_trial") {
      return await extendExpiredTrial(serviceClient, body);
    }

    if (action !== "create_company") {
      return jsonResponse({ error: "Unsupported action" }, 400);
    }

    const payload = validateCreateBody(body);

    const { data: inviteData, error: inviteError } =
      await sendInviteEmail(serviceClient, payload.admin_email, appBaseUrl, {
        full_name: payload.admin_full_name,
        company_name: payload.organization_name,
        organization_name: payload.organization_name,
        organization_slug: payload.organization_slug,
        staff_role: "Admin",
        staff_role_article: articleFor("Admin"),
      });

    if (inviteError || !inviteData.user) {
      return jsonResponse(
        { error: inviteError?.message ?? "Unable to create invite" },
        400,
      );
    }

    const { data: organizationData, error: organizationError } =
      await callerClient.rpc("create_organization_with_admin", {
        organization_name: payload.organization_name,
        organization_slug: payload.organization_slug,
        admin_full_name: payload.admin_full_name,
        admin_phone: payload.admin_phone,
        admin_email: payload.admin_email,
        admin_auth_user_id: inviteData.user.id,
      });

    if (organizationError) {
      await serviceClient.auth.admin.deleteUser(inviteData.user.id);
      return jsonResponse({ error: organizationError.message }, 400);
    }

    return jsonResponse({
      ...organizationData,
      invite_email_sent: true,
      invited_admin_email: payload.admin_email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 400);
  }
}

async function sendAdminSetupLink(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
  appBaseUrl: string,
) {
  const adminProfileId = normalizeText(body.admin_profile_id);

  if (!adminProfileId) {
    return jsonResponse({ error: "Admin profile is required" }, 400);
  }

  const { data: profileData, error: profileError } = await serviceClient
    .from("users_profile")
    .select("id, auth_user_id, organization_id, full_name, email, status, onboarded_at")
    .eq("id", adminProfileId)
    .eq("is_super_admin", false)
    .maybeSingle();

  if (profileError || !profileData) {
    return jsonResponse(
      { error: profileError?.message ?? "Admin profile not found" },
      404,
    );
  }

  const profile = profileData as AdminProfileRow;
  const adminEmail = normalizeEmail(profile.email ?? "");

  if (!adminEmail) {
    return jsonResponse({ error: "Admin profile email is required" }, 400);
  }

  if (profile.status === "inactive") {
    return jsonResponse(
      { error: "Reactivate the admin profile before sending a setup link" },
      400,
    );
  }

  const companyName = await resolveCompanyName(
    serviceClient,
    profile.organization_id,
  );

  if (profile.auth_user_id) {
    const setupDelivery = await createPasswordSetupDelivery(
      serviceClient,
      adminEmail,
      appBaseUrl,
    );

    if (setupDelivery.error) {
      return jsonResponse({ error: setupDelivery.error }, 400);
    }

    await serviceClient
      .from("users_profile")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", profile.id);

    return jsonResponse({
      ok: true,
      email_sent: setupDelivery.email_sent,
      message: setupDelivery.email_sent
        ? "Admin password setup email sent"
        : "Admin password setup link generated",
      setup_link: setupDelivery.setup_link,
    });
  }

  const { data: inviteData, error: inviteError } =
    await sendInviteEmail(serviceClient, adminEmail, appBaseUrl, {
      full_name: profile.full_name,
      company_name: companyName,
      staff_role: "Admin",
      staff_role_article: articleFor("Admin"),
    });

  if (inviteError || !inviteData.user) {
    return jsonResponse(
      { error: inviteError?.message ?? "Unable to create invite" },
      400,
    );
  }

  const { error: updateError } = await serviceClient
    .from("users_profile")
    .update({
      auth_user_id: inviteData.user.id,
      status: "invited",
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  if (updateError) {
    await serviceClient.auth.admin.deleteUser(inviteData.user.id);
    return jsonResponse({ error: updateError.message }, 400);
  }

  return jsonResponse({
    ok: true,
    email_sent: true,
    message: "Admin invite sent",
  });
}

function sendInviteEmail(
  serviceClient: ReturnType<typeof createClient>,
  email: string,
  appBaseUrl: string,
  data: Record<string, string | null>,
) {
  return serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appBaseUrl}/create-password`,
    data,
  });
}

async function resolveCompanyName(
  serviceClient: ReturnType<typeof createClient>,
  organizationId: string | null,
) {
  if (!organizationId) {
    return null;
  }

  const { data: settingsData } = await serviceClient
    .from("organization_settings")
    .select("company_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const settingsCompanyName = normalizeNullableText(
    typeof settingsData?.company_name === "string"
      ? settingsData.company_name
      : null,
  );

  if (settingsCompanyName) {
    return settingsCompanyName;
  }

  const { data: organizationData } = await serviceClient
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  return normalizeNullableText(
    typeof organizationData?.name === "string" ? organizationData.name : null,
  );
}

function articleFor(value: string) {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
}

async function createPasswordSetupDelivery(
  serviceClient: ReturnType<typeof createClient>,
  email: string,
  appBaseUrl: string,
) {
  const { error: emailError } = await serviceClient.auth.resetPasswordForEmail(
    email,
    {
      redirectTo: `${appBaseUrl}/create-password`,
    },
  );

  if (emailError) {
    console.error("Admin password setup email delivery failed", {
      message: emailError.message,
    });

    return {
      email_sent: false,
      error: emailError.message,
      setup_link: null,
    };
  }

  return {
    email_sent: !emailError,
    error: null,
    setup_link: null,
  };
}

async function updateCompanyStatus(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
) {
  const organizationId = normalizeText(body.organization_id);
  const status = normalizeStatus(body.status, ["active", "inactive"]);

  if (!organizationId) {
    return jsonResponse({ error: "Organization is required" }, 400);
  }

  if (!status) {
    return jsonResponse({ error: "Invalid company status" }, 400);
  }

  const { error } = await serviceClient
    .from("organizations")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId);

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({
    ok: true,
    message: `Workspace marked ${status}`,
  });
}

async function updateAdminStatus(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
) {
  const adminProfileId = normalizeText(body.admin_profile_id);
  const status = normalizeStatus(body.status, ["invited", "active", "inactive"]);

  if (!adminProfileId) {
    return jsonResponse({ error: "Admin profile is required" }, 400);
  }

  if (!status) {
    return jsonResponse({ error: "Invalid admin status" }, 400);
  }

  const { data: updatedProfile, error } = await serviceClient
    .from("users_profile")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", adminProfileId)
    .eq("is_super_admin", false)
    .select("auth_user_id")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const authUserId =
    typeof updatedProfile?.auth_user_id === "string"
      ? updatedProfile.auth_user_id
      : null;

  if (authUserId) {
    // Keep the legacy profiles row aligned so status-aware RLS policies deny
    // deactivated admins, and terminate live sessions on deactivation.
    await serviceClient
      .from("profiles")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", authUserId);

    if (status === "inactive") {
      await serviceClient.rpc("revoke_tenant_user_sessions", {
        target_auth_user_id: authUserId,
      });
    }
  }

  return jsonResponse({
    ok: true,
    message: `Admin marked ${status}`,
  });
}

async function updateCompanyProfile(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
) {
  const organizationId = normalizeText(body.organization_id);
  const organizationName = normalizeText(body.organization_name);
  const organizationSlug = slugify(normalizeText(body.organization_slug));
  const adminFullName = normalizeText(body.admin_full_name);
  const adminEmail = normalizeEmail(body.admin_email ?? "");
  const adminPhone = normalizeNullableText(body.admin_phone ?? null);
  const subdomain = normalizeNullableText(body.subdomain ?? null);
  const customDomain = normalizeNullableText(body.custom_domain ?? null);

  if (!organizationId) {
    return jsonResponse({ error: "Organization is required" }, 400);
  }

  if (!organizationName) {
    return jsonResponse({ error: "Company name is required" }, 400);
  }

  if (!organizationSlug) {
    return jsonResponse({ error: "Workspace slug is required" }, 400);
  }

  if (!adminFullName) {
    return jsonResponse({ error: "Primary admin name is required" }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return jsonResponse({ error: "Enter a valid primary admin email" }, 400);
  }

  if (!adminPhone) {
    return jsonResponse({ error: "Primary admin WhatsApp number is required" }, 400);
  }

  if (!isValidWhatsAppNumber(adminPhone)) {
    return jsonResponse({ error: "Enter a valid primary admin WhatsApp number" }, 400);
  }

  const { data: adminProfileData, error: profileError } = await serviceClient
    .from("users_profile")
    .select("id, auth_user_id, email, phone")
    .eq("organization_id", organizationId)
    .eq("is_super_admin", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 400);
  }

  const { error: organizationError } = await serviceClient
    .from("organizations")
    .update({
      name: organizationName,
      slug: organizationSlug,
      subdomain: subdomain ?? organizationSlug,
      custom_domain: customDomain,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId);

  if (organizationError) {
    return jsonResponse({ error: organizationError.message }, 400);
  }

  const { error: settingsError } = await serviceClient
    .from("organization_settings")
    .upsert(
      {
        organization_id: organizationId,
        company_name: organizationName,
        company_logo_url: normalizeNullableText(body.company_logo_url ?? null),
        address: normalizeNullableText(body.address ?? null),
        contact_person: normalizeNullableText(body.contact_person ?? null),
        contact_email: normalizeNullableText(body.contact_email ?? null),
        contact_phone: normalizeNullableText(body.contact_phone ?? null),
        gst_number: normalizeNullableText(body.gst_number ?? null),
        timezone: normalizeNullableText(body.timezone ?? null),
        currency: normalizeNullableText(body.currency ?? null),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

  if (settingsError) {
    return jsonResponse({ error: settingsError.message }, 400);
  }

  if (adminProfileData) {
    const adminProfile = adminProfileData as AdminProfileRow;
    const phoneChanged = phoneDigits(adminProfile.phone) !== phoneDigits(adminPhone);

    if (
      adminProfile.auth_user_id &&
      adminProfile.email &&
      normalizeEmail(adminProfile.email) !== adminEmail
    ) {
      const { error: authUpdateError } =
        await serviceClient.auth.admin.updateUserById(adminProfile.auth_user_id, {
          email: adminEmail,
        });

      if (authUpdateError) {
        return jsonResponse({ error: authUpdateError.message }, 400);
      }
    }

    const { error: adminUpdateError } = await serviceClient
      .from("users_profile")
      .update({
        full_name: adminFullName,
        email: adminEmail,
        phone: adminPhone,
        ...(phoneChanged ? { phone_verified: false } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", adminProfile.id)
      .eq("is_super_admin", false);

    if (adminUpdateError) {
      return jsonResponse({ error: adminUpdateError.message }, 400);
    }
  }

  return jsonResponse({
    ok: true,
    message: "EPC company updated",
  });
}

async function guardedDeleteCompany(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
) {
  const organizationId = normalizeText(body.organization_id);

  if (!organizationId) {
    return jsonResponse({ error: "Organization is required" }, 400);
  }

  const { data: organizationData, error: organizationLookupError } =
    await serviceClient
      .from("organizations")
      .select("company_id")
      .eq("id", organizationId)
      .maybeSingle();

  if (organizationLookupError) {
    return jsonResponse({ error: organizationLookupError.message }, 400);
  }

  if (!organizationData) {
    return jsonResponse({ error: "EPC company not found" }, 404);
  }

  // Category rows are seeded configuration, not operational activity. They
  // cascade with their organization/company, while any records that depend on
  // them (products, vendors, expenses, or BOM templates) remain blockers.
  const operationalTables: Array<{ table: string; tenantColumn?: string }> = [
    { table: "customers" },
    { table: "leads" },
    { table: "lead_followups" },
    { table: "site_surveys" },
    { table: "projects" },
    { table: "quotations" },
    { table: "payments" },
    { table: "project_payment_summary" },
    { table: "inventory_items" },
    { table: "inventory_transactions" },
    { table: "inventory_reservations" },
    { table: "inventory_batches" },
    { table: "suppliers" },
    { table: "vendors" },
    { table: "vendor_expenses" },
    { table: "purchase_orders" },
    { table: "documents" },
    { table: "proforma_invoices" },
    { table: "invoices" },
    { table: "b2b_sales" },
    { table: "products", tenantColumn: "tenant_id" },
    { table: "bom_templates", tenantColumn: "tenant_id" },
    { table: "activity_logs" },
    { table: "daily_briefs" },
    { table: "storage_cleanup_queue" },
  ];
  const blockers: string[] = [];

  for (const dependency of operationalTables) {
    const { count, error } = await serviceClient
      .from(dependency.table)
      .select("id", { count: "exact", head: true })
      .eq(dependency.tenantColumn ?? "organization_id", organizationId);

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    if ((count ?? 0) > 0) {
      blockers.push(`${dependency.table}: ${count}`);
    }
  }

  const { data: profilesData, error: profilesError } = await serviceClient
    .from("users_profile")
    .select("id, auth_user_id, organization_id, full_name, email, status, onboarded_at")
    .eq("organization_id", organizationId)
    .eq("is_super_admin", false);

  if (profilesError) {
    return jsonResponse({ error: profilesError.message }, 400);
  }

  const profiles = (profilesData ?? []) as AdminProfileRow[];

  // A company may be deleted when its only user is the primary admin, whether
  // that admin is still invited or has already activated their account. Extra
  // tenant users remain a deletion blocker.
  if (profiles.length > 1) {
    blockers.push(`users_profile: ${profiles.length}`);
  }

  const storageCheck = await findCompanyStorageBlockers(
    serviceClient,
    [organizationId, organizationData.company_id].filter(
      (value): value is string => Boolean(value),
    ),
  );

  if (storageCheck.error) {
    return jsonResponse({ error: storageCheck.error }, 400);
  }

  blockers.push(...storageCheck.blockers);

  if (blockers.length > 0) {
    return jsonResponse(
      {
        error:
          `This EPC company has operational data (${blockers.join(", ")}). Mark it inactive instead of deleting it.`,
      },
      409,
    );
  }

  const authUserIds = profiles
    .map((profile) => profile.auth_user_id)
    .filter((value): value is string => Boolean(value));

  // Auth user deletion invalidates refresh tokens, and this additionally
  // removes the active sessions before the workspace is deleted.
  for (const authUserId of authUserIds) {
    const { error: revokeSessionsError } = await serviceClient.rpc(
      "revoke_tenant_user_sessions",
      { target_auth_user_id: authUserId },
    );

    if (revokeSessionsError) {
      return jsonResponse({ error: revokeSessionsError.message }, 400);
    }
  }

  const { error: deleteOrganizationError } = await serviceClient
    .from("organizations")
    .delete()
    .eq("id", organizationId);

  if (deleteOrganizationError) {
    return jsonResponse({ error: deleteOrganizationError.message }, 400);
  }

  if (organizationData.company_id) {
    const { error: deleteCompanyError } = await serviceClient
      .from("companies")
      .delete()
      .eq("id", organizationData.company_id);

    if (deleteCompanyError) {
      return jsonResponse({ error: deleteCompanyError.message }, 400);
    }
  }

  for (const authUserId of authUserIds) {
    const { error: deleteAuthError } =
      await serviceClient.auth.admin.deleteUser(authUserId);

    if (deleteAuthError) {
      return jsonResponse({ error: deleteAuthError.message }, 400);
    }
  }

  return jsonResponse({
    ok: true,
    message: "EPC company deleted",
  });
}

async function extendExpiredTrial(
  serviceClient: ReturnType<typeof createClient>,
  body: InviteRequestBody,
) {
  const organizationId = normalizeText(body.organization_id);
  const extensionDays = parseTrialExtensionDays(body.trial_extension_days);

  if (!organizationId) {
    return jsonResponse({ error: "Organization is required" }, 400);
  }

  if (!extensionDays) {
    return jsonResponse(
      { error: "Trial extension must be a whole number from 1 to 90 days" },
      400,
    );
  }

  const { data: organization, error: organizationError } = await serviceClient
    .from("organizations")
    .select("company_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) {
    return jsonResponse({ error: organizationError.message }, 400);
  }

  if (!organization?.company_id) {
    return jsonResponse({ error: "Company subscription not found" }, 404);
  }

  const now = new Date();
  const { data: subscription, error: subscriptionError } = await serviceClient
    .from("company_subscriptions")
    .update({
      status: "trialing",
      trial_ends_at: trialExtensionEndsAt(extensionDays, now),
      updated_at: now.toISOString(),
    })
    .eq("company_id", organization.company_id)
    .eq("status", "trialing")
    .not("trial_ends_at", "is", null)
    .lte("trial_ends_at", now.toISOString())
    .select("trial_ends_at")
    .maybeSingle();

  if (subscriptionError) {
    return jsonResponse({ error: subscriptionError.message }, 400);
  }

  if (!subscription) {
    return jsonResponse(
      { error: "Only an expired free trial can be extended" },
      409,
    );
  }

  return jsonResponse({
    ok: true,
    message: `Free trial extended by ${extensionDays} day${extensionDays === 1 ? "" : "s"}`,
    trial_ends_at: subscription.trial_ends_at,
  });
}

async function findCompanyStorageBlockers(
  serviceClient: ReturnType<typeof createClient>,
  prefixes: string[],
) {
  const { data: bucketsData, error: bucketsError } =
    await serviceClient.storage.listBuckets();

  if (bucketsError) {
    return { blockers: [], error: bucketsError.message };
  }

  const blockers: string[] = [];
  const uniquePrefixes = [...new Set(prefixes)];
  const buckets = (bucketsData ?? []) as StorageBucketRow[];

  for (const bucket of buckets) {
    for (const prefix of uniquePrefixes) {
      const { data: objects, error: objectsError } = await serviceClient.storage
        .from(bucket.id)
        .list(prefix, { limit: 1 });

      if (objectsError) {
        return { blockers: [], error: objectsError.message };
      }

      if ((objects ?? []).length > 0) {
        blockers.push(`storage:${bucket.id}/${prefix}`);
      }
    }
  }

  return { blockers, error: null };
}

function validateCreateBody(body: InviteRequestBody) {
  const organizationName = normalizeText(body.organization_name);
  const organizationSlug = slugify(normalizeText(body.organization_slug));
  const adminFullName = normalizeText(body.admin_full_name);
  const adminEmail = normalizeEmail(body.admin_email ?? "");
  const adminPhone = normalizeNullableText(body.admin_phone ?? null);

  if (!organizationName) {
    throw new Error("Company name is required");
  }

  if (!organizationSlug) {
    throw new Error("Workspace slug is required");
  }

  if (!adminFullName) {
    throw new Error("Primary admin name is required");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error("Enter a valid primary admin email");
  }

  if (!adminPhone) {
    throw new Error("Primary admin WhatsApp number is required");
  }

  if (!isValidWhatsAppNumber(adminPhone)) {
    throw new Error("Enter a valid primary admin WhatsApp number");
  }

  return {
    organization_name: organizationName,
    organization_slug: organizationSlug,
    admin_full_name: adminFullName,
    admin_email: adminEmail,
    admin_phone: adminPhone,
  };
}

function normalizeText(value: string | undefined) {
  return (value ?? "").trim();
}

function normalizeNullableText(value: string | null) {
  const normalized = (value ?? "").trim();
  return normalized ? normalized : null;
}

function isValidWhatsAppNumber(value: string) {
  return /^[0-9+() -]{6,20}$/.test(value);
}

function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeStatus(value: string | undefined, allowedValues: string[]) {
  const normalized = normalizeText(value).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

function appOriginAllowList() {
  const configuredBaseUrl = normalizeBaseUrl(Deno.env.get("APP_BASE_URL"));
  return new Set(
    [
      configuredBaseUrl,
      ...(Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((entry) => normalizeBaseUrl(entry)),
    ]
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase()),
  );
}

function resolveAppBaseUrl(request: Request) {
  const configuredBaseUrl = normalizeBaseUrl(Deno.env.get("APP_BASE_URL"));
  const originBaseUrl = normalizeBaseUrl(request.headers.get("Origin"));

  // Honor the request Origin only when it is an allow-listed app origin, so a
  // spoofed Origin header cannot redirect invite/setup emails off-domain.
  if (originBaseUrl && appOriginAllowList().has(originBaseUrl.toLowerCase())) {
    return originBaseUrl;
  }

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  throw new Error("APP_BASE_URL is not configured");
}

function resolveCorsOrigin(request: Request) {
  const originBaseUrl = normalizeBaseUrl(request.headers.get("Origin"));

  if (originBaseUrl && appOriginAllowList().has(originBaseUrl.toLowerCase())) {
    return originBaseUrl;
  }

  return normalizeBaseUrl(Deno.env.get("APP_BASE_URL")) || "*";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
