import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { renderTrialOutreachEmail } from "../_shared/trial-outreach-email.ts";

type JsonObject = Record<string, unknown>;

type Snapshot = {
  company_id: string;
  organization_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  admin_profile_id: string | null;
  admin_last_login_at: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  subscription_status: string;
  enrollment_id: string | null;
  enrollment_status: string | null;
  engagement_state: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  last_activity_at: string | null;
  first_customer_at: string | null;
  first_lead_at: string | null;
  first_quotation_at: string | null;
  first_site_survey_at: string | null;
  first_project_at: string | null;
  customer_count: number | string | null;
  lead_count: number | string | null;
  quotation_count: number | string | null;
  site_survey_count: number | string | null;
  project_count: number | string | null;
  first_value_at: string | null;
  first_value_kind: string | null;
  timezone: string;
  preferred_language: "en" | "hi" | string;
  whatsapp_recipient_id: string | null;
  whatsapp_opted_in: boolean;
  email_opted_in: boolean;
};

type ClaimedTouchpoint = {
  touchpoint_id: string;
  company_id: string;
  enrollment_id: string;
  sequence_day: number;
  touchpoint_key: string;
  channel: "email" | "whatsapp" | "call";
  scheduled_at: string;
  attempt_count: number;
  assigned_to_profile_id: string | null;
};

type PlatformStaff = {
  id: string;
  full_name: string | null;
};

const PLAN_TOUCHPOINT_KEYS = new Set([
  "trial_activation_quick_start",
  "trial_activation_setup_help",
  "trial_activation_blocker_check",
  "trial_activation_assisted_setup",
  "trial_activation_midpoint",
  "trial_activation_use_case",
  "trial_activation_three_days",
  "trial_activation_one_day",
  "trial_activation_expired",
]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-secret") !== requiredEnv("TRIAL_OUTREACH_WORKER_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (Deno.env.get("TRIAL_OUTREACH_ENABLED") === "false") {
    return json({ mode: "disabled" });
  }

  const service = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const testMode = Deno.env.get("TRIAL_OUTREACH_TEST_MODE") !== "false";

  try {
    const ensured = await service.rpc("ensure_trial_outreach_enrollments");
    if (ensured.error) throw ensured.error;

    const snapshots = await loadSnapshots(service);
    const snapshotByCompany = new Map(snapshots.map((snapshot) => [snapshot.company_id, snapshot]));
    const existingWelcomeCompanies = await loadExistingWelcomeCompanies(service);
    let evaluated = 0;
    let scheduled = 0;
    let cancelled = 0;

    for (const snapshot of snapshots) {
      if (!snapshot.enrollment_id) continue;
      const state = deriveState(snapshot);
      const update = await updateEnrollment(service, snapshot, state);
      if (update.error) throw update.error;
      evaluated += 1;

      const shouldStop = state.status !== "active";
      if (shouldStop) {
        const cancellation = service
          .from("trial_outreach_touchpoints")
          .update({
            status: "cancelled",
            outcome: state.stopReason,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", snapshot.company_id)
          .eq("enrollment_id", snapshot.enrollment_id)
          .eq("status", "queued");
        const result = state.status === "expired"
          ? await cancellation.neq("touchpoint_key", "trial_activation_expired")
          : await cancellation;
        if (result.error) throw result.error;
        cancelled += result.count ?? 0;
      }

      const scheduledResult = await service.rpc("schedule_trial_outreach_touchpoints", {
        p_company_id: snapshot.company_id,
      });
      if (scheduledResult.error) throw scheduledResult.error;
      scheduled += Number(scheduledResult.data ?? 0);

      if (snapshot.first_value_at) {
        const cancelledActivationTouches = await service
          .from("trial_outreach_touchpoints")
          .update({ status: "cancelled", outcome: "first_value_reached", updated_at: new Date().toISOString() })
          .eq("company_id", snapshot.company_id)
          .eq("enrollment_id", snapshot.enrollment_id)
          .in("status", ["queued", "due"])
          .neq("touchpoint_key", "trial_activation_expired");
        if (cancelledActivationTouches.error) throw cancelledActivationTouches.error;
        cancelled += cancelledActivationTouches.count ?? 0;
      }
    }

    const staff = await loadPlatformStaff(service);
    const claimed = await claimTouchpoints(service);
    const summary = {
      evaluated,
      scheduled,
      claimed: claimed.length,
      emailSent: 0,
      whatsappQueued: 0,
      callsDue: 0,
      testSkipped: 0,
      skipped: 0,
      failed: 0,
      cancelled,
    };

    let staffCursor = 0;
    for (const touchpoint of claimed) {
      const snapshot = snapshotByCompany.get(touchpoint.company_id);
      if (!snapshot || snapshot.enrollment_id !== touchpoint.enrollment_id) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "snapshot_missing");
        summary.skipped += 1;
        continue;
      }

      const state = deriveState(snapshot);
      const isFinalExpiredMessage =
        state.status === "expired" && touchpoint.touchpoint_key === "trial_activation_expired";
      if (state.status !== "active" && !isFinalExpiredMessage) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "cancelled", state.stopReason);
        summary.cancelled += 1;
        continue;
      }

      if (
        touchpoint.sequence_day === 1 &&
        touchpoint.touchpoint_key === "trial_activation_quick_start" &&
        existingWelcomeCompanies.has(snapshot.company_id)
      ) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "existing_trial_welcome");
        summary.skipped += 1;
        continue;
      }

      if (testMode && touchpoint.channel !== "call") {
        await releaseTouchpoint(service, touchpoint.touchpoint_id);
        summary.testSkipped += 1;
        continue;
      }

      if (touchpoint.channel === "call") {
        if (snapshot.first_value_at) {
          await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "first_value_reached");
          summary.skipped += 1;
          continue;
        }
        if (!staff.length) {
          await releaseTouchpoint(service, touchpoint.touchpoint_id);
          summary.skipped += 1;
          continue;
        }

        const assignee = staff[staffCursor % staff.length];
        staffCursor += 1;
        const result = await service
          .from("trial_outreach_touchpoints")
          .update({
            status: "due",
            assigned_to_profile_id: assignee.id,
            claimed_at: null,
            metadata: {
              assigned_name: assignee.full_name,
              call_script: callScript(snapshot),
            },
          })
          .eq("id", touchpoint.touchpoint_id)
          .eq("status", "processing");
        if (result.error) throw result.error;
        summary.callsDue += 1;
        continue;
      }

      if (touchpoint.channel === "email") {
        if (!snapshot.contact_email || !snapshot.email_opted_in) {
          await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "email_unavailable");
          summary.skipped += 1;
          continue;
        }

        try {
          const sent = await sendEmail(snapshot, touchpoint.touchpoint_key, touchpoint.id);
          await completeTouchpoint(service, touchpoint.touchpoint_id, "sent", sent.id, {
            provider: "resend",
          });
          summary.emailSent += 1;
        } catch (error) {
          await failTouchpoint(service, touchpoint.touchpoint_id, errorMessage(error));
          summary.failed += 1;
        }
        continue;
      }

      if (!snapshot.whatsapp_opted_in || !snapshot.whatsapp_recipient_id) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "whatsapp_not_opted_in");
        summary.skipped += 1;
        continue;
      }

      if (!PLAN_TOUCHPOINT_KEYS.has(touchpoint.touchpoint_key)) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "unsupported_template");
        summary.skipped += 1;
        continue;
      }

      const activeTemplate = await hasActiveWhatsAppTemplate(service, touchpoint.touchpoint_key, snapshot.preferred_language);
      if (!activeTemplate) {
        await settleTouchpoint(service, touchpoint.touchpoint_id, "skipped", "whatsapp_template_not_approved");
        summary.skipped += 1;
        continue;
      }

      try {
        const queued = await queueWhatsApp(service, snapshot, touchpoint);
        await completeTouchpoint(service, touchpoint.touchpoint_id, "sent", null, {
          provider: "notification_pipeline",
          notification_event_id: queued.eventId,
          notification_delivery_id: queued.deliveryId,
        });
        summary.whatsappQueued += 1;
      } catch (error) {
        await failTouchpoint(service, touchpoint.touchpoint_id, errorMessage(error));
        summary.failed += 1;
      }
    }

    return json({
      mode: testMode ? "test" : "live",
      ...summary,
    });
  } catch (error) {
    console.error("Trial outreach worker failed", error);
    return json({ error: errorMessage(error) }, 500);
  }
});

async function loadSnapshots(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_trial_outreach_snapshots", { p_company_id: null });
  if (error) throw error;
  return (data ?? []) as Snapshot[];
}

function deriveState(snapshot: Snapshot) {
  const now = Date.now();
  const trialEnded = new Date(snapshot.trial_ends_at).getTime() <= now;
  if (snapshot.enrollment_status === "paused") {
    return { status: "paused" as const, engagementState: "paused", stopReason: "paused" };
  }
  if (snapshot.enrollment_status === "opted_out") {
    return { status: "opted_out" as const, engagementState: "opted_out", stopReason: "whatsapp_opt_out" };
  }
  if (snapshot.enrollment_status === "completed") {
    return { status: "completed" as const, engagementState: snapshot.engagement_state ?? "engaged", stopReason: "completed" };
  }
  if (["active", "grandfathered", "past_due"].includes(snapshot.subscription_status) && snapshot.first_value_at) {
    return { status: "converted" as const, engagementState: "converted", stopReason: "paid_subscription" };
  }
  if (["active", "grandfathered", "past_due"].includes(snapshot.subscription_status) && snapshot.subscription_status !== "trialing") {
    return { status: "converted" as const, engagementState: "converted", stopReason: "paid_subscription" };
  }
  if (trialEnded || snapshot.subscription_status === "expired") {
    return { status: "expired" as const, engagementState: "expired", stopReason: "trial_expired" };
  }

  if (snapshot.first_value_at) {
    const lastActivity = snapshot.last_activity_at ? new Date(snapshot.last_activity_at).getTime() : 0;
    const inactive = !lastActivity || now - lastActivity > 2 * 86400000;
    return {
      status: "active" as const,
      engagementState: inactive ? "activated_inactive" : "engaged",
      stopReason: null,
    };
  }

  return {
    status: "active" as const,
    engagementState: snapshot.last_login_at ? "started_stalled" : "never_started",
    stopReason: null,
  };
}

async function updateEnrollment(client: SupabaseClient, snapshot: Snapshot, state: {
  status: "active" | "converted" | "expired" | "paused" | "opted_out" | "completed";
  engagementState: string;
  stopReason: string | null;
}) {
  if (!snapshot.enrollment_id) return { error: null };
  return client
    .from("trial_outreach_enrollments")
    .update({
      status: state.status,
      engagement_state: state.engagementState,
      first_login_at: snapshot.first_login_at ?? snapshot.last_login_at,
      last_login_at: snapshot.last_login_at,
      first_value_at: snapshot.first_value_at,
      first_value_kind: snapshot.first_value_kind,
      last_activity_at: snapshot.last_activity_at,
      last_evaluated_at: new Date().toISOString(),
      stop_reason: state.stopReason,
      completed_at: state.status === "active" ? null : new Date().toISOString(),
    })
    .eq("id", snapshot.enrollment_id)
    .eq("company_id", snapshot.company_id);
}

async function loadPlatformStaff(client: SupabaseClient) {
  const { data, error } = await client
    .from("users_profile")
    .select("id,full_name")
    .eq("status", "active")
    .or("is_super_admin.eq.true,platform_role.eq.backend_staff")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlatformStaff[];
}

async function loadExistingWelcomeCompanies(client: SupabaseClient) {
  const [emailWelcome, whatsappWelcome] = await Promise.all([
    client
      .from("trial_signup_notification_outbox")
      .select("company_id")
      .eq("notification_type", "trial_welcome")
      .eq("status", "sent"),
    client
      .from("notification_events")
      .select("company_id")
      .eq("event_type", "account_welcome"),
  ]);
  if (emailWelcome.error) throw emailWelcome.error;
  if (whatsappWelcome.error) throw whatsappWelcome.error;
  return new Set([
    ...(emailWelcome.data ?? []).map((row) => row.company_id),
    ...(whatsappWelcome.data ?? []).map((row) => row.company_id),
  ]);
}

async function claimTouchpoints(client: SupabaseClient) {
  const { data, error } = await client.rpc("claim_trial_outreach_touchpoints", { p_limit: 200 });
  if (error) throw error;
  return (data ?? []) as ClaimedTouchpoint[];
}

async function hasActiveWhatsAppTemplate(client: SupabaseClient, key: string, language: string) {
  const { data, error } = await client
    .from("notification_templates")
    .select("notification_key,language_code")
    .eq("notification_key", key)
    .eq("provider", "meta")
    .eq("approval_status", "active")
    .eq("is_active", true)
    .in("language_code", language === "hi" ? ["hi", "en_US"] : ["en_US", "en"])
    .limit(1);
  if (error) throw error;
  return Boolean((data ?? []).length);
}

async function queueWhatsApp(client: SupabaseClient, snapshot: Snapshot, touchpoint: ClaimedTouchpoint) {
  const payload = {
    first_name: snapshot.contact_name ?? "there",
    company_name: snapshot.company_name ?? "your solar team",
    trial_end_date: formatDate(snapshot.trial_ends_at, snapshot.timezone),
    next_step_url: appUrl("/dashboard"),
    progress: progressText(snapshot),
    support_phone: supportPhone(),
  };
  const { data, error } = await client.rpc("queue_notification_event", {
    p_company_id: snapshot.company_id,
    p_event_type: "trial_activation",
    p_source_type: "trial_outreach_touchpoint",
    p_source_record_id: touchpoint.touchpoint_id,
    p_idempotency_key: `trial-outreach:${touchpoint.touchpoint_id}`,
    p_payload: payload,
    p_notification_key: touchpoint.touchpoint_key,
    p_scheduled_at: new Date().toISOString(),
    p_recipient_id: snapshot.whatsapp_recipient_id,
  });
  if (error) throw error;

  const row = (data as Array<{ event_id?: string; delivery_count?: number; already_queued?: boolean }> | null)?.[0];
  if (!row?.event_id || (!row.already_queued && Number(row.delivery_count ?? 0) < 1)) {
    throw new Error("No eligible WhatsApp delivery was created");
  }

  const delivery = await client
    .from("notification_deliveries")
    .select("id")
    .eq("event_id", row.event_id)
    .eq("company_id", snapshot.company_id)
    .eq("recipient_id", snapshot.whatsapp_recipient_id)
    .maybeSingle();
  if (delivery.error) throw delivery.error;

  if (!delivery.data?.id) throw new Error("Notification event has no eligible WhatsApp delivery");
  return { eventId: row.event_id, deliveryId: delivery.data.id };
}

async function sendEmail(snapshot: Snapshot, touchpointKey: string, touchpointId: string) {
  const email = renderTrialOutreachEmail({
    touchpointKey,
    language: snapshot.preferred_language === "hi" ? "hi" : "en",
    firstName: firstName(snapshot.contact_name),
    companyName: snapshot.company_name ?? "your solar team",
    trialEndDate: formatDate(snapshot.trial_ends_at, snapshot.timezone),
    nextStepUrl: appUrl(touchpointKey === "trial_activation_expired" ? "/billing/plans" : "/dashboard"),
    supportPhone: supportPhone(),
    progress: progressText(snapshot),
    blocker: null,
  });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `trial-outreach-email/${snapshot.company_id}/${touchpointId}`,
    },
    body: JSON.stringify({
      from: requiredEnv("TRIAL_REMINDER_FROM_EMAIL"),
      to: [snapshot.contact_email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: "email_type", value: "trial_outreach" },
        { name: "company_id", value: snapshot.company_id },
        { name: "touchpoint_key", value: touchpointKey },
      ],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? `Resend returned ${response.status}`);
  return { id: payload?.id ?? null };
}

async function completeTouchpoint(
  client: SupabaseClient,
  id: string,
  status: "sent" | "delivered" | "read",
  providerMessageId: string | null,
  metadata: JsonObject,
) {
  const { error } = await client
    .from("trial_outreach_touchpoints")
    .update({
      status,
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
      metadata,
    })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw error;
}

async function settleTouchpoint(client: SupabaseClient, id: string, status: "skipped" | "cancelled", reason: string) {
  const { error } = await client
    .from("trial_outreach_touchpoints")
    .update({ status, outcome: reason, failure_code: reason })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw error;
}

async function releaseTouchpoint(client: SupabaseClient, id: string) {
  const { error } = await client
    .from("trial_outreach_touchpoints")
    .update({ status: "queued", claimed_at: null })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw error;
}

async function failTouchpoint(client: SupabaseClient, id: string, message: string) {
  const { error } = await client
    .from("trial_outreach_touchpoints")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_code: "worker_error",
      failure_message: message,
    })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw error;
}

function progressText(snapshot: Snapshot) {
  const inputCount = Number(snapshot.customer_count ?? 0) + Number(snapshot.lead_count ?? 0);
  const workflowCount = Number(snapshot.quotation_count ?? 0) + Number(snapshot.site_survey_count ?? 0) + Number(snapshot.project_count ?? 0);
  if (snapshot.first_value_at) return "You have already reached a first result. The next step is to return and keep the workflow moving.";
  if (inputCount > 0) return "You have started with a lead or customer. Complete one quotation, survey, or project step to see the full value.";
  if (snapshot.last_login_at) return "You have logged in. Create one real lead or customer to start your first useful workflow.";
  if (workflowCount > 0) return "Your workflow records are ready for the next step.";
  return "Your workspace is ready for its first real workflow.";
}

function callScript(snapshot: Snapshot) {
  const name = firstName(snapshot.contact_name);
  return `Hi ${name}, this is the Bizlee team. I’m calling to help you complete one real solar workflow. We can start with one enquiry or customer and finish it together in about 15 minutes.`;
}

function firstName(value: string | null) {
  return (value ?? "there").trim().split(/\s+/)[0] || "there";
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone || "Asia/Kolkata",
  }).format(new Date(value));
}

function appUrl(path: string) {
  return `${requiredEnv("APP_BASE_URL").replace(/\/+$/, "")}${path}`;
}

function supportPhone() {
  return Deno.env.get("TRIAL_OUTREACH_SUPPORT_PHONE")?.trim() || "your Bizlee support team";
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected worker failure";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
