import { getServerSupabaseClient } from "../whatsapp/persistence.js";

const ROOT = "/api/trial-outreach";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

type QueueSnapshot = {
  company_id: string;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  enrollment_id: string | null;
  engagement_state: string | null;
  enrollment_status: string | null;
  first_value_at: string | null;
  customer_count: number | string | null;
  lead_count: number | string | null;
  quotation_count: number | string | null;
  site_survey_count: number | string | null;
  project_count: number | string | null;
};

class TrialOutreachApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function isTrialOutreachPath(pathname: string) {
  return pathname === `${ROOT}/queue` ||
    pathname === `${ROOT}/dashboard` ||
    pathname === `${ROOT}/staff` ||
    pathname.startsWith(`${ROOT}/companies/`) ||
    pathname.startsWith(`${ROOT}/touchpoints/`) ||
    pathname.startsWith(`${ROOT}/enrollments/`);
}

export async function handleTrialOutreachRequest(request: Request) {
  try {
    const profile = await requirePlatformAccess(request);
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean).slice(2);

    if (url.pathname === `${ROOT}/queue` && request.method === "GET") {
      return ok(await queue(url));
    }
    if (url.pathname === `${ROOT}/dashboard` && request.method === "GET") {
      return ok(await dashboard());
    }
    if (url.pathname === `${ROOT}/staff` && request.method === "GET") {
      return ok(await staff());
    }

    if (segments[0] === "companies" && segments[1] && request.method === "GET") {
      return ok(await company(requireUuid(segments[1])));
    }

    if (segments[0] === "touchpoints" && segments[1]) {
      const touchpointId = requireUuid(segments[1]);
      if (segments[2] === "claim" && request.method === "POST") {
        return ok(await claimTouchpoint(touchpointId, profile.id));
      }
      if (segments[2] === "outcome" && request.method === "POST") {
        return ok(await recordTouchpointOutcome(touchpointId, profile.id, await body(request)));
      }
      if (segments[2] === "reschedule" && request.method === "POST") {
        return ok(await rescheduleTouchpoint(touchpointId, await body(request)));
      }
    }

    if (segments[0] === "enrollments" && segments[1]) {
      const enrollmentId = requireUuid(segments[1]);
      if (segments[2] === "action" && request.method === "POST") {
        return ok(await enrollmentAction(enrollmentId, profile.id, await body(request)));
      }
      if (segments[2] === "blocker" && request.method === "POST") {
        return ok(await recordBlocker(enrollmentId, profile.id, await body(request)));
      }
    }

    return ok({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof TrialOutreachApiError) return ok({ error: error.message }, error.status);
    console.error("Trial outreach API error", error instanceof Error ? error.message : error);
    return ok({ error: "Trial outreach request failed" }, 500);
  }
}

async function requirePlatformAccess(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new TrialOutreachApiError(401, "Authentication required");

  const client = getServerSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) throw new TrialOutreachApiError(401, "Invalid session");

  const { data: profile, error } = await client
    .from("users_profile")
    .select("id,status,is_super_admin,platform_role")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (error || !profile || profile.status !== "active" || (profile.is_super_admin !== true && profile.platform_role !== "backend_staff")) {
    throw new TrialOutreachApiError(403, "Trial outreach access required");
  }
  return profile as { id: string; is_super_admin: boolean; platform_role: string | null };
}

async function queue(url: URL) {
  const client = getServerSupabaseClient();
  const { data: snapshotData, error: snapshotError } = await client.rpc("get_trial_outreach_snapshots", { p_company_id: null });
  if (snapshotError) throw snapshotError;

  const { data: touchpointData, error: touchpointError } = await client
    .from("trial_outreach_touchpoints")
    .select("id,company_id,enrollment_id,sequence_day,touchpoint_key,channel,status,scheduled_at,assigned_to_profile_id,attempt_count,outcome,failure_message")
    .order("scheduled_at", { ascending: true });
  if (touchpointError) throw touchpointError;

  const { data: staffData, error: staffError } = await client
    .from("users_profile")
    .select("id,full_name")
    .or("is_super_admin.eq.true,platform_role.eq.backend_staff")
    .eq("status", "active");
  if (staffError) throw staffError;

  const staffById = new Map((staffData ?? []).map((member) => [member.id, member.full_name]));
  const touchpoints = touchpointData ?? [];
  const touchpointsByCompany = new Map<string, typeof touchpoints>();
  for (const touchpoint of touchpoints) {
    const rows = touchpointsByCompany.get(touchpoint.company_id) ?? [];
    rows.push(touchpoint);
    touchpointsByCompany.set(touchpoint.company_id, rows);
  }

  const normalizedSearch = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const requestedState = url.searchParams.get("state");
  const requestedStatus = url.searchParams.get("status");
  const requestedDay = Number(url.searchParams.get("day") ?? "0");
  const dueOnly = url.searchParams.get("due") === "true";
  const now = Date.now();

  const snapshots = (snapshotData ?? []) as QueueSnapshot[];
  const companies = snapshots.filter((snapshot) => Boolean(snapshot.enrollment_id)).map((snapshot) => {
    const companyTouchpoints = touchpointsByCompany.get(snapshot.company_id) ?? [];
    const nextTouchpoint = companyTouchpoints.find((touchpoint) => ["queued", "due", "processing"].includes(touchpoint.status));
    const dueCall = companyTouchpoints.find((touchpoint) => touchpoint.channel === "call" && touchpoint.status === "due");
    return {
      ...snapshot,
      trial_day: Math.max(1, Math.min(14, Math.floor((now - new Date(snapshot.trial_started_at).getTime()) / 86400000) + 1)),
      days_remaining: Math.max(0, Math.ceil((new Date(snapshot.trial_ends_at).getTime() - now) / 86400000)),
      first_value_reached: Boolean(snapshot.first_value_at),
      first_value_progress: {
        input_count: Number(snapshot.customer_count ?? 0) + Number(snapshot.lead_count ?? 0),
        workflow_count: Number(snapshot.quotation_count ?? 0) + Number(snapshot.site_survey_count ?? 0) + Number(snapshot.project_count ?? 0),
      },
      next_touchpoint: nextTouchpoint ? {
        id: nextTouchpoint.id,
        key: nextTouchpoint.touchpoint_key,
        channel: nextTouchpoint.channel,
        status: nextTouchpoint.status,
        scheduled_at: nextTouchpoint.scheduled_at,
      } : null,
      due_call: dueCall ? {
        id: dueCall.id,
        assigned_to_profile_id: dueCall.assigned_to_profile_id,
        assigned_to_name: dueCall.assigned_to_profile_id ? staffById.get(dueCall.assigned_to_profile_id) ?? null : null,
        outcome: dueCall.outcome,
      } : null,
    };
  }).filter((company) => {
    if (normalizedSearch && ![company.company_name, company.contact_name, company.contact_email, company.contact_phone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch))) return false;
    if (requestedState && company.engagement_state !== requestedState) return false;
    if (requestedStatus && company.enrollment_status !== requestedStatus) return false;
    if (requestedDay > 0 && company.trial_ends_at) {
      const day = Math.max(1, Math.min(14, Math.floor((now - new Date(company.trial_started_at).getTime()) / 86400000) + 1));
      if (day !== requestedDay) return false;
    }
    if (dueOnly && !company.due_call) return false;
    return true;
  });

  return { companies, staff: staffData ?? [] };
}

async function company(companyId: string) {
  const client = getServerSupabaseClient();
  const [snapshotResult, touchpointResult, interactionResult] = await Promise.all([
    client.rpc("get_trial_outreach_snapshots", { p_company_id: companyId }),
    client.from("trial_outreach_touchpoints")
      .select("id,company_id,enrollment_id,sequence_day,touchpoint_key,channel,status,scheduled_at,claimed_at,sent_at,completed_at,assigned_to_profile_id,attempt_count,provider_message_id,failure_code,failure_message,outcome,metadata")
      .eq("company_id", companyId)
      .order("scheduled_at", { ascending: true }),
    client.from("trial_outreach_interactions")
      .select("id,company_id,enrollment_id,touchpoint_id,channel,interaction_type,outcome,blocker,notes,recorded_by_profile_id,metadata,occurred_at,created_at")
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false }),
  ]);
  if (snapshotResult.error) throw snapshotResult.error;
  if (touchpointResult.error) throw touchpointResult.error;
  if (interactionResult.error) throw interactionResult.error;
  const snapshot = snapshotResult.data?.[0] ?? null;
  if (!snapshot) throw new TrialOutreachApiError(404, "Trial outreach enrollment was not found");
  return { snapshot, touchpoints: touchpointResult.data ?? [], interactions: interactionResult.data ?? [] };
}

async function dashboard() {
  const client = getServerSupabaseClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const { data, error } = await client.rpc("trial_outreach_dashboard_summary", {
    report_start: formatDate(start),
    report_end: formatDate(end),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function staff() {
  const { data, error } = await getServerSupabaseClient()
    .from("users_profile")
    .select("id,full_name,email,status,platform_role,is_super_admin")
    .eq("status", "active")
    .or("is_super_admin.eq.true,platform_role.eq.backend_staff")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function claimTouchpoint(id: string, profileId: string) {
  const client = getServerSupabaseClient();
  const { data, error } = await client
    .from("trial_outreach_touchpoints")
    .update({ assigned_to_profile_id: profileId, status: "due" })
    .eq("id", id)
    .in("status", ["queued", "due"])
    .select("id,assigned_to_profile_id,status")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TrialOutreachApiError(409, "This call task is no longer available");
  return data;
}

async function recordTouchpointOutcome(id: string, profileId: string, input: JsonObject) {
  const outcome = enumText(input.outcome, ["connected", "no_answer", "requested_callback", "wrong_number", "do_not_contact", "resolved", "not_resolved"]);
  const notes = optionalText(input.notes, 2000);
  const blocker = optionalText(input.blocker, 120);
  const client = getServerSupabaseClient();
  const { data: touchpoint, error: touchpointError } = await client
    .from("trial_outreach_touchpoints")
    .select("id,company_id,enrollment_id,channel")
    .eq("id", id)
    .maybeSingle();
  if (touchpointError) throw touchpointError;
  if (!touchpoint) throw new TrialOutreachApiError(404, "Touchpoint was not found");

  const { error } = await client
    .from("trial_outreach_touchpoints")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      outcome,
      assigned_to_profile_id: profileId,
      metadata: { notes, blocker },
    })
    .eq("id", id);
  if (error) throw error;

  const interactionType = outcome === "connected" ? "call_connected" : "call_attempt";
  const { error: interactionError } = await client.from("trial_outreach_interactions").insert({
    company_id: touchpoint.company_id,
    enrollment_id: touchpoint.enrollment_id,
    touchpoint_id: touchpoint.id,
    channel: touchpoint.channel,
    interaction_type: interactionType,
    outcome,
    blocker,
    notes,
    recorded_by_profile_id: profileId,
    metadata: {},
  });
  if (interactionError) throw interactionError;

  if (outcome === "do_not_contact") {
    await stopEnrollment(client, touchpoint.enrollment_id, "opted_out", profileId);
  } else if (blocker) {
    await client.from("trial_outreach_enrollments")
      .update({ last_blocker: blocker })
      .eq("id", touchpoint.enrollment_id);
  }
  return { ok: true };
}

async function rescheduleTouchpoint(id: string, input: JsonObject) {
  const scheduledAt = dateText(input.scheduled_at);
  const client = getServerSupabaseClient();
  const { data, error } = await client
    .from("trial_outreach_touchpoints")
    .update({ status: "queued", scheduled_at: scheduledAt, claimed_at: null, failure_code: null, failure_message: null })
    .eq("id", id)
    .in("status", ["due", "failed", "queued"])
    .select("id,scheduled_at,status")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TrialOutreachApiError(409, "This touchpoint cannot be rescheduled");
  return data;
}

async function enrollmentAction(id: string, profileId: string, input: JsonObject) {
  const action = enumText(input.action, ["pause", "resume", "stop", "complete"]);
  const client = getServerSupabaseClient();
  if (action === "resume") {
    const { error } = await client.from("trial_outreach_enrollments")
      .update({ status: "active", engagement_state: "started_stalled", paused_at: null, stop_reason: null, completed_at: null })
      .eq("id", id);
    if (error) throw error;
    await client.from("trial_outreach_touchpoints")
      .update({ status: "queued", outcome: null })
      .eq("enrollment_id", id)
      .eq("status", "cancelled")
      .eq("outcome", "paused");
  } else {
    const nextStatus = action === "pause" ? "paused" : action === "stop" ? "opted_out" : "completed";
    await stopEnrollment(client, id, nextStatus, profileId);
  }
  await client.from("trial_outreach_interactions").insert({
    company_id: await enrollmentCompanyId(client, id),
    enrollment_id: id,
    channel: "in_app",
    interaction_type: "status_change",
    outcome: action,
    recorded_by_profile_id: profileId,
    metadata: {},
  });
  return { ok: true, action };
}

async function recordBlocker(id: string, profileId: string, input: JsonObject) {
  const blocker = enumText(input.blocker, ["setup", "time", "unclear_next_step", "technical_issue", "pricing", "other"]);
  const notes = optionalText(input.notes, 2000);
  const client = getServerSupabaseClient();
  const companyId = await enrollmentCompanyId(client, id);
  const { error } = await client.from("trial_outreach_enrollments")
    .update({ last_blocker: blocker })
    .eq("id", id);
  if (error) throw error;
  const { error: interactionError } = await client.from("trial_outreach_interactions").insert({
    company_id: companyId,
    enrollment_id: id,
    channel: "in_app",
    interaction_type: "blocker",
    blocker,
    notes,
    recorded_by_profile_id: profileId,
    metadata: {},
  });
  if (interactionError) throw interactionError;
  return { ok: true };
}

async function stopEnrollment(client: ReturnType<typeof getServerSupabaseClient>, id: string, status: string, profileId: string) {
  const reason = status === "paused" ? "paused" : status === "opted_out" ? "do_not_contact" : "completed";
  const { error } = await client.from("trial_outreach_enrollments")
    .update({ status, engagement_state: status === "paused" ? "paused" : status === "opted_out" ? "opted_out" : "engaged", stop_reason: reason, paused_at: status === "paused" ? new Date().toISOString() : null, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  const { error: cancelError } = await client.from("trial_outreach_touchpoints")
    .update({ status: "cancelled", outcome: reason })
    .eq("enrollment_id", id)
    .in("status", ["queued", "due"]);
  if (cancelError) throw cancelError;
  void profileId;
}

async function enrollmentCompanyId(client: ReturnType<typeof getServerSupabaseClient>, id: string) {
  const { data, error } = await client.from("trial_outreach_enrollments").select("company_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new TrialOutreachApiError(404, "Enrollment was not found");
  return data.company_id as string;
}

async function body(request: Request): Promise<JsonObject> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as JsonObject;
  } catch {
    throw new TrialOutreachApiError(400, "A JSON request body is required");
  }
}

function requireUuid(value: string) {
  if (!UUID_PATTERN.test(value)) throw new TrialOutreachApiError(400, "Invalid identifier");
  return value;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new TrialOutreachApiError(400, "Text value is too long");
  return normalized;
}

function enumText(value: unknown, allowed: string[]) {
  const normalized = String(value ?? "").trim();
  if (!allowed.includes(normalized)) throw new TrialOutreachApiError(400, "Unsupported outreach value");
  return normalized;
}

function dateText(value: unknown) {
  const normalized = String(value ?? "").trim();
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) throw new TrialOutreachApiError(400, "A valid scheduled time is required");
  return new Date(timestamp).toISOString();
}

function formatDate(value: Date) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function ok(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
