import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;
type ClaimedRecipient = {
  recipient_id: string;
  campaign_id: string;
  phone_number: string;
  contact_name: string | null;
  custom_fields: JsonObject;
  meta_phone_number_id: string;
  template_name: string;
  template_language: string;
  variable_mappings: unknown;
  delay_seconds: number;
  attempt_count: number;
};
type MetaResponse = {
  messages?: Array<{ id?: string }>;
  error?: { code?: number; message?: string };
};
type MetaTemplateResponse = {
  data?: Array<{
    name?: string;
    language?: string;
    components?: Array<{
      type?: string;
      format?: string;
      text?: string;
      example?: { header_handle?: string[] };
    }>;
  }>;
  error?: { message?: string };
};
type TemplateAssets = {
  headerImageId: string | null;
  bodyParameterNames: string[];
};
class PermanentWorkerError extends Error {}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-secret") !== requireEnv("WHATSAPP_CAMPAIGN_WORKER_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const testMode = Deno.env.get("WHATSAPP_CAMPAIGN_TEST_MODE") !== "false";
  const testRecipients = testMode
    ? getTestRecipients()
    : null;
  const client = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const requestedLimit = boundedInteger(
    new URL(request.url).searchParams.get("limit"),
    25,
    1,
    100,
  );
  const { data, error } = await client.rpc("claim_whatsapp_campaign_batch", {
    p_limit: requestedLimit,
    p_allowed_phone_numbers: testMode ? [...testRecipients!] : null,
    p_max_batch_duration_seconds: 45,
  });

  if (error) {
    console.error("WhatsApp worker claim failed", error.message);
    return json({ error: "Could not claim a campaign batch" }, 500);
  }

  const claimed = (data ?? []) as ClaimedRecipient[];
  const result = { claimed: claimed.length, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const templateAssetsCache = new Map<string, TemplateAssets>();

  for (const [recipientIndex, recipient] of claimed.entries()) {
    const safety = await getCampaignSafety(client, recipient.campaign_id);
    if (safety.status !== "running") {
      if (safety.status === "paused") {
        await client.rpc("release_whatsapp_campaign_batch", {
          p_recipient_ids: [recipient.recipient_id],
        });
      } else {
        await client.from("whatsapp_campaign_recipients")
          .update({
            status: "skipped",
            processing_started_at: null,
            failure_reason: `Campaign is ${safety.status}`,
          })
          .eq("id", recipient.recipient_id)
          .eq("status", "processing");
      }
      result.skipped += 1;
      continue;
    }
    if (safety.campaignsStartedToday > safety.dailyCampaignLimit) {
      const deferredIds = claimed.slice(recipientIndex)
        .map((item) => item.recipient_id);
      await client.rpc("release_whatsapp_campaign_batch", {
        p_recipient_ids: deferredIds,
      });
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      await client.from("whatsapp_campaigns")
        .update({
          status: "scheduled",
          scheduled_at: tomorrow.toISOString(),
          started_at: null,
          next_batch_at: tomorrow.toISOString(),
        })
        .eq("id", recipient.campaign_id)
        .eq("status", "running");
      result.retried += deferredIds.length;
      break;
    }
    if (safety.messagesSentToday >= safety.dailyMessageLimit) {
      const deferredIds = claimed.slice(recipientIndex)
        .map((item) => item.recipient_id);
      await client.rpc("release_whatsapp_campaign_batch", {
        p_recipient_ids: deferredIds,
      });
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      await client.from("whatsapp_campaigns")
        .update({ next_batch_at: tomorrow.toISOString() })
        .eq("id", recipient.campaign_id)
        .eq("status", "running");
      result.retried += deferredIds.length;
      break;
    }

    if (testMode && !testRecipients?.has(recipient.phone_number)) {
      await client.rpc("release_whatsapp_campaign_batch", {
        p_recipient_ids: [recipient.recipient_id],
      });
      result.skipped += 1;
      continue;
    }

    try {
      const parameters = resolveParameters(recipient);
      const provider = await sendTemplate(
        client,
        recipient,
        parameters,
        templateAssetsCache,
      );

      if (!provider.ok || !provider.messageId) {
        const failure = await client.rpc("fail_whatsapp_campaign_recipient", {
          p_recipient_id: recipient.recipient_id,
          p_failure_reason: provider.message,
          p_retryable: provider.retryable,
        });
        if (failure.error) throw new Error(`Failure recording failed: ${failure.error.message}`);
        if (failure.data === "queued") result.retried += 1;
        else result.failed += 1;
      } else {
        const completion = await client.rpc("complete_whatsapp_campaign_recipient", {
          p_recipient_id: recipient.recipient_id,
          p_meta_message_id: provider.messageId,
          p_sent_at: new Date().toISOString(),
        });
        if (completion.error) {
          // Meta accepted the message. Leave the row processing instead of
          // retrying and risking a duplicate send.
          console.error("Meta accepted message but completion failed", {
            recipientId: recipient.recipient_id,
            error: completion.error.message,
          });
          continue;
        }
        result.sent += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected worker failure";
      const failure = await client.rpc("fail_whatsapp_campaign_recipient", {
        p_recipient_id: recipient.recipient_id,
        p_failure_reason: message,
        p_retryable: !(error instanceof PermanentWorkerError),
      });
      if (failure.data === "queued") result.retried += 1;
      else result.failed += 1;
    }

    if (
      recipientIndex < claimed.length - 1 &&
      recipient.delay_seconds > 0
    ) {
      await delay(recipient.delay_seconds * 1000);
    }
  }

  return json({ mode: testMode ? "test" : "live", ...result });
});

async function getCampaignSafety(
  client: ReturnType<typeof createClient>,
  campaignId: string,
) {
  const { data: campaign, error: campaignError } = await client
    .from("whatsapp_campaigns")
    .select("status,company_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) {
    throw new PermanentWorkerError("Campaign could not be resolved");
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [{ data: settings, error: settingsError },
    { count: messageCount, error: messageCountError },
    { count: campaignCount, error: campaignCountError }] = await Promise.all([
    client.from("whatsapp_outreach_settings")
      .select("daily_campaign_limit,daily_message_limit")
      .eq("company_id", campaign.company_id)
      .maybeSingle(),
    client.from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("company_id", campaign.company_id)
      .eq("direction", "outbound")
      .gte("source_timestamp", dayStart.toISOString()),
    client.from("whatsapp_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("company_id", campaign.company_id)
      .gte("started_at", dayStart.toISOString())
      .neq("status", "cancelled"),
  ]);
  if (settingsError || messageCountError || campaignCountError) {
    throw new Error("Could not validate daily sending limits");
  }
  return {
    status: campaign.status,
    messagesSentToday: messageCount ?? 0,
    dailyMessageLimit: settings?.daily_message_limit ?? 100,
    campaignsStartedToday: campaignCount ?? 0,
    dailyCampaignLimit: settings?.daily_campaign_limit ?? 10,
  };
}

async function sendTemplate(
  client: ReturnType<typeof createClient>,
  recipient: ClaimedRecipient,
  parameters: string[],
  templateAssetsCache: Map<string, TemplateAssets>,
) {
  const version = requireEnv("META_WHATSAPP_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Meta Graph API version");
  const templateAssets = await resolveTemplateAssets(
    client,
    recipient,
    version,
    templateAssetsCache,
  );
  if (
    templateAssets.bodyParameterNames.length > 0 &&
    templateAssets.bodyParameterNames.length !== parameters.length
  ) {
    throw new PermanentWorkerError("Template body parameter mapping is incomplete");
  }
  const components = [
    ...(templateAssets.headerImageId
      ? [{
        type: "header",
        parameters: [{
          type: "image",
          image: { id: templateAssets.headerImageId },
        }],
      }]
      : []),
    ...(parameters.length
      ? [{
        type: "body",
        parameters: parameters.map((text, index) => ({
          type: "text",
          text,
          ...(templateAssets.bodyParameterNames[index] &&
              !/^\d+$/.test(templateAssets.bodyParameterNames[index])
            ? { parameter_name: templateAssets.bodyParameterNames[index] }
            : {}),
        })),
      }]
      : []),
  ];
  const response = await fetch(
    `https://graph.facebook.com/${version}/${recipient.meta_phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("META_WHATSAPP_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient.phone_number,
        type: "template",
        template: {
          name: recipient.template_name,
          language: { code: recipient.template_language },
          ...(components.length ? { components } : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({})) as MetaResponse;
  const messageId = payload.messages?.[0]?.id?.trim() ?? null;
  const retryable = isRetryableMetaFailure(
    response.status,
    payload.error?.code,
  );
  return {
    ok: response.ok && Boolean(messageId),
    messageId,
    retryable,
    message: payload.error?.message?.slice(0, 1000) || `Meta request failed (${response.status})`,
  };
}

async function resolveTemplateAssets(
  client: ReturnType<typeof createClient>,
  recipient: ClaimedRecipient,
  version: string,
  templateAssetsCache: Map<string, TemplateAssets>,
) {
  const cacheKey =
    `${recipient.meta_phone_number_id}:${recipient.template_name}:${recipient.template_language}`;
  const cachedAssets = templateAssetsCache.get(cacheKey);
  if (cachedAssets) return cachedAssets;

  const { data: phoneNumber, error } = await client
    .from("whatsapp_phone_numbers")
    .select("meta_business_account_id")
    .eq("meta_phone_number_id", recipient.meta_phone_number_id)
    .maybeSingle();
  if (error || !phoneNumber?.meta_business_account_id) {
    throw new Error("Could not resolve the WhatsApp Business Account");
  }

  const endpoint = new URL(
    `https://graph.facebook.com/${version}/${phoneNumber.meta_business_account_id}/message_templates`,
  );
  endpoint.searchParams.set(
    "fields",
    "name,status,language,components",
  );
  endpoint.searchParams.set("name", recipient.template_name);

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${requireEnv("META_WHATSAPP_ACCESS_TOKEN")}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as MetaTemplateResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message?.slice(0, 1000) ||
        `Could not load the Meta template (${response.status})`,
    );
  }

  const template = payload.data?.find((item) =>
    item.name === recipient.template_name &&
    item.language === recipient.template_language
  ) ?? payload.data?.[0];
  const body = template?.components?.find(
    (component) => component.type?.toUpperCase() === "BODY",
  );
  const bodyParameterNames = [
    ...new Set(
      [...(body?.text ?? "").matchAll(
        /\{\{\s*([a-zA-Z_][\w]*|\d+)\s*\}\}/g,
      )].map((match) => match[1]),
    ),
  ];
  const header = template?.components?.find(
    (component) =>
      component.type?.toUpperCase() === "HEADER" &&
      component.format?.toUpperCase() === "IMAGE",
  );
  const imageUrl = header?.example?.header_handle?.[0]?.trim();
  if (header && !imageUrl) {
    throw new Error("The template requires a header image but none is configured");
  }
  if (!imageUrl) {
    const assets = { headerImageId: null, bodyParameterNames };
    templateAssetsCache.set(cacheKey, assets);
    return assets;
  }

  const imageResponse = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!imageResponse.ok) {
    throw new Error(`Could not download the template header image (${imageResponse.status})`);
  }
  const image = await imageResponse.blob();
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", image.type || "image/png");
  form.set(
    "file",
    new File([image], "template-header", {
      type: image.type || "image/png",
    }),
  );
  const uploadResponse = await fetch(
    `https://graph.facebook.com/${version}/${recipient.meta_phone_number_id}/media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("META_WHATSAPP_ACCESS_TOKEN")}`,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const uploadPayload = await uploadResponse.json().catch(() => ({})) as {
    id?: string;
    error?: { message?: string };
  };
  const mediaId = uploadPayload.id?.trim();
  if (!uploadResponse.ok || !mediaId) {
    throw new Error(
      uploadPayload.error?.message?.slice(0, 1000) ||
        `Could not upload the template header image (${uploadResponse.status})`,
    );
  }
  const assets = { headerImageId: mediaId, bodyParameterNames };
  templateAssetsCache.set(cacheKey, assets);
  return assets;
}

function resolveParameters(recipient: ClaimedRecipient) {
  if (!Array.isArray(recipient.variable_mappings)) return [];
  return recipient.variable_mappings.map((mapping, index) => {
    const field = typeof mapping === "string"
      ? mapping
      : mapping && typeof mapping === "object" && "field" in mapping
        ? String((mapping as JsonObject).field)
        : "";
    const value = field === "name" ? recipient.contact_name
      : field === "phone_number" ? recipient.phone_number
      : recipient.custom_fields?.[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new PermanentWorkerError(
        `Template variable ${index + 1} has no mapped value`,
      );
    }
    return value.trim();
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("Invalid test recipient");
  return digits;
}
function getTestRecipients() {
  const configured = Deno.env.get("WHATSAPP_CAMPAIGN_TEST_RECIPIENTS")?.trim() ||
    requireEnv("WHATSAPP_CAMPAIGN_TEST_RECIPIENT");
  const recipients = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizePhone);
  if (recipients.length === 0) {
    throw new Error("At least one test recipient is required");
  }
  return new Set(recipients);
}
function isRetryableMetaFailure(status: number, code: number | undefined) {
  if (status === 429 || status >= 500) return true;
  return code !== undefined &&
    new Set([4, 17, 32, 130429, 131000, 131056, 131057]).has(code);
}
function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}
function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
