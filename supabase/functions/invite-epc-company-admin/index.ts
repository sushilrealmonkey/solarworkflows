import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type InviteRequestBody = {
  organization_name?: string;
  organization_slug?: string;
  admin_full_name?: string;
  admin_email?: string;
  admin_phone?: string | null;
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
    const appBaseUrl = requireEnv("APP_BASE_URL").replace(/\/+$/, "");
    const authorization = request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse({ error: "Authentication is required" }, 401);
    }

    const body = await request.json() as InviteRequestBody;
    const payload = validateBody(body);

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

function validateBody(body: InviteRequestBody) {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
