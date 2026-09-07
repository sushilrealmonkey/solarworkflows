import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  sendMetaTextTemplate,
} from "../_shared/meta-whatsapp.ts";

import { buildDemoReminderParameters } from "./parameters.ts";

type ClaimedReminder = {
  reminder_id: string;
  company_id: string;
  reminder_type: "one_hour" | "ten_minutes";
  recipient_mobile: string;
  customer_name: string;
  booking_scheduled_for: string;
  meeting_timezone: string;
  meeting_reference: string;
  reschedule_reference: string;
  template_name: string;
  template_language: string;
  sender_meta_phone_number_id: string;
  attempt_count: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    request.headers.get("x-worker-secret") !==
      requireWorkerSecret()
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const service = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const limit = boundedInteger(
    new URL(request.url).searchParams.get("limit"),
    25,
    1,
    100,
  );
  const { data, error } = await service.rpc(
    "claim_demo_booking_reminder_batch",
    { p_limit: limit },
  );
  if (error) {
    console.error("Demo reminder claim failed", error.message);
    return json({ error: "Could not claim demo reminders" }, 500);
  }

  const claimed = (data ?? []) as ClaimedReminder[];
  const result = {
    claimed: claimed.length,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    completionErrors: 0,
  };

  for (const reminder of claimed) {
    try {
      const { data: isReady, error: validationError } = await service.rpc(
        "validate_demo_booking_reminder_send",
        { p_reminder_id: reminder.reminder_id },
      );
      if (validationError) {
        throw new Error(`Eligibility check failed: ${validationError.message}`);
      }
      if (!isReady) {
        result.skipped += 1;
        continue;
      }

      const provider = await sendMetaTextTemplate({
        accessToken: requireEnv("META_WHATSAPP_ACCESS_TOKEN"),
        graphVersion: requireEnv("META_WHATSAPP_GRAPH_API_VERSION"),
        phoneNumberId: reminder.sender_meta_phone_number_id,
        recipient: reminder.recipient_mobile,
        templateName: reminder.template_name,
        languageCode: reminder.template_language,
        parameters: buildDemoReminderParameters(reminder),
      });

      if (!provider.ok || !provider.messageId) {
        const outcome = await failReminder(
          service,
          reminder.reminder_id,
          provider.errorCode ?? `http_${provider.status}`,
          provider.errorMessage,
          provider.retryable,
        );
        if (outcome === "queued") result.retried += 1;
        else result.failed += 1;
        continue;
      }

      const { data: completed, error: completionError } = await service.rpc(
        "complete_demo_booking_reminder",
        {
          p_reminder_id: reminder.reminder_id,
          p_meta_message_id: provider.messageId,
          p_provider_response: provider.payload,
        },
      );
      if (completionError || !completed) {
        // Meta has accepted the message. Never retry this row automatically,
        // because doing so could deliver a duplicate reminder.
        result.completionErrors += 1;
        console.error("Meta accepted demo reminder but completion failed", {
          reminderId: reminder.reminder_id,
          message: completionError?.message ?? "Reminder state changed",
        });
        continue;
      }
      result.sent += 1;
    } catch (workerError) {
      const message = safeErrorMessage(workerError);
      const outcome = await failReminder(
        service,
        reminder.reminder_id,
        "worker_error",
        message,
        false,
      );
      if (outcome === "queued") result.retried += 1;
      else result.failed += 1;
    }
  }

  return json(result);
});

async function failReminder(
  service: ReturnType<typeof createClient>,
  reminderId: string,
  code: string,
  message: string,
  retryable: boolean,
) {
  const { data, error } = await service.rpc("fail_demo_booking_reminder", {
    p_reminder_id: reminderId,
    p_failure_code: code,
    p_failure_message: message,
    p_retryable: retryable,
  });
  if (error) {
    console.error("Could not record demo reminder failure", {
      reminderId,
      message: error.message,
    });
    return "ignored";
  }
  return String(data ?? "ignored");
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : "Unexpected demo reminder worker failure";
  const accessToken = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN")?.trim();
  return (accessToken ? message.replaceAll(accessToken, "[redacted]") : message)
    .replace(/Bearer\s+[^"']+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireWorkerSecret() {
  const dedicatedSecret = Deno.env.get("DEMO_BOOKING_REMINDER_WORKER_SECRET")?.trim();
  if (dedicatedSecret) return dedicatedSecret;

  const sharedNotificationSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET")?.trim();
  if (sharedNotificationSecret) return sharedNotificationSecret;

  throw new Error("DEMO_BOOKING_REMINDER_WORKER_SECRET is required");
}

function boundedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
