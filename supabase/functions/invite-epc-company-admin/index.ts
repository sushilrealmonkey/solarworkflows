import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type InviteRequestBody = {
  action?:
    | "create_company"
    | "send_admin_setup_link"
    | "update_company_status"
    | "update_admin_status";
  admin_profile_id?: string;
  organization_id?: string;
  organization_name?: string;
  organization_slug?: string;
  admin_full_name?: string;
  admin_email?: string;
  admin_phone?: string | null;
  status?: string;
};

type AdminProfileRow = {
  id: string;
  auth_user_id: string | null;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  status: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
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

    if (action !== "create_company") {
      return jsonResponse({ error: "Unsupported action" }, 400);
    }

    const payload = validateCreateBody(body);

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(payload.admin_email, {
        redirectTo: `${appBaseUrl}/create-password`,
        data: {
          full_name: payload.admin_full_name,
          organization_slug: payload.organization_slug,
        },
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
});

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
    .select("id, auth_user_id, organization_id, full_name, email, status")
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

  if (profile.auth_user_id) {
    const { error } = await serviceClient.auth.resetPasswordForEmail(
      adminEmail,
      {
        redirectTo: `${appBaseUrl}/create-password`,
      },
    );

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    await serviceClient
      .from("users_profile")
      .update({ invited_at: new Date().toISOString() })
      .eq("id", profile.id);

    return jsonResponse({
      ok: true,
      message: "Admin setup link sent",
    });
  }

  const { data: inviteData, error: inviteError } =
    await serviceClient.auth.admin.inviteUserByEmail(adminEmail, {
      redirectTo: `${appBaseUrl}/create-password`,
      data: {
        full_name: profile.full_name,
      },
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
    message: "Admin invite sent",
  });
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

  const { error } = await serviceClient
    .from("users_profile")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", adminProfileId)
    .eq("is_super_admin", false);

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({
    ok: true,
    message: `Admin marked ${status}`,
  });
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

function resolveAppBaseUrl(request: Request) {
  const configuredBaseUrl = Deno.env.get("APP_BASE_URL");
  const originBaseUrl = request.headers.get("Origin");
  const appBaseUrl = configuredBaseUrl || originBaseUrl;

  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL is not configured and request origin is unavailable");
  }

  return appBaseUrl.replace(/\/+$/, "");
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
