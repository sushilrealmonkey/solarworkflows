import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type InviteStaffRequestBody = {
  action?: "invite" | "update_invited" | "resend" | "delete";
  staff_id?: string;
  full_name?: string;
  phone?: string | null;
  email?: string;
  role_id?: string | null;
  status?: string;
};

type StaffProfileRow = {
  id: string;
  organization_id: string | null;
  auth_user_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
};

type SettingsStaffRow = {
  id: string;
  role_id: string | null;
  role_name: string | null;
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

    const body = (await request.json()) as InviteStaffRequestBody;
    const action = body.action ?? "invite";

    if (!["invite", "update_invited", "resend", "delete"].includes(action)) {
      return jsonResponse({ error: "Unsupported staff action" }, 400);
    }

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

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (action !== "invite") {
      return await handleExistingStaffAction({
        action,
        body,
        callerClient,
        serviceClient,
        appBaseUrl,
      });
    }

    const payload = validateInviteBody(body);
    const inviteMetadata = await resolveInviteMetadata(callerClient, payload.role_id);

    if (inviteMetadata.error) {
      return jsonResponse({ error: inviteMetadata.error }, 400);
    }

    // Authorize and persist the staff profile BEFORE any privileged action.
    // create_settings_staff enforces the settings:update permission and email
    // uniqueness, so the service-role invite below only runs for authorized callers
    // and can no longer be abused to send arbitrary invitation emails.
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
      return jsonResponse(
        { error: staffError?.message ?? "Unable to create staff profile" },
        400,
      );
    }

    const staff = staffData as StaffProfileRow;

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
      // The invite failed after the profile was created; remove the orphan row.
      await serviceClient.from("users_profile").delete().eq("id", staff.id);
      return jsonResponse(
        { error: inviteError?.message ?? "Unable to send staff invite" },
        400,
      );
    }

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
}

async function handleExistingStaffAction({
  action,
  body,
  callerClient,
  serviceClient,
  appBaseUrl,
}: {
  action: "update_invited" | "resend" | "delete";
  body: InviteStaffRequestBody;
  callerClient: ReturnType<typeof createClient>;
  serviceClient: ReturnType<typeof createClient>;
  appBaseUrl: string;
}) {
  const staffId = normalizeUuid(body.staff_id);
  const { data: visibleStaffData, error: accessError } =
    await callerClient.rpc("get_settings_staff");

  if (accessError) {
    return jsonResponse({ error: accessError.message }, 403);
  }

  const visibleStaff = ((visibleStaffData ?? []) as SettingsStaffRow[]).find(
    (candidate) => candidate.id === staffId,
  );

  if (!visibleStaff) {
    return jsonResponse({ error: "Staff profile was not found" }, 404);
  }

  const { data: profileData, error: profileError } = await serviceClient
    .from("users_profile")
    .select("id, organization_id, auth_user_id, full_name, phone, email, status")
    .eq("id", staffId)
    .maybeSingle();

  if (profileError || !profileData) {
    return jsonResponse(
      { error: profileError?.message ?? "Staff profile was not found" },
      profileError ? 400 : 404,
    );
  }

  const profile = profileData as StaffProfileRow;

  if (profile.status !== "invited") {
    return jsonResponse(
      { error: "This action is only available for invited staff" },
      409,
    );
  }

  if (action === "delete") {
    if (profile.auth_user_id) {
      const { error: authDeleteError } =
        await serviceClient.auth.admin.deleteUser(profile.auth_user_id);

      if (authDeleteError) {
        return jsonResponse({ error: authDeleteError.message }, 400);
      }
    }

    const { error: profileDeleteError } = await serviceClient
      .from("users_profile")
      .delete()
      .eq("id", profile.id)
      .eq("organization_id", profile.organization_id);

    if (profileDeleteError) {
      return jsonResponse({ error: profileDeleteError.message }, 400);
    }

    return jsonResponse({ deleted: true, staff_id: profile.id });
  }

  if (action === "resend") {
    const email = normalizeEmail(profile.email ?? "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "The invited staff email is invalid" }, 400);
    }

    const inviteMetadata = await resolveInviteMetadata(
      callerClient,
      visibleStaff.role_id,
    );

    if (inviteMetadata.error) {
      return jsonResponse({ error: inviteMetadata.error }, 400);
    }

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${appBaseUrl}/create-password`,
        data: {
          full_name: profile.full_name,
          company_name: inviteMetadata.company_name,
          staff_role: inviteMetadata.staff_role,
          staff_role_article: inviteMetadata.staff_role_article,
        },
      });

    if (inviteError || !inviteData.user) {
      return jsonResponse(
        { error: inviteError?.message ?? "Unable to resend staff invite" },
        400,
      );
    }

    const { error: linkError } = await serviceClient
      .from("users_profile")
      .update({
        auth_user_id: inviteData.user.id,
        invited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("organization_id", profile.organization_id);

    if (linkError) {
      return jsonResponse({ error: linkError.message }, 400);
    }

    return jsonResponse({ invite_email_sent: true, staff_id: profile.id });
  }

  const payload = validateInviteBody({ ...body, status: "invited" });
  const previousEmail = normalizeEmail(profile.email ?? "");
  const emailChanged = payload.email !== previousEmail;

  if (emailChanged && profile.auth_user_id) {
    const { error: authUpdateError } =
      await serviceClient.auth.admin.updateUserById(profile.auth_user_id, {
        email: payload.email,
      });

    if (authUpdateError) {
      return jsonResponse({ error: authUpdateError.message }, 400);
    }
  }

  const { data: updatedStaff, error: updateError } = await callerClient.rpc(
    "update_settings_staff",
    {
      target_profile_id: profile.id,
      full_name: payload.full_name,
      phone: payload.phone,
      email: payload.email,
      role_id: payload.role_id,
      status: "invited",
    },
  );

  if (updateError) {
    if (emailChanged && profile.auth_user_id && previousEmail) {
      await serviceClient.auth.admin.updateUserById(profile.auth_user_id, {
        email: previousEmail,
      });
    }

    return jsonResponse({ error: updateError.message }, 400);
  }

  return jsonResponse({
    ...(updatedStaff as StaffProfileRow),
    email_changed: emailChanged,
  });
}

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

function normalizeUuid(value: string | undefined) {
  const normalized = normalizeText(value);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new Error("Invalid staff selection");
  }

  return normalized;
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
