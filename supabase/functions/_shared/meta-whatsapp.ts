export type MetaTemplateSendResult = {
  ok: boolean;
  messageId: string | null;
  retryable: boolean;
  status: number;
  payload: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string;
};

type MetaResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    code?: number;
    message?: string;
  };
};

export async function sendMetaTextTemplate(input: {
  accessToken: string;
  graphVersion: string;
  phoneNumberId: string;
  recipient: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
}): Promise<MetaTemplateSendResult> {
  if (!/^v\d+\.\d+$/.test(input.graphVersion)) {
    throw new Error("META_WHATSAPP_GRAPH_API_VERSION is invalid");
  }

  const recipient = normalizePhone(input.recipient);
  const components = input.parameters.length
    ? [{
      type: "body",
      parameters: input.parameters.map((text) => ({
        type: "text",
        text,
      })),
    }]
    : [];

  const response = await fetch(
    `https://graph.facebook.com/${input.graphVersion}/${input.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(components.length ? { components } : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({})) as MetaResponse;
  const messageId = payload.messages?.[0]?.id?.trim() ?? null;
  const errorCode = payload.error?.code === undefined
    ? null
    : String(payload.error.code);

  return {
    ok: response.ok && Boolean(messageId),
    messageId,
    retryable: isRetryableMetaFailure(response.status, payload.error?.code),
    status: response.status,
    payload: payload as Record<string, unknown>,
    errorCode,
    errorMessage: payload.error?.message?.slice(0, 2000) ||
      `Meta request failed (${response.status})`,
  };
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error("WhatsApp recipient is invalid");
  }
  return digits;
}

function isRetryableMetaFailure(status: number, code: number | undefined) {
  if (status === 429 || status >= 500) return true;
  return code !== undefined &&
    new Set([4, 17, 32, 130429, 131000, 131056, 131057]).has(code);
}
