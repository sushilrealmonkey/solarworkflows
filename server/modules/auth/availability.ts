import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const SIGNUP_AVAILABILITY_PATH = "/api/auth/signup-availability";

type SignupIdentifier =
  | { type: "email"; value: string }
  | { type: "phone"; value: string };

let adminClient: SupabaseClient | null = null;

export async function handleSignupAvailabilityRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, { Allow: "POST" });
  }

  let identifier: SignupIdentifier;
  try {
    identifier = parseIdentifier(await request.json());
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Invalid request" });
  }

  try {
    return jsonResponse(200, { registered: await isRegistered(identifier) });
  } catch (error) {
    console.error("Signup availability check failed:", error);
    return jsonResponse(503, { error: "Account availability could not be checked." });
  }
}

function parseIdentifier(value: unknown): SignupIdentifier {
  if (!value || typeof value !== "object") throw new Error("Email or phone is required.");
  const body = value as Record<string, unknown>;
  const rawValue = typeof body.value === "string" ? body.value.trim() : "";

  if (body.type === "email") {
    const email = rawValue.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    return { type: "email", value: email };
  }

  if (body.type === "phone") {
    const phone = rawValue.replace(/[() .-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Enter a valid phone number with its country code.");
    return { type: "phone", value: phone };
  }

  throw new Error("Email or phone is required.");
}

async function isRegistered(identifier: SignupIdentifier): Promise<boolean> {
  const client = getAdminClient();
  const perPage = 1_000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (data.users.some((user) => matchesIdentifier(user, identifier))) return true;
    if (data.users.length < perPage) return false;
  }
}

function matchesIdentifier(user: User, identifier: SignupIdentifier): boolean {
  return identifier.type === "email"
    ? user.email?.trim().toLowerCase() === identifier.value
    : user.phone?.trim().replace(/[() .-]/g, "") === identifier.value;
}

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Supabase server credentials are not configured.");

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return adminClient;
}

function jsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
