import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getServerSupabaseClient } from "../whatsapp/persistence.js";
import { MobileApiError } from "./errors.js";

export interface MobileRequestContext {
  token: string; user: User; client: SupabaseClient;
  profile: { id: string; full_name: string | null; phone: string | null; company_id: string; organization_id: string; status: string };
}
export async function requireAuthenticatedClient(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new MobileApiError(401, "AUTH_REQUIRED", "Authentication is required");
  const admin = getServerSupabaseClient();
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new MobileApiError(401, "INVALID_SESSION", "The session is invalid or expired");
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be configured");
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { token, user: authData.user, client };
}
export async function requireMobileContext(request: Request): Promise<MobileRequestContext> {
  const authenticated = await requireAuthenticatedClient(request);
  const admin = getServerSupabaseClient();
  const { data: profile, error } = await admin.from("users_profile").select("id,full_name,phone,company_id,organization_id,status,is_super_admin,platform_role").eq("auth_user_id", authenticated.user.id).maybeSingle();
  if (error) throw error;
  if (!profile) throw new MobileApiError(403, "ACCOUNT_UNASSIGNED", "Complete workspace enrollment to continue");
  if (profile.status !== "active") throw new MobileApiError(403, "ACCOUNT_INACTIVE", "This account is inactive");
  if (profile.is_super_admin || profile.platform_role) throw new MobileApiError(403, "FORBIDDEN", "The mobile app is available to tenant staff only");
  if (!profile.company_id || !profile.organization_id) throw new MobileApiError(403, "TENANT_REQUIRED", "A tenant workspace is required");
  return { ...authenticated, profile: profile as MobileRequestContext["profile"] };
}
export async function requirePermission(context: MobileRequestContext, module: string, action: string) {
  const { data, error } = await context.client.rpc("user_has_permission", { module, action });
  if (error) throw error;
  if (!data) throw new MobileApiError(403, "FORBIDDEN", `Missing ${module}:${action} permission`);
}
