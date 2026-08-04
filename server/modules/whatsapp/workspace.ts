import type { User } from "@supabase/supabase-js";
import { getServerSupabaseClient } from "./persistence.js";

const ROOT = "/api/whatsapp";
type JsonObject = Record<string, unknown>;
class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function isWhatsAppWorkspacePath(pathname: string) {
  return ["contact-lists", "campaigns", "campaign-control", "conversations",
    "conversation-messages", "settings", "worker-health", "process-now",
    "daily-queue", "campaign-daily-limit"]
    .some((path) => pathname === `${ROOT}/${path}`);
}

export async function handleWhatsAppWorkspaceRequest(request: Request) {
  try {
    const user = await requireWhatsAppAccess(request);
    const url = new URL(request.url);
    if (url.pathname === `${ROOT}/contact-lists`) {
      if (request.method === "GET") return ok({ contactLists: await listContactLists() });
      if (request.method === "POST") return ok(await importContactList(await body(request), user), 201);
    }
    if (url.pathname === `${ROOT}/campaigns`) {
      if (request.method === "GET") return ok({ campaigns: await listCampaigns() });
      if (request.method === "POST") return ok(await createCampaign(await body(request), user), 201);
    }
    if (url.pathname === `${ROOT}/campaign-control` && request.method === "POST")
      return ok(await controlCampaign(await body(request)));
    if (url.pathname === `${ROOT}/campaign-daily-limit` && request.method === "PUT")
      return ok(await updateCampaignDailyLimit(await body(request)));
    if (url.pathname === `${ROOT}/daily-queue`) {
      if (request.method === "GET")
        return ok({ queue: await listDailyQueue(uuid(url.searchParams.get("campaignId"))) });
      if (request.method === "PUT")
        return ok(await markDailyQueueInCrm(await body(request), user));
    }
    if (url.pathname === `${ROOT}/worker-health` && request.method === "GET")
      return ok({ worker: await getWorkerHealth() });
    if (url.pathname === `${ROOT}/process-now` && request.method === "POST")
      return ok({ result: await processCampaignsNow() });
    if (url.pathname === `${ROOT}/conversations` && request.method === "GET")
      return ok({ conversations: await listConversations() });
    if (url.pathname === `${ROOT}/conversation-messages` && request.method === "GET")
      return ok({ messages: await listConversationMessages(uuid(url.searchParams.get("conversationId"))) });
    if (url.pathname === `${ROOT}/settings`) {
      if (request.method === "GET") return ok({ settings: await getSettings() });
      if (request.method === "PUT") return ok({ settings: await saveSettings(await body(request), user) });
    }
    return ok({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof ApiError) return ok({ error: error.message }, error.status);
    console.error("WhatsApp workspace API error", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes("must be configured"))
      return ok({ error: "WhatsApp server configuration is incomplete" }, 503);
    return ok({ error: "WhatsApp workspace request failed" }, 500);
  }
}

async function requireWhatsAppAccess(request: Request): Promise<User> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ApiError("Authentication required", 401);
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new ApiError("Invalid session", 401);
  const { data: profile } = await supabase.from("users_profile").select("status,is_super_admin,platform_role")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (!profile || profile.status !== "active" || (profile.is_super_admin !== true && profile.platform_role !== "backend_staff"))
    throw new ApiError("WhatsApp Outreach access required", 403);
  return data.user;
}

async function listContactLists() {
  const { data, error } = await getServerSupabaseClient().from("whatsapp_contact_lists")
    .select("id,company_id,name,source_filename,contact_count,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function importContactList(input: JsonObject, user: User) {
  const name = text(input.name, 120);
  const phoneNumberId = uuid(input.phoneNumberId);
  const { data: phone, error: phoneError } = await getServerSupabaseClient()
    .from("whatsapp_phone_numbers")
    .select("company_id")
    .eq("id", phoneNumberId)
    .eq("is_active", true)
    .maybeSingle();
  if (phoneError || !phone) {
    throw new ApiError("The selected WhatsApp sender was not found", 400);
  }
  const companyId = phone.company_id;
  if (!Array.isArray(input.contacts) || input.contacts.length < 1 || input.contacts.length > 10_000)
    throw new ApiError("Upload between 1 and 10,000 contacts", 400);
  const seen = new Set<string>();
  const contacts = input.contacts.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("Invalid contact row", 400);
    const row = raw as JsonObject;
    const phone = phoneNumber(row.phoneNumber);
    if (seen.has(phone)) throw new ApiError(`Duplicate phone number: ${phone}`, 400);
    seen.add(phone);
    return { company_id: companyId, phone_number: phone, name: optionalText(row.name, 200),
      custom_fields: objectValue(row.customFields), consent_status: "confirmed" };
  });
  const supabase = getServerSupabaseClient();
  const { data: list, error: listError } = await supabase.from("whatsapp_contact_lists")
    .insert({ company_id: companyId, name, source_filename: optionalText(input.filename, 255),
      contact_count: contacts.length, created_by: user.id }).select("id").single();
  if (listError || !list) throw listError ?? new Error("Contact list was not created");
  const { error } = await supabase.from("whatsapp_contacts")
    .insert(contacts.map((contact) => ({ ...contact, contact_list_id: list.id })));
  if (error) {
    await supabase.from("whatsapp_contact_lists").delete().eq("id", list.id);
    throw error;
  }
  return { id: list.id, imported: contacts.length };
}

async function listCampaigns() {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase.from("whatsapp_campaigns")
    .select("id,company_id,name,status,template_name,template_language,batch_size,delay_seconds,daily_message_limit,daily_send_time,send_timezone,scheduled_at,started_at,completed_at,next_batch_at,created_at,whatsapp_contact_lists(name,contact_count),whatsapp_phone_numbers(display_phone_number,verified_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const campaigns = data ?? [];
  if (!campaigns.length) return [];

  const { data: recipientData, error: recipientError } = await supabase
    .from("whatsapp_campaign_recipients")
    .select("campaign_id,status,failure_reason,attempt_count,attempted_at,whatsapp_contacts(name,phone_number),whatsapp_messages(status,failure_error_code,failure_error_title,failure_error_message)")
    .in("campaign_id", campaigns.map((campaign) => campaign.id))
    .order("attempted_at", { ascending: false, nullsFirst: false });
  if (recipientError) throw recipientError;

  const summaries = new Map<string, {
    counts: Record<string, number>;
    failures: Array<{
      contactName: string | null;
      phoneSuffix: string;
      reason: string;
      code: string | null;
    }>;
  }>();
  for (const recipient of recipientData ?? []) {
    const summary = summaries.get(recipient.campaign_id) ?? {
      counts: { queued: 0, processing: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 },
      failures: [],
    };
    const message = relationOne(recipient.whatsapp_messages);
    const contact = relationOne(recipient.whatsapp_contacts);
    const effectiveStatus = message?.status === "delivered" ||
      message?.status === "read" || message?.status === "failed"
      ? message.status
      : recipient.status;
    summary.counts[effectiveStatus] = (summary.counts[effectiveStatus] ?? 0) + 1;
    const reason = message?.failure_error_message ??
      message?.failure_error_title ?? recipient.failure_reason;
    if (reason && summary.failures.length < 5) {
      summary.failures.push({
        contactName: contact?.name ?? null,
        phoneSuffix: String(contact?.phone_number ?? "").slice(-4),
        reason,
        code: message?.failure_error_code ?? null,
      });
    }
    summaries.set(recipient.campaign_id, summary);
  }

  return campaigns.map((campaign) => ({
    ...campaign,
    recipientSummary: summaries.get(campaign.id) ?? {
      counts: { queued: 0, processing: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 },
      failures: [],
    },
  }));
}

async function getWorkerHealth() {
  const { data, error } = await getServerSupabaseClient()
    .rpc("get_whatsapp_worker_health");
  if (error) throw error;
  const row = data?.[0] ?? null;
  return {
    cronActive: row?.cron_active ?? false,
    lastRunAt: row?.last_run_at ?? null,
    lastRunStatus: row?.last_run_status ?? null,
    lastHttpStatus: row?.last_http_status ?? null,
    lastResponse: parseWorkerResponse(row?.last_response),
    nextRunAt: row?.next_run_at ?? null,
    testMode: process.env.WHATSAPP_CAMPAIGN_TEST_MODE !== "false",
  };
}

async function processCampaignsNow() {
  const response = await fetch(
    `${serverEnv("SUPABASE_URL")}/functions/v1/process-whatsapp-campaigns?limit=25`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
        "x-worker-secret": serverEnv("WHATSAPP_CAMPAIGN_WORKER_SECRET"),
      },
      body: "{}",
      signal: AbortSignal.timeout(65_000),
    },
  );
  const payload = await response.json().catch(() => null) as JsonObject | null;
  if (!response.ok || !payload) {
    throw new ApiError("The campaign worker could not be invoked", 502);
  }
  return payload;
}

async function createCampaign(input: JsonObject, user: User) {
  const phoneNumberId = uuid(input.phoneNumberId);
  const listId = uuid(input.contactListId);
  const supabase = getServerSupabaseClient();
  const [{ data: phone, error: phoneError }, { data: list, error: listError }] =
    await Promise.all([
      supabase.from("whatsapp_phone_numbers").select("company_id")
        .eq("id", phoneNumberId).eq("is_active", true).maybeSingle(),
      supabase.from("whatsapp_contact_lists").select("company_id")
        .eq("id", listId).maybeSingle(),
    ]);
  if (phoneError || !phone) throw new ApiError("The selected WhatsApp sender was not found", 400);
  if (listError || !list) throw new ApiError("The selected contact list was not found", 400);
  if (phone.company_id !== list.company_id) {
    throw new ApiError("Choose a contact list imported for this WhatsApp sender", 400);
  }
  const companyId = phone.company_id;
  const { data: contacts, error: contactError } = await supabase.from("whatsapp_contacts")
    .select("id").eq("contact_list_id", listId).eq("company_id", companyId)
    .eq("consent_status", "confirmed");
  if (contactError || !contacts?.length) throw new ApiError("The selected list has no opted-in contacts", 400);
  const scheduledAt = optionalText(input.scheduledAt, 40);
  const { data: campaign, error } = await supabase.from("whatsapp_campaigns").insert({
    company_id: companyId, whatsapp_phone_number_id: phoneNumberId,
    contact_list_id: listId, name: text(input.name, 120),
    template_name: text(input.templateName, 512),
    template_language: text(input.templateLanguage, 20),
    variable_mappings: Array.isArray(input.variableMappings) ? input.variableMappings : [],
    batch_size: integer(input.batchSize, 1, 100),
    daily_message_limit: integer(input.dailyMessageLimit, 1, 10000),
    daily_send_time: timeOfDay(input.dailySendTime),
    send_timezone: timeZone(input.sendTimezone),
    delay_seconds: integer(input.delaySeconds, 1, 3600),
    scheduled_at: scheduledAt, status: scheduledAt ? "scheduled" : "draft", created_by: user.id,
  }).select("id,status").single();
  if (error || !campaign) throw error ?? new Error("Campaign was not created");
  const { error: recipientError } = await supabase.from("whatsapp_campaign_recipients")
    .insert(contacts.map((contact) => ({ company_id: companyId, campaign_id: campaign.id, contact_id: contact.id })));
  if (recipientError) throw recipientError;
  return campaign;
}

async function controlCampaign(input: JsonObject) {
  const action = text(input.action, 20);
  const next = action === "start" || action === "resume" ? "running"
    : action === "pause" ? "paused" : action === "cancel" ? "cancelled" : null;
  if (!next) throw new ApiError("Invalid campaign action", 400);
  const campaignId = uuid(input.campaignId);
  const supabase = getServerSupabaseClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("whatsapp_campaigns")
    .select("id,company_id,status")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) throw new ApiError("Campaign not found", 404);

  if (action === "start" || action === "resume") {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [{ data: settings, error: settingsError },
      { count: campaignsStarted, error: campaignCountError },
      { count: messagesSent, error: messageCountError }] = await Promise.all([
      supabase.from("whatsapp_outreach_settings")
        .select("daily_campaign_limit,daily_message_limit")
        .eq("company_id", campaign.company_id).maybeSingle(),
      supabase.from("whatsapp_campaigns").select("id", { count: "exact", head: true })
        .eq("company_id", campaign.company_id)
        .gte("started_at", dayStart.toISOString())
        .neq("status", "cancelled")
        .neq("id", campaign.id),
      supabase.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("company_id", campaign.company_id)
        .eq("direction", "outbound")
        .gte("source_timestamp", dayStart.toISOString()),
    ]);
    if (settingsError || campaignCountError || messageCountError) {
      throw new Error("Could not validate campaign safety limits");
    }
    const dailyCampaignLimit = settings?.daily_campaign_limit ?? 10;
    const dailyMessageLimit = settings?.daily_message_limit ?? 100;
    if (action === "start" && (campaignsStarted ?? 0) >= dailyCampaignLimit) {
      throw new ApiError(`Daily campaign limit of ${dailyCampaignLimit} has been reached`, 409);
    }
    if ((messagesSent ?? 0) >= dailyMessageLimit)
      throw new ApiError(`Company daily message limit of ${dailyMessageLimit} has been reached`, 409);
  }

  const patch: JsonObject = { status: next };
  if (action === "start") patch.started_at = new Date().toISOString();
  if (action === "cancel") patch.completed_at = new Date().toISOString();
  const { data, error } = await supabase.from("whatsapp_campaigns")
    .update(patch).eq("id", campaignId).select("id,status").single();
  if (error) throw error;
  if (action === "cancel") {
    const { error: cancelError } = await supabase.from("whatsapp_campaign_recipients")
      .update({ status: "skipped", failure_reason: "Campaign cancelled" })
      .eq("campaign_id", campaignId)
      .eq("status", "queued");
    if (cancelError) throw cancelError;
  }
  return data;
}

async function updateCampaignDailyLimit(input: JsonObject) {
  const campaignId = uuid(input.campaignId);
  const dailyMessageLimit = integer(input.dailyMessageLimit, 1, 10000);
  const dailySendTime = timeOfDay(input.dailySendTime);
  const sendTimezone = timeZone(input.sendTimezone);
  const { data, error } = await getServerSupabaseClient().from("whatsapp_campaigns")
    .update({ daily_message_limit: dailyMessageLimit, daily_send_time: dailySendTime,
      send_timezone: sendTimezone })
    .eq("id", campaignId)
    .select("id,daily_message_limit,daily_send_time,send_timezone")
    .single();
  if (error) throw error;
  return data;
}

async function listDailyQueue(campaignId: string) {
  const supabase = getServerSupabaseClient();
  const { data: campaign, error: campaignError } = await supabase
    .from("whatsapp_campaigns")
    .select("id,name,daily_message_limit,daily_send_time,send_timezone")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) throw new ApiError("Campaign not found", 404);

  const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const campaignDay = dateInTimeZone(new Date(), campaign.send_timezone);
  const { data: attempted, error: attemptedError } = await supabase
    .from("whatsapp_campaign_recipients")
    .select("id,status,attempted_at,crm_marked_at,whatsapp_contacts(name,phone_number),whatsapp_messages(status,source_timestamp)")
    .eq("campaign_id", campaignId)
    .gte("attempted_at", recentCutoff.toISOString())
    .order("attempted_at", { ascending: true });
  if (attemptedError) throw attemptedError;

  const attemptedRows = (attempted ?? []).filter((row) => row.attempted_at &&
    dateInTimeZone(new Date(row.attempted_at), campaign.send_timezone) === campaignDay);
  const sentToday = attemptedRows.filter((row) => {
    const message = relationOne(row.whatsapp_messages);
    return ["sent", "delivered", "read"].includes(message?.status ?? row.status);
  }).length;
  const queuedSlots = Math.max(campaign.daily_message_limit - attemptedRows.length, 0);
  const { data: queued, error: queuedError } = queuedSlots > 0
    ? await supabase.from("whatsapp_campaign_recipients")
      .select("id,status,attempted_at,crm_marked_at,whatsapp_contacts(name,phone_number),whatsapp_messages(status,source_timestamp)")
      .eq("campaign_id", campaignId).eq("status", "queued")
      .order("created_at", { ascending: true }).limit(queuedSlots)
    : { data: [], error: null };
  if (queuedError) throw queuedError;

  const rows = [...attemptedRows, ...(queued ?? [])].map((row) => {
    const contact = relationOne(row.whatsapp_contacts);
    const message = relationOne(row.whatsapp_messages);
    return {
      id: row.id,
      name: contact?.name ?? null,
      phoneNumber: contact?.phone_number ?? "",
      status: message?.status ?? row.status,
      sentAt: message?.source_timestamp ?? row.attempted_at,
      crmMarkedAt: row.crm_marked_at,
    };
  });
  return { campaignId, campaignName: campaign.name, dailyMessageLimit: campaign.daily_message_limit,
    sentToday, remainingToday: queuedSlots, rows };
}

async function markDailyQueueInCrm(input: JsonObject, user: User) {
  const campaignId = uuid(input.campaignId);
  if (!Array.isArray(input.recipientIds) || input.recipientIds.length < 1 || input.recipientIds.length > 1000)
    throw new ApiError("Select between 1 and 1,000 contacts", 400);
  const recipientIds = input.recipientIds.map(uuid);
  const marked = input.marked !== false;
  const { data, error } = await getServerSupabaseClient().from("whatsapp_campaign_recipients")
    .update({ crm_marked_at: marked ? new Date().toISOString() : null,
      crm_marked_by: marked ? user.id : null })
    .eq("campaign_id", campaignId)
    .in("id", recipientIds)
    .select("id");
  if (error) throw error;
  return { updated: data?.length ?? 0 };
}

async function listConversations() {
  const { data, error } = await getServerSupabaseClient().from("whatsapp_conversations")
    .select("id,company_id,contact_wa_id,contact_name,last_message_at,whatsapp_phone_numbers(display_phone_number,verified_name)")
    .order("last_message_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}
async function listConversationMessages(conversationId: string) {
  const { data, error } = await getServerSupabaseClient().from("whatsapp_messages")
    .select("id,direction,status,message_type,text_body,source_timestamp")
    .eq("conversation_id", conversationId).order("source_timestamp", { ascending: true }).limit(200);
  if (error) throw error;
  return data ?? [];
}
async function getSettings() {
  const { data, error } = await getServerSupabaseClient().from("whatsapp_outreach_settings")
    .select("company_id,default_batch_size,default_delay_seconds,opt_out_keywords,daily_campaign_limit,daily_message_limit,updated_at")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}
async function saveSettings(input: JsonObject, user: User) {
  const value = { company_id: uuid(input.companyId),
    default_batch_size: integer(input.defaultBatchSize, 1, 100),
    default_delay_seconds: integer(input.defaultDelaySeconds, 1, 3600),
    daily_campaign_limit: integer(input.dailyCampaignLimit, 1, 100),
    daily_message_limit: integer(input.dailyMessageLimit, 1, 10000),
    opt_out_keywords: stringArray(input.optOutKeywords, 20, 40), updated_by: user.id };
  const { data, error } = await getServerSupabaseClient().from("whatsapp_outreach_settings")
    .upsert(value).select("company_id,default_batch_size,default_delay_seconds,opt_out_keywords,daily_campaign_limit,daily_message_limit,updated_at").single();
  if (error) throw error;
  return data;
}

async function body(request: Request): Promise<JsonObject> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Invalid JSON body", 400);
  return value as JsonObject;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new ApiError("A required field is invalid", 400);
  return value.trim();
}
function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, max);
}
function uuid(value: unknown) {
  const result = text(value, 40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result))
    throw new ApiError("Invalid identifier", 400);
  return result;
}
function phoneNumber(value: unknown) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (!/^[1-9]\d{7,14}$/.test(digits))
    throw new ApiError("Every phone number must include its country code", 400);
  return digits;
}
function integer(value: unknown, min: number, max: number) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new ApiError("A numeric setting is invalid", 400);
  return result;
}
function timeOfDay(value: unknown) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new ApiError("Choose a valid daily send time", 400);
  return value;
}
function timeZone(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 100)
    throw new ApiError("A valid timezone is required", 400);
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); }
  catch { throw new ApiError("A valid timezone is required", 400); }
  return value;
}
function dateInTimeZone(value: Date, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}
function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) throw new ApiError("Invalid keyword list", 400);
  return value.map((item) => text(item, maxLength).toLowerCase());
}
function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function relationOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
function parseWorkerResponse(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : null;
  } catch {
    return null;
  }
}
function serverEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value.replace(/\/+$/, "");
}
function ok(value: JsonObject, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
