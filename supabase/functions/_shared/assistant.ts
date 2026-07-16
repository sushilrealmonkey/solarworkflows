import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type AssistantProfile = {
  id: string;
  organization_id: string;
  full_name: string | null;
  is_super_admin: boolean | null;
  status: string | null;
};

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function requireEnv(name: string) {
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

// The assistant endpoints are authenticated by the caller's JWT (no cookies),
// so a wildcard origin is safe and keeps local dev working. Allowlisted
// origins are still echoed back for clients that need a concrete origin.
export function resolveCorsOrigin(request: Request) {
  const originBaseUrl = normalizeBaseUrl(request.headers.get("Origin"));

  if (originBaseUrl && appOriginAllowList().has(originBaseUrl.toLowerCase())) {
    return originBaseUrl;
  }

  return "*";
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Creates a Supabase client that runs every query as the calling user. RLS is
// the security boundary for all assistant data access; the service role is
// never used here.
export function createCallerClient(authorization: string) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");

  return createClient(supabaseUrl, supabaseAnonKey, {
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
}

export async function resolveCallerProfile(
  client: SupabaseClient,
): Promise<{ profile: AssistantProfile | null; error: string | null }> {
  const { data: userData, error: userError } = await client.auth.getUser();

  if (userError || !userData?.user) {
    return { profile: null, error: "Authentication is required" };
  }

  const { data, error } = await client
    .from("users_profile")
    .select("id, organization_id, full_name, is_super_admin, status")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return { profile: null, error: error.message };
  }

  if (!data || !data.organization_id) {
    return { profile: null, error: "No organization is assigned to this user" };
  }

  if (data.status && data.status !== "active") {
    return { profile: null, error: "This account is not active" };
  }

  return { profile: data as AssistantProfile, error: null };
}

// Accepts the user's local calendar date from the client so "today" follows
// the user's timezone, with a UTC fallback when it is missing or malformed.
export function resolveLocalDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date().toISOString().slice(0, 10);
}
