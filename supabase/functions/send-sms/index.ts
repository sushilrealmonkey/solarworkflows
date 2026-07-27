import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type SendSmsHookPayload = {
  user?: { phone?: string | null };
  sms?: { otp?: string | number | null };
};

type MetaSendMessageResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    code?: number;
    type?: string;
  };
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawPayload = await request.text();
    const payload = verifySupabaseHook(rawPayload, request.headers);
    const mobile = normalizeIndianMobile(payload.user?.phone);
    const otp = String(payload.sms?.otp ?? "").trim();

    if (!mobile || !otp || !/^\d{6}$/.test(otp)) {
      return jsonResponse({ error: "Invalid Send SMS hook payload" }, 400);
    }

    await sendWhatsAppAuthenticationTemplate(mobile, otp);

    return jsonResponse({}, 200);
  } catch (error) {
    console.error("Send SMS hook failed", safeErrorMessage(error));
    return jsonResponse(
      { error: "SMS delivery failed" },
      deliveryErrorStatus(error),
    );
  }
});

function verifySupabaseHook(
  rawPayload: string,
  requestHeaders: Headers,
): SendSmsHookPayload {
  const configuredSecret = requireEnv("SEND_SMS_HOOK_SECRET");
  const webhook = new Webhook(configuredSecret.replace(/^v1,whsec_/, ""));

  return webhook.verify(
    rawPayload,
    Object.fromEntries(requestHeaders.entries()),
  ) as SendSmsHookPayload;
}

async function sendWhatsAppAuthenticationTemplate(
  mobile: string,
  otp: string,
) {
  const accessToken = requireEnv("META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requireDigitsEnv("META_WHATSAPP_PHONE_NUMBER_ID");
  const graphApiVersion = requireGraphApiVersion();
  const templateName = requireTemplateName();
  const templateLanguage = requireTemplateLanguage();
  const endpoint =
    `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`;

  const providerResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: mobile,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: templateLanguage,
        },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: otp }],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: otp }],
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(4_000),
  });

  const response = await parseMetaResponse(providerResponse);
  const acceptedMessageId = response.messages?.[0]?.id?.trim();

  if (!providerResponse.ok || !acceptedMessageId) {
    console.error("Meta rejected the WhatsApp OTP message", {
      status: providerResponse.status,
      errorCode: response.error?.code ?? null,
      errorType: boundedLogValue(response.error?.type),
    });
    throw new ProviderDeliveryError();
  }
}

async function parseMetaResponse(response: Response) {
  try {
    return (await response.json()) as MetaSendMessageResponse;
  } catch {
    return {} satisfies MetaSendMessageResponse;
  }
}

function normalizeIndianMobile(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return /^91[6-9]\d{9}$/.test(digits) ? digits : null;
}

function requireDigitsEnv(name: string) {
  const value = requireEnv(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function requireGraphApiVersion() {
  const value = requireEnv("META_WHATSAPP_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(value)) {
    throw new Error("META_WHATSAPP_GRAPH_API_VERSION is invalid");
  }
  return value;
}

function requireTemplateName() {
  const value = requireEnv("META_WHATSAPP_OTP_TEMPLATE_NAME");
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error("META_WHATSAPP_OTP_TEMPLATE_NAME is invalid");
  }
  return value;
}

function requireTemplateLanguage() {
  const value = requireEnv("META_WHATSAPP_OTP_TEMPLATE_LANGUAGE");
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value)) {
    throw new Error("META_WHATSAPP_OTP_TEMPLATE_LANGUAGE is invalid");
  }
  return value;
}

function requireEnv(name: string) {
  const value = optionalEnv(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function optionalEnv(name: string) {
  return Deno.env.get(name)?.trim() || null;
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof ProviderDeliveryError) {
    return "WhatsApp provider rejected the message";
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "WhatsApp provider timed out";
  }

  return error instanceof Error ? error.message : "Unknown error";
}

function deliveryErrorStatus(error: unknown) {
  if (error instanceof ProviderDeliveryError) return 502;
  if (error instanceof DOMException && error.name === "TimeoutError") return 504;
  return 500;
}

function boundedLogValue(value: string | undefined) {
  return value?.slice(0, 80) || null;
}

class ProviderDeliveryError extends Error {
  constructor() {
    super("WhatsApp delivery failed");
    this.name = "ProviderDeliveryError";
  }
}
