import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  extractInboundWhatsAppMessages,
  extractWhatsAppStatusUpdates,
} from "./payload.js";
import {
  POST,
  verifyMetaWebhookSignature,
} from "./webhook.js";

test("validates the signature against the exact raw request bytes", () => {
  const appSecret = "test-app-secret";
  const rawBody = Buffer.from('{"message":"Olá"}', "utf8");
  const signature = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  assert.equal(
    verifyMetaWebhookSignature(
      rawBody,
      `sha256=${signature}`,
      appSecret,
    ),
    true,
  );
  assert.equal(
    verifyMetaWebhookSignature(
      Buffer.from('{"message": "Olá"}', "utf8"),
      `sha256=${signature}`,
      appSecret,
    ),
    false,
  );
});

test("rejects missing and malformed signatures", () => {
  const rawBody = Buffer.from("{}");

  assert.equal(
    verifyMetaWebhookSignature(rawBody, null, "test-app-secret"),
    false,
  );
  assert.equal(
    verifyMetaWebhookSignature(rawBody, "sha256=not-hex", "secret"),
    false,
  );
  assert.equal(
    verifyMetaWebhookSignature(rawBody, "sha1=abc", "secret"),
    false,
  );
});

test("extracts tenant routing and inbound message fields", () => {
  const messages = extractInboundWhatsAppMessages({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id: "100200300",
              },
              contacts: [
                {
                  profile: { name: "Ada Lovelace" },
                  wa_id: "919999999999",
                },
              ],
              messages: [
                {
                  from: "919999999999",
                  id: "wamid.message-1",
                  timestamp: "1767225600",
                  text: { body: "Hello" },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(messages, [
    {
      metaPhoneNumberId: "100200300",
      metaMessageId: "wamid.message-1",
      contactWaId: "919999999999",
      contactName: "Ada Lovelace",
      messageType: "text",
      textBody: "Hello",
      sourceTimestamp: "2026-01-01T00:00:00.000Z",
      rawPayload: {
        from: "919999999999",
        id: "wamid.message-1",
        timestamp: "1767225600",
        text: { body: "Hello" },
        type: "text",
      },
    },
  ]);
});

test("extracts supported statuses and safely bounds failure fields", () => {
  const updates = extractWhatsAppStatusUpdates({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "100200300" },
          statuses: [{
            id: "wamid.failed-1",
            status: "failed",
            timestamp: "1767225600",
            errors: [{
              code: "131047",
              title: "Message expired",
              message: "The message could not be delivered",
              error_data: { details: "Customer window expired" },
            }],
          }],
        },
      }],
    }],
  });

  assert.deepEqual(updates, [{
    metaPhoneNumberId: "100200300",
    metaMessageId: "wamid.failed-1",
    status: "failed",
    sourceTimestamp: "2026-01-01T00:00:00.000Z",
    errorCode: "131047",
    errorTitle: "Message expired",
    errorMessage: "The message could not be delivered",
    errorDetails: "Customer window expired",
  }]);
});

test("rejects an invalid POST signature before parsing the body", async () => {
  const previousAppSecret = process.env.META_WHATSAPP_APP_SECRET;
  process.env.META_WHATSAPP_APP_SECRET = "test-app-secret";

  try {
    const response = await POST(
      new Request("https://example.test/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: "{not-valid-json",
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { received: false });
  } finally {
    if (previousAppSecret === undefined) {
      delete process.env.META_WHATSAPP_APP_SECRET;
    } else {
      process.env.META_WHATSAPP_APP_SECRET = previousAppSecret;
    }
  }
});

test("acknowledges a correctly signed status-only webhook", async () => {
  const previousAppSecret = process.env.META_WHATSAPP_APP_SECRET;
  const appSecret = "test-app-secret";
  const rawBody = Buffer.from(
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "100200300" },
                statuses: [
                  {
                    id: "wamid.status-1",
                    status: "read",
                    timestamp: "1767225600",
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
  const signature = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  process.env.META_WHATSAPP_APP_SECRET = appSecret;

  try {
    const processedStatuses: string[] = [];
    const response = await POST(
      new Request("https://example.test/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${signature}`,
        },
        body: rawBody,
      }),
      {
        persistMessage: async () => ({
          mapped: true,
          inserted: false,
          companyId: null,
          conversationId: null,
          messageId: null,
        }),
        processStatus: async (update) => {
          processedStatuses.push(update.status);

          return {
            mapped: true,
            found: true,
            updated: true,
            companyId: "company-1",
            messageId: "message-1",
            status: update.status,
          };
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.deepEqual(processedStatuses, ["read"]);
  } finally {
    if (previousAppSecret === undefined) {
      delete process.env.META_WHATSAPP_APP_SECRET;
    } else {
      process.env.META_WHATSAPP_APP_SECRET = previousAppSecret;
    }
  }
});

test("acknowledges a signed callback for an unknown message ID", async () => {
  const previousAppSecret = process.env.META_WHATSAPP_APP_SECRET;
  const appSecret = "test-app-secret";
  const rawBody = Buffer.from(JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "100200300" },
          statuses: [{
            id: "wamid.unknown",
            status: "delivered",
            timestamp: "1767225600",
          }],
        },
      }],
    }],
  }));
  const signature = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  process.env.META_WHATSAPP_APP_SECRET = appSecret;

  try {
    const response = await POST(
      new Request("https://example.test/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${signature}`,
        },
        body: rawBody,
      }),
      {
        persistMessage: async () => {
          throw new Error("No inbound message should be created");
        },
        processStatus: async () => ({
          mapped: true,
          found: false,
          updated: false,
          companyId: "company-1",
          messageId: null,
          status: null,
        }),
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally {
    if (previousAppSecret === undefined) {
      delete process.env.META_WHATSAPP_APP_SECRET;
    } else {
      process.env.META_WHATSAPP_APP_SECRET = previousAppSecret;
    }
  }
});
