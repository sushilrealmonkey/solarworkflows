import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type InviteStaffRequestBody = {
  full_name?: string;
  phone?: string | null;
  email?: string;
  role_id?: string | null;
  status?: string;
};

type StaffProfileRow = {
  id: string;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  status: string | null;
};

type SettingsRow = {
  company_name: string | null;
};

type RoleRow = {
  id: string;
  role_name: string | null;
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

    const body = (await request.json()) as InviteStaffRequestBody;
    const payload = validateInviteBody(body);

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

    const inviteMetadata = await resolveInviteMetadata(
      callerClient,
      payload.role_id,
    );

    if (inviteMetadata.error) {
      return jsonResponse({ error: inviteMetadata.error }, 400);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(payload.email, {
        redirectTo: `${appBaseUrl}/create-password`,
        data: {
          full_name: payload.full_name,
          company_name: inviteMetadata.company_name,
          staff_role: inviteMetadata.staff_role,
          staff_role_article: inviteMetadata.staff_role_article,
        },
      });

    if (inviteError || !inviteData.user) {
      return jsonResponse(
        { error: inviteError?.message ?? "Unable to send staff invite" },
        400,
      );
    }

    const { data: staffData, error: staffError } = await callerClient.rpc(
      "create_settings_staff",
      {
        full_name: payload.full_name,
        phone: payload.phone,
        email: payload.email,
        role_id: payload.role_id,
        status: payload.status,
      },
    );

    if (staffError || !staffData) {
      await serviceClient.auth.admin.deleteUser(inviteData.user.id);
      return jsonResponse(
        { error: staffError?.message ?? "Unable to create staff profile" },
        400,
      );
    }

    const staff = staffData as StaffProfileRow;
    const { data: updatedStaff, error: updateError } = await serviceClient
      .from("users_profile")
      .update({
        auth_user_id: inviteData.user.id,
        status: "invited",
        invited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", staff.id)
      .eq("organization_id", staff.organization_id)
      .select()
      .single();

    if (updateError) {
      await serviceClient.auth.admin.deleteUser(inviteData.user.id);
      await serviceClient.from("users_profile").delete().eq("id", staff.id);
      return jsonResponse({ error: updateError.message }, 400);
    }

    return jsonResponse({
      ...(updatedStaff ?? staff),
      invite_email_sent: true,
      invited_staff_email: payload.email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 400);
  }
});

function validateInviteBody(body: InviteStaffRequestBody) {
  const fullName = normalizeText(body.full_name);
  const phone = normalizeNullableText(body.phone ?? null);
  const email = normalizeEmail(body.email ?? "");
  const roleId = normalizeNullableText(body.role_id ?? null);
  const status = normalizeStatus(body.status, ["invited", "active", "inactive"]) ??
    "invited";

  if (!fullName) {
    throw new Error("Full name is required");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid staff email");
  }

  return {
    full_name: fullName,
    phone,
    email,
    role_id: roleId,
    status,
  };
}

async function resolveInviteMetadata(
  callerClient: ReturnType<typeof createClient>,
  roleId: string | null,
) {
  const { data: settingsData, error: settingsError } =
    await callerClient.rpc("get_organization_settings", {});

  if (settingsError) {
    return {
      error: settingsError.message,
      company_name: null,
      staff_role: null,
      staff_role_article: null,
    };
  }

  let staffRole: string | null = null;

  if (roleId) {
    const { data: rolesData, error: rolesError } =
      await callerClient.rpc("get_settings_roles");

    if (rolesError) {
      return {
        error: rolesError.message,
        company_name: null,
        staff_role: null,
        staff_role_article: null,
      };
    }

    const role = ((rolesData ?? []) as RoleRow[]).find(
      (candidate) => candidate.id === roleId,
    );

    if (!role) {
      return {
        error: "Selected staff role could not be found",
        company_name: null,
        staff_role: null,
        staff_role_article: null,
      };
    }

    staffRole = normalizeNullableText(role.role_name);
  }

  const settings = settingsData as SettingsRow | null;

  return {
    error: null,
    company_name: normalizeNullableText(settings?.company_name ?? null),
    staff_role: staffRole,
    staff_role_article: staffRole ? articleFor(staffRole) : null,
  };
}

function articleFor(value: string) {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
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

function normalizeStatus(value: string | undefined, allowedValues: string[]) {
  const normalized = normalizeText(value).toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function resolveAppBaseUrl(request: Request) {
  const originBaseUrl = request.headers.get("Origin");
  const configuredBaseUrl = Deno.env.get("APP_BASE_URL");
  const appBaseUrl = originBaseUrl || configuredBaseUrl;

  if (!appBaseUrl) {
    throw new Error("Request origin is unavailable and APP_BASE_URL is not configured");
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
