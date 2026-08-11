import { getServerSupabaseClient } from "../whatsapp/persistence.js";
import { requireAuthenticatedClient, requireMobileContext, requirePermission, type MobileRequestContext } from "./auth.js";
import { errorResponse, json, MobileApiError } from "./errors.js";
import { getResource, listResource, resources } from "./resources.js";
import { createMobileRecord } from "./writes.js";

export const MOBILE_API_ROOT = "/api/mobile/v1";
export function isMobileApiPath(pathname: string) { return pathname === MOBILE_API_ROOT || pathname.startsWith(`${MOBILE_API_ROOT}/`); }

export async function handleMobileApiRequest(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id")?.slice(0, 80) || crypto.randomUUID();
  try {
    const url = new URL(request.url); const path = url.pathname.slice(MOBILE_API_ROOT.length).split("/").filter(Boolean);
    if (path[0] === "enrollment" && request.method === "POST") return json(await enroll(request, await request.json()), 201, requestId);
    const context = await requireMobileContext(request);
    if (request.method === "GET" && path.join("/") === "session/context") return json(await sessionContext(context), 200, requestId);
    if (request.method === "GET" && path[0] === "dashboard") return json(await dashboard(context, requestId), 200, requestId);
    if (path[0] === "assistant" && request.method === "POST") return await assistant(context, path[1], await request.text(), requestId);
    if (path[0] === "notifications") return json(await notifications(context, request, url, path), 200, requestId);
    if (path[0] === "devices" && request.method === "POST") return json(await registerDevice(context, await request.json()), 200, requestId);
    if (path[0] === "devices" && path[1] && request.method === "DELETE") return json(await revokeDevice(context, path[1]), 200, requestId);
    if (path[0] === "field") return json(await fieldWork(context, request, path.slice(1)), 200, requestId);
    if (path[0] && resources[path[0]]) {
      if (request.method === "GET" && path.length === 1) return json(await listResource(context, path[0], url, requestId), 200, requestId);
      if (request.method === "POST" && path.length === 1) return json({ data: await createMobileRecord(context, path[0], await request.json()), meta: { requestId, createdAt: new Date().toISOString() } }, 201, requestId);
      if (request.method === "GET" && path.length === 2) return json({ data: await getResource(context, path[0], path[1]), meta: { requestId, fetchedAt: new Date().toISOString() } }, 200, requestId);
    }
    throw new MobileApiError(404, "NOT_FOUND", "Endpoint not found");
  } catch (error) { return errorResponse(error, requestId); }
}

async function sessionContext(context: MobileRequestContext) {
  const [organization, settings, roleResult, subscription, permissionResult] = await Promise.all([
    context.client.from("organizations").select("id,name,status").eq("id", context.profile.organization_id).single(), context.client.rpc("get_organization_settings"),
    context.client.rpc("get_current_user_role_names"), context.client.rpc("get_current_subscription_access"),
    context.client.rpc("get_current_user_permissions"),
  ]);
  if (organization.error) throw organization.error; const s = settings.data ?? {};
  if (permissionResult.error) throw permissionResult.error;
  const permissionRows = (permissionResult.data ?? []) as Array<{ module_key: string; action_key: string; record_scope: string }>;
  const modules = [...new Set(permissionRows.map((row) => row.module_key))];
  return { user: { id: context.user.id, profileId: context.profile.id, fullName: context.profile.full_name, phone: context.profile.phone }, tenant: { companyId: context.profile.company_id, organizationId: context.profile.organization_id, name: organization.data.name, status: organization.data.status }, branding: { logoUrl: s.company_logo_url ?? null, primaryColor: s.primary_color ?? "#0f766e", secondaryColor: s.secondary_color ?? "#06173f", accentColor: s.accent_color ?? "#f97316", timezone: s.timezone ?? "Asia/Kolkata", currency: s.currency ?? "INR" }, roles: (roleResult.data ?? []).map((r: { role_name: string }) => r.role_name), permissions: modules.map((module) => ({ module, actions: permissionRows.filter((row) => row.module_key === module).map((row) => row.action_key), scopes: [...new Set(permissionRows.filter((row) => row.module_key === module).map((row) => row.record_scope))] })).filter((p) => p.actions.length), subscription: subscription.data ? { status: subscription.data.status, writeAllowed: subscription.data.write_allowed, enabledModules: subscription.data.enabled_modules ?? [], moduleAccess: subscription.data.module_access ?? {}, capabilityAccess: subscription.data.capability_access ?? {}, seatLimit: subscription.data.seat_limit ?? null, seatsUsed: subscription.data.seats_used ?? 0 } : null };
}

async function fieldWork(context: MobileRequestContext, request: Request, path: string[]) {
  const resource = path[0];
  const id = path[1];
  if (resource === "site-surveys") {
    if (request.method === "GET") {
      await requirePermission(context, "site_surveys", "view");
      const { data, error } = await context.client.rpc("get_field_site_surveys", { target_survey_id: id ?? null });
      if (error) throw error;
      return { data: id ? (data ?? [])[0] ?? null : data ?? [] };
    }
    if (!id) throw new MobileApiError(400, "VALIDATION_ERROR", "Survey id is required");
    const body = await request.json() as Record<string, unknown>;
    if (request.method === "PATCH" && path[2] === "technical") {
      await requirePermission(context, "site_surveys", "update_technical");
      const { data, error } = await context.client.rpc("update_field_site_survey_technical", { target_survey_id: id, technical_patch: body });
      if (error) throw error; return { data };
    }
    if (request.method === "POST" && path[2] === "status") {
      await requirePermission(context, "site_surveys", "update_status");
      const { data, error } = await context.client.rpc("update_field_site_survey_status", { target_survey_id: id, new_status: body.status });
      if (error) throw error; return { data };
    }
    if (request.method === "POST" && path[2] === "evidence") {
      await requirePermission(context, "site_surveys", "upload_evidence");
      const { data, error } = await context.client.rpc("register_field_survey_evidence", { target_survey_id: id, evidence_kind: body.kind, evidence: body.evidence });
      if (error) throw error; return { data };
    }
  }
  if (resource === "projects") {
    if (request.method === "GET") {
      await requirePermission(context, "projects", "view");
      const { data, error } = await context.client.rpc("get_field_projects", { target_project_id: id ?? null });
      if (error) throw error;
      return { data: id ? (data ?? [])[0] ?? null : data ?? [] };
    }
    if (request.method === "POST" && id && path[2] === "status") {
      await requirePermission(context, "projects", "update_status");
      const body = await request.json() as { status?: string };
      const { data, error } = await context.client.rpc("update_field_project_status", { target_project_id: id, new_status: body.status });
      if (error) throw error; return { data };
    }
  }
  throw new MobileApiError(404, "NOT_FOUND", "Field work endpoint not found");
}

async function dashboard(context: MobileRequestContext, requestId: string) {
  await requirePermission(context, "dashboard", "view"); const org = context.profile.organization_id;
  const { data: fieldStatusPermission } = await context.client.rpc("user_has_permission", { module: "projects", action: "update_status" });
  if (fieldStatusPermission === true) {
    const [surveyResult, projectResult] = await Promise.all([
      context.client.rpc("get_field_site_surveys", { target_survey_id: null }),
      context.client.rpc("get_field_projects", { target_project_id: null }),
    ]);
    if (surveyResult.error) throw surveyResult.error;
    if (projectResult.error) throw projectResult.error;
    const surveys = (surveyResult.data ?? []) as Array<{ survey_status?: string }>;
    const projects = (projectResult.data ?? []) as Array<{ project_status?: string }>;
    return { data: { openEnquiries: 0, activeProjects: projects.length, dueFollowups: surveys.filter((row) => row.survey_status !== "completed" && row.survey_status !== "cancelled").length, recentActivity: [] }, meta: { requestId, fetchedAt: new Date().toISOString() } };
  }
  const [leads, projects, followups, activity] = await Promise.all([
    context.client.from("leads").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "open"),
    context.client.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", org).not("project_status", "in", "(completed,cancelled)"),
    context.client.from("lead_followups").select("id", { count: "exact", head: true }).eq("organization_id", org).lte("followup_date", new Date(Date.now() + 86400000).toISOString()),
    context.client.from("activity_logs").select("id,module,action,record_id,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(8),
  ]);
  return { data: { openEnquiries: leads.count ?? 0, activeProjects: projects.count ?? 0, dueFollowups: followups.count ?? 0, recentActivity: activity.data ?? [] }, meta: { requestId, fetchedAt: new Date().toISOString() } };
}

async function notifications(context: MobileRequestContext, request: Request, url: URL, path: string[]) {
  if (request.method === "GET" && path[1] === "unread-count") { const { data, error } = await context.client.rpc("my_in_app_notification_unread_count"); if (error) throw error; return { count: Number(data ?? 0) }; }
  if (request.method === "GET" && path.length === 1) { const { data, error } = await context.client.rpc("list_my_in_app_notifications", { p_limit: Math.min(Number(url.searchParams.get("limit") ?? 20), 50), p_unread_only: url.searchParams.get("unread") === "true", p_before_created_at: null, p_before_id: null }); if (error) throw error; return { data: data ?? [] }; }
  if (request.method === "POST" && path[1] === "read-all") { const { error } = await context.client.rpc("mark_all_in_app_notifications_read"); if (error) throw error; return { updated: true }; }
  if (request.method === "POST" && path[2] === "read") { const { error } = await context.client.rpc("mark_in_app_notification_read", { p_receipt_id: path[1] }); if (error) throw error; return { updated: true }; }
  throw new MobileApiError(404, "NOT_FOUND", "Notification endpoint not found");
}

async function registerDevice(context: MobileRequestContext, raw: unknown) {
  const body = raw as Record<string, unknown>; if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(body.expoPushToken ?? ""))) throw new MobileApiError(422, "VALIDATION_FAILED", "A valid Expo push token is required");
  if (body.platform !== "android" && body.platform !== "ios") throw new MobileApiError(422, "VALIDATION_FAILED", "Platform must be android or ios");
  const { error } = await getServerSupabaseClient().from("mobile_devices").upsert({ company_id: context.profile.company_id, user_profile_id: context.profile.id, auth_user_id: context.user.id, expo_push_token: body.expoPushToken, platform: body.platform, device_id: String(body.deviceId ?? "").slice(0, 200), app_version: String(body.appVersion ?? "unknown").slice(0, 40), locale: String(body.locale ?? "en-IN").slice(0, 20), last_seen_at: new Date().toISOString(), revoked_at: null }, { onConflict: "auth_user_id,device_id" });
  if (error) throw error; return { registered: true };
}

async function revokeDevice(context: MobileRequestContext, deviceId: string) {
  const decoded = decodeURIComponent(deviceId).slice(0, 200);
  const { error } = await getServerSupabaseClient().from("mobile_devices").update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("auth_user_id", context.user.id).eq("company_id", context.profile.company_id).eq("device_id", decoded);
  if (error) throw error;
  return { revoked: true };
}

async function assistant(context: MobileRequestContext, endpoint: string | undefined, rawBody: string, requestId: string) {
  await requirePermission(context, "dashboard", "view");
  const functionName = endpoint === "brief" ? "assistant-brief" : endpoint === "chat" ? "assistant-chat" : null;
  if (!functionName) throw new MobileApiError(404, "NOT_FOUND", "Assistant endpoint not found");
  const url = process.env.SUPABASE_URL; if (!url) throw new Error("SUPABASE_URL must be configured");
  const response = await fetch(`${url}/functions/v1/${functionName}`, { method: "POST", headers: { authorization: `Bearer ${context.token}`, "content-type": "application/json", "x-request-id": requestId }, body: rawBody || "{}", signal: AbortSignal.timeout(endpoint === "chat" ? 90_000 : 30_000) });
  const headers = new Headers(response.headers); headers.set("x-request-id", requestId); headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

async function enroll(request: Request, raw: unknown) {
  const { client } = await requireAuthenticatedClient(request); const body = raw as Record<string, unknown>;
  const organizationName = String(body.organizationName ?? "").trim(); const fullName = String(body.fullName ?? "").trim();
  if (organizationName.length < 2 || fullName.length < 2) throw new MobileApiError(422, "VALIDATION_FAILED", "Organization and full name are required");
  const { data, error } = await client.rpc("self_create_epc_workspace", { p_organization_name: organizationName, p_full_name: fullName, p_phone: typeof body.phone === "string" ? body.phone : null });
  if (error) throw new MobileApiError(error.code === "23505" ? 409 : 422, error.code === "23505" ? "CONFLICT" : "VALIDATION_FAILED", error.message); return { workspace: data };
}
