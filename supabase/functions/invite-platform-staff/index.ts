import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type RequestBody = {
  action?: "invite" | "delete";
  staff_id?: string;
  full_name?: string;
  email?: string;
  role?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "*";
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401, headers);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const caller = createClient(supabaseUrl, requiredEnv("SUPABASE_ANON_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: isSuperAdmin, error: accessError } = await caller.rpc("is_super_admin");
    if (accessError || !isSuperAdmin) {
      return json({ error: "Only super admins can create platform staff" }, 403, headers);
    }

    const body = await request.json() as RequestBody;
    const service = createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (body.action === "delete") {
      return await deletePlatformStaff(service, body.staff_id, headers);
    }

    const fullName = normalizeName(body.full_name);
    const email = normalizeEmail(body.email);
    if (body.role !== "backend_staff") {
      return json({ error: "Unsupported platform role" }, 400, headers);
    }

    const redirectTo = `${appBaseUrl(request)}/create-password`;
    const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, staff_role: "Backend Staff" },
    });
    if (inviteError || !invite.user) {
      return json({ error: inviteError?.message ?? "Unable to send staff invite" }, 400, headers);
    }

    const { data: profile, error: profileError } = await service
      .from("users_profile")
      .insert({
        auth_user_id: invite.user.id,
        full_name: fullName,
        email,
        status: "active",
        is_super_admin: false,
        platform_role: "backend_staff",
        invited_at: new Date().toISOString(),
      })
      .select("id,full_name,email,status,platform_role,invited_at")
      .single();

    if (profileError || !profile) {
      await service.auth.admin.deleteUser(invite.user.id);
      return json({ error: profileError?.message ?? "Unable to create staff profile" }, 400, headers);
    }

    return json({ staff: profile }, 201, headers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 400, headers);
  }
});

async function deletePlatformStaff(
  service: ReturnType<typeof createClient>,
  value: unknown,
  headers: Record<string, string>,
) {
  const staffId = normalizeUuid(value);
  const { data: staff, error: staffError } = await service
    .from("users_profile")
    .select("id,auth_user_id,platform_role")
    .eq("id", staffId)
    .eq("platform_role", "backend_staff")
    .maybeSingle();

  if (staffError || !staff) {
    return json({ error: "Backend Staff account was not found" }, 404, headers);
  }

  // Block API access before deleting Auth because existing access tokens can
  // remain valid until expiry even after an Auth user is removed.
  const { error: deactivateError } = await service
    .from("users_profile")
    .update({ status: "inactive" })
    .eq("id", staff.id)
    .eq("platform_role", "backend_staff");
  if (deactivateError) return json({ error: deactivateError.message }, 400, headers);

  if (staff.auth_user_id) {
    const { error: authError } = await service.auth.admin.deleteUser(staff.auth_user_id);
    if (authError) return json({ error: authError.message }, 400, headers);
  }

  const { error: profileError } = await service
    .from("users_profile")
    .delete()
    .eq("id", staff.id)
    .eq("platform_role", "backend_staff");
  if (profileError) return json({ error: profileError.message }, 400, headers);

  return json({ deleted: true, staff_id: staff.id }, 200, headers);
}

function normalizeName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 120) throw new Error("Name must be 2 to 120 characters");
  return name;
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  return email;
}

function normalizeUuid(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid platform staff selection");
  }
  return id;
}

function appBaseUrl(request: Request) {
  const configuredBaseUrl = normalizeBaseUrl(Deno.env.get("APP_BASE_URL"));
  const originBaseUrl = normalizeBaseUrl(request.headers.get("origin"));
  const allowedOrigins = new Set([
    configuredBaseUrl,
    ...(Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map(normalizeBaseUrl),
  ].filter(Boolean).map((value) => value.toLowerCase()));
  if (originBaseUrl && allowedOrigins.has(originBaseUrl.toLowerCase())) return originBaseUrl;
  if (configuredBaseUrl) return configuredBaseUrl;
  throw new Error("APP_BASE_URL is not configured");
}

function normalizeBaseUrl(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return Response.json(body, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}
