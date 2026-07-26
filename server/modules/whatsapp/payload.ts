export interface InboundWhatsAppMessage {
  metaPhoneNumberId: string;
  metaMessageId: string;
  contactWaId: string;
  contactName: string | null;
  messageType: string;
  textBody: string | null;
  sourceTimestamp: string;
  rawPayload: Record<string, unknown>;
}

export type WhatsAppDeliveryStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "deleted";

export interface WhatsAppStatusUpdate {
  metaPhoneNumberId: string;
  metaMessageId: string;
  status: WhatsAppDeliveryStatus;
  sourceTimestamp: string;
  errorCode: string | null;
  errorTitle: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function parseMetaTimestamp(value: unknown): string {
  const timestamp = getString(value);
  const seconds = timestamp ? Number(timestamp) : Number.NaN;

  if (!Number.isFinite(seconds) || seconds < 0) {
    return new Date().toISOString();
  }

  const date = new Date(seconds * 1_000);

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function parseRequiredMetaTimestamp(value: unknown): string | null {
  const timestamp = getString(value);
  const seconds = timestamp ? Number(timestamp) : Number.NaN;

  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const date = new Date(seconds * 1_000);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getLimitedString(value: unknown, maximumLength: number): string | null {
  const text = getString(value);

  return text ? text.slice(0, maximumLength) : null;
}

function getDeliveryStatus(value: unknown): WhatsAppDeliveryStatus | null {
  const status = getString(value);

  return status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "failed" ||
    status === "deleted"
    ? status
    : null;
}

function getContactNames(value: JsonObject): Map<string, string> {
  const names = new Map<string, string>();

  for (const contactValue of getArray(value.contacts)) {
    const contact = getObject(contactValue);
    const waId = getString(contact?.wa_id);
    const profile = getObject(contact?.profile);
    const name = getString(profile?.name);

    if (waId && name) {
      names.set(waId, name);
    }
  }

  return names;
}

function getTextBody(message: JsonObject): string | null {
  const text = getObject(message.text);

  return getString(text?.body);
}

export function extractInboundWhatsAppMessages(
  payload: unknown,
): InboundWhatsAppMessage[] {
  const root = getObject(payload);

  if (getString(root?.object) !== "whatsapp_business_account") {
    return [];
  }

  const inboundMessages: InboundWhatsAppMessage[] = [];

  for (const entryValue of getArray(root?.entry)) {
    const entry = getObject(entryValue);

    for (const changeValue of getArray(entry?.changes)) {
      const change = getObject(changeValue);

      if (getString(change?.field) !== "messages") {
        continue;
      }

      const value = getObject(change?.value);
      const metadata = getObject(value?.metadata);
      const metaPhoneNumberId = getString(metadata?.phone_number_id);

      if (!value || !metaPhoneNumberId) {
        continue;
      }

      const contactNames = getContactNames(value);

      for (const messageValue of getArray(value.messages)) {
        const message = getObject(messageValue);
        const metaMessageId = getString(message?.id);
        const contactWaId = getString(message?.from);
        const messageType = getString(message?.type);

        if (
          !message ||
          !metaMessageId ||
          !contactWaId ||
          !messageType
        ) {
          continue;
        }

        inboundMessages.push({
          metaPhoneNumberId,
          metaMessageId,
          contactWaId,
          contactName: contactNames.get(contactWaId) ?? null,
          messageType,
          textBody: getTextBody(message),
          sourceTimestamp: parseMetaTimestamp(message.timestamp),
          rawPayload: message,
        });
      }
    }
  }

  return inboundMessages;
}

export function extractWhatsAppStatusUpdates(
  payload: unknown,
): WhatsAppStatusUpdate[] {
  const root = getObject(payload);

  if (getString(root?.object) !== "whatsapp_business_account") {
    return [];
  }

  const updates: WhatsAppStatusUpdate[] = [];

  for (const entryValue of getArray(root?.entry)) {
    const entry = getObject(entryValue);

    for (const changeValue of getArray(entry?.changes)) {
      const change = getObject(changeValue);

      if (getString(change?.field) !== "messages") {
        continue;
      }

      const value = getObject(change?.value);
      const metadata = getObject(value?.metadata);
      const metaPhoneNumberId = getString(metadata?.phone_number_id);

      if (!value || !metaPhoneNumberId) {
        continue;
      }

      for (const statusValue of getArray(value.statuses)) {
        const statusObject = getObject(statusValue);
        const metaMessageId = getString(statusObject?.id);
        const status = getDeliveryStatus(statusObject?.status);
        const sourceTimestamp = parseRequiredMetaTimestamp(
          statusObject?.timestamp,
        );

        if (!statusObject || !metaMessageId || !status || !sourceTimestamp) {
          continue;
        }

        const error = getObject(getArray(statusObject.errors)[0]);
        const errorData = getObject(error?.error_data);

        updates.push({
          metaPhoneNumberId,
          metaMessageId,
          status,
          sourceTimestamp,
          errorCode: getLimitedString(error?.code, 100),
          errorTitle: getLimitedString(error?.title, 500),
          errorMessage: getLimitedString(error?.message, 2_000),
          errorDetails: getLimitedString(errorData?.details, 4_000),
        });
      }
    }
  }

  return updates;
}
