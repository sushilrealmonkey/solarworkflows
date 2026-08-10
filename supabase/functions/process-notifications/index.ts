import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  normalizePhone,
  sendMetaTextTemplate,
} from "../_shared/meta-whatsapp.ts";

type ClaimedDelivery = {
  delivery_id: string;
  company_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  phone_e164: string;
  full_name: string | null;
  company_name: string;
  template_name: string;
  template_language: string;
  variable_schema: unknown;
  attempt_count: number;
};

type ClaimedReplyAlert = {
  delivery_id: string;
  company_id: string;
  sender_meta_phone_number_id: string;
  phone_e164: string;
  contact_name: string;
  contact_mobile: string;
  reply_preview: string;
  received_at: string;
  attempt_count: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    request.headers.get("x-worker-secret") !==
      requireEnv("NOTIFICATION_WORKER_SECRET")
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const testMode = Deno.env.get("NOTIFICATION_TEST_MODE") !== "false";
  const allowedRecipients = testMode ? getTestRecipients() : null;
  const service = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const limit = boundedInteger(
    new URL(request.url).searchParams.get("limit"),
    25,
    1,
    100,
  );
  const { data, error } = await service.rpc(
    "claim_notification_delivery_batch",
    {
      p_limit: limit,
      p_allowed_phone_numbers: allowedRecipients
        ? [...allowedRecipients]
        : null,
    },
  );
  if (error) {
    console.error("Notification claim failed", error.message);
    return json({ error: "Could not claim notification deliveries" }, 500);
  }

  const claimed = (data ?? []) as ClaimedDelivery[];
  const result = {
    mode: testMode ? "test" : "live",
    claimed: claimed.length,
    sent: 0,
    retried: 0,
    cancelled: 0,
  };

  for (const delivery of claimed) {
    try {
      const parameters = resolveTemplateParameters(delivery);
      const document = await resolveTemplateDocument(service, delivery);
      const provider = await sendMetaTextTemplate({
        accessToken: requireEnv("META_WHATSAPP_ACCESS_TOKEN"),
        graphVersion: requireEnv("META_WHATSAPP_GRAPH_API_VERSION"),
        phoneNumberId: requireEnv("META_WHATSAPP_PHONE_NUMBER_ID"),
        recipient: delivery.phone_e164,
        templateName: delivery.template_name,
        languageCode: delivery.template_language,
        parameters,
        document,
      });

      if (!provider.ok || !provider.messageId) {
        const outcome = await failDelivery(
          service,
          delivery.delivery_id,
          provider.errorCode ?? `http_${provider.status}`,
          provider.errorMessage,
          provider.retryable,
        );
        if (outcome === "failed") result.retried += 1;
        else result.cancelled += 1;
        continue;
      }

      const { error: completionError } = await service.rpc(
        "complete_notification_delivery",
        {
          p_delivery_id: delivery.delivery_id,
          p_provider_message_id: provider.messageId,
          p_provider_response: provider.payload,
        },
      );
      if (completionError) {
        // Meta accepted the send. Do not retry and risk a duplicate.
        console.error("Notification completion failed after Meta accepted it", {
          deliveryId: delivery.delivery_id,
          message: completionError.message,
        });
        continue;
      }
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unexpected notification worker failure";
      const outcome = await failDelivery(
        service,
        delivery.delivery_id,
        "worker_error",
        message,
        false,
      );
      if (outcome === "failed") result.retried += 1;
      else result.cancelled += 1;
    }
  }

  const replyAlerts = await processReplyAlerts(service, limit);

  return json({ ...result, replyAlerts });
});

async function processReplyAlerts(
  service: ReturnType<typeof createClient>,
  limit: number,
) {
  const { data, error } = await service.rpc(
    "claim_whatsapp_reply_alert_batch",
    { p_limit: limit },
  );
  if (error) {
    console.error("Reply alert claim failed", error.message);
    return { claimed: 0, sent: 0, retried: 0, cancelled: 0 };
  }

  const claimed = (data ?? []) as ClaimedReplyAlert[];
  const result = { claimed: claimed.length, sent: 0, retried: 0, cancelled: 0 };
  for (const delivery of claimed) {
    const provider = await sendMetaTextTemplate({
      accessToken: requireEnv("META_WHATSAPP_ACCESS_TOKEN"),
      graphVersion: requireEnv("META_WHATSAPP_GRAPH_API_VERSION"),
      phoneNumberId: delivery.sender_meta_phone_number_id,
      recipient: delivery.phone_e164,
      templateName: "bizlee_customer_reply_alert",
      languageCode: "en",
      parameters: [
        delivery.contact_name,
        delivery.contact_mobile,
        delivery.reply_preview,
        delivery.received_at,
      ],
    }).catch((sendError) => ({
      ok: false as const,
      status: 500,
      messageId: null,
      errorCode: "worker_error",
      errorMessage: sendError instanceof Error ? sendError.message : "Reply alert send failed",
      retryable: false,
      payload: null,
    }));

    if (provider.ok && provider.messageId) {
      const { error: completeError } = await service.rpc(
        "complete_whatsapp_reply_alert",
        { p_delivery_id: delivery.delivery_id, p_provider_message_id: provider.messageId },
      );
      if (completeError) {
        console.error("Reply alert completion failed after Meta accepted it", {
          deliveryId: delivery.delivery_id,
          message: completeError.message,
        });
      } else result.sent += 1;
      continue;
    }

    const retryable = provider.retryable && delivery.attempt_count < 5;
    const { data: outcome, error: failError } = await service.rpc(
      "fail_whatsapp_reply_alert",
      {
        p_delivery_id: delivery.delivery_id,
        p_failure_code: provider.errorCode ?? `http_${provider.status}`,
        p_failure_message: provider.errorMessage,
        p_retryable: retryable,
      },
    );
    if (failError) {
      console.error("Could not record reply alert failure", failError.message);
    } else if (outcome === "failed") result.retried += 1;
    else result.cancelled += 1;
  }
  return result;
}

function resolveTemplateParameters(delivery: ClaimedDelivery) {
  if (!Array.isArray(delivery.variable_schema)) {
    throw new Error("Template variable schema is invalid");
  }
  const values: Record<string, unknown> = {
    ...delivery.event_payload,
    first_name: firstName(delivery.full_name),
    company_name: delivery.company_name,
  };

  return delivery.variable_schema.map((rawKey, index) => {
    const key = typeof rawKey === "string" ? rawKey : "";
    const value = values[key];
    if (
      !key ||
      !["string", "number"].includes(typeof value) ||
      !String(value).trim()
    ) {
      throw new Error(`Template variable ${index + 1} (${key || "unknown"}) is missing`);
    }
    return String(value).trim().slice(0, 1000);
  });
}

async function resolveTemplateDocument(
  service: ReturnType<typeof createClient>,
  delivery: ClaimedDelivery,
) {
  if (delivery.event_type !== "subscription_payment_received") return undefined;
  const bucket = String(delivery.event_payload.invoice_pdf_bucket ?? "");
  const path = String(delivery.event_payload.invoice_pdf_path ?? "");
  const invoiceNumber = String(delivery.event_payload.invoice_number ?? "");
  if (!bucket || !path || !invoiceNumber) {
    throw new Error("Subscription invoice document metadata is missing");
  }
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not sign subscription invoice");
  }
  return {
    url: data.signedUrl,
    filename: `${invoiceNumber}.pdf`,
  };
}

async function failDelivery(
  service: ReturnType<typeof createClient>,
  deliveryId: string,
  code: string,
  message: string,
  retryable: boolean,
) {
  const { data, error } = await service.rpc("fail_notification_delivery", {
    p_delivery_id: deliveryId,
    p_failure_code: code,
    p_failure_message: message,
    p_retryable: retryable,
  });
  if (error) {
    console.error("Could not record notification failure", {
      deliveryId,
      message: error.message,
    });
    return "ignored";
  }
  return String(data ?? "ignored");
}

function getTestRecipients() {
  const configured = requireEnv("NOTIFICATION_TEST_RECIPIENTS");
  const recipients = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizePhone);
  if (recipients.length === 0) {
    throw new Error("At least one notification test recipient is required");
  }
  return new Set(recipients);
}

function firstName(value: string | null) {
  return value?.trim().split(/\s+/)[0] || "there";
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
