import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  extractInboundWhatsAppMessages,
  extractWhatsAppStatusUpdates,
} from "./payload.js";
import {
  persistInboundWhatsAppMessage,
  processNotificationOptOut,
  processWhatsAppStatusUpdate,
} from "./persistence.js";

const VERIFY_TOKEN_ENV_NAME = "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN";
const APP_SECRET_ENV_NAME = "META_WHATSAPP_APP_SECRET";
const SIGNATURE_PREFIX = "sha256=";

export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (
    !signatureHeader?.startsWith(SIGNATURE_PREFIX) ||
    !appSecret
  ) {
    return false;
  }

  const suppliedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

  if (!/^[\da-f]{64}$/i.test(suppliedHex)) {
    return false;
  }

  const expectedSignature = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest();
  const suppliedSignature = Buffer.from(suppliedHex, "hex");

  return timingSafeEqual(expectedSignature, suppliedSignature);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = process.env[VERIFY_TOKEN_ENV_NAME];

  if (
    mode === "subscribe" &&
    token &&
    expectedToken &&
    token === expectedToken &&
    challenge
  ) {
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  return new Response("Webhook verification failed", {
    status: 403,
  });
}

interface WebhookDependencies {
  persistMessage: typeof persistInboundWhatsAppMessage;
  processStatus: typeof processWhatsAppStatusUpdate;
  processOptOut?: typeof processNotificationOptOut;
}

const defaultDependencies: WebhookDependencies = {
  persistMessage: persistInboundWhatsAppMessage,
  processStatus: processWhatsAppStatusUpdate,
  processOptOut: processNotificationOptOut,
};

export async function POST(
  request: Request,
  dependencies: WebhookDependencies = defaultDependencies,
): Promise<Response> {
  const appSecret = process.env[APP_SECRET_ENV_NAME];

  if (!appSecret) {
    console.error(
      `WhatsApp webhook is missing ${APP_SECRET_ENV_NAME}`,
    );

    return Response.json(
      { received: false },
      { status: 503 },
    );
  }

  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const signature = request.headers.get("x-hub-signature-256");

    if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      console.warn("Rejected WhatsApp webhook with invalid signature");

      return Response.json(
        { received: false },
        { status: 401 },
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      return Response.json(
        { received: false },
        { status: 400 },
      );
    }

    const messages = extractInboundWhatsAppMessages(payload);
    const statusUpdates = extractWhatsAppStatusUpdates(payload);
    const [results, statusResults] = await Promise.all([
      Promise.all(messages.map(dependencies.persistMessage)),
      Promise.all(statusUpdates.map(dependencies.processStatus)),
    ]);
    if (dependencies.processOptOut) {
      await Promise.all(messages.map(dependencies.processOptOut));
    }
    const unmappedPhoneNumberIds = messages
      .filter((_, index) => !results[index]?.mapped)
      .map((message) => message.metaPhoneNumberId);

    if (unmappedPhoneNumberIds.length > 0) {
      console.error(
        "WhatsApp messages were not persisted because a phone number ID " +
          "is not mapped to an active tenant",
      );
    }

    const ignoredStatusCount = statusResults.filter(
      (result) => !result.mapped || !result.found,
    ).length;

    if (ignoredStatusCount > 0) {
      console.warn(
        `Ignored ${ignoredStatusCount} WhatsApp status callback(s) ` +
          "without a tenant-scoped message match",
      );
    }

    return Response.json(
      { received: true },
      { status: 200 },
    );
  } catch (error) {
    console.error("WhatsApp webhook error:", error);

    return Response.json(
      { received: false },
      { status: 500 },
    );
  }
}
