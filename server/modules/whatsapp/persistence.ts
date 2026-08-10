import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type {
  InboundWhatsAppMessage,
  WhatsAppStatusUpdate,
} from "./payload.js";

const SUPABASE_URL_ENV_NAME = "SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_KEY_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

interface PersistInboundWhatsAppMessageRow {
  mapped: boolean;
  inserted: boolean;
  company_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
}

export interface PersistInboundWhatsAppMessageResult {
  mapped: boolean;
  inserted: boolean;
  companyId: string | null;
  conversationId: string | null;
  messageId: string | null;
}

interface ProcessWhatsAppStatusRow {
  mapped: boolean;
  message_found: boolean;
  updated: boolean;
  company_id: string | null;
  message_id: string | null;
  status: string | null;
}

interface ProcessNotificationStatusRow {
  delivery_found: boolean;
  updated: boolean;
  company_id: string | null;
  delivery_id: string | null;
  status: string | null;
}

export interface ProcessWhatsAppStatusResult {
  mapped: boolean;
  found: boolean;
  updated: boolean;
  companyId: string | null;
  messageId: string | null;
  status: string | null;
}

export interface ProcessNotificationOptOutResult {
  action: "ignored" | "unsubscribed" | "resubscribed";
  affectedRecipients: number;
}

let serverSupabaseClient: SupabaseClient | undefined;

export function getServerSupabaseClient(): SupabaseClient {
  if (serverSupabaseClient) {
    return serverSupabaseClient;
  }

  const url = process.env[SUPABASE_URL_ENV_NAME];
  const serviceRoleKey =
    process.env[SUPABASE_SERVICE_ROLE_KEY_ENV_NAME];

  if (!url || !serviceRoleKey) {
    throw new Error(
      `${SUPABASE_URL_ENV_NAME} and ` +
        `${SUPABASE_SERVICE_ROLE_KEY_ENV_NAME} must be configured`,
    );
  }

  serverSupabaseClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serverSupabaseClient;
}

export async function persistInboundWhatsAppMessage(
  message: InboundWhatsAppMessage,
): Promise<PersistInboundWhatsAppMessageResult> {
  const { data, error } = await getServerSupabaseClient().rpc(
    "persist_inbound_whatsapp_message",
    {
      p_meta_phone_number_id: message.metaPhoneNumberId,
      p_meta_message_id: message.metaMessageId,
      p_contact_wa_id: message.contactWaId,
      p_contact_name: message.contactName,
      p_message_type: message.messageType,
      p_text_body: message.textBody,
      p_source_timestamp: message.sourceTimestamp,
      p_raw_payload: message.rawPayload,
    },
  );

  if (error) {
    throw new Error(
      `Could not persist WhatsApp message (${error.code})`,
      { cause: error },
    );
  }

  const row = (data as PersistInboundWhatsAppMessageRow[] | null)?.[0];

  if (!row) {
    throw new Error("WhatsApp persistence RPC returned no result");
  }

  return {
    mapped: row.mapped,
    inserted: row.inserted,
    companyId: row.company_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
  };
}

export async function processWhatsAppStatusUpdate(
  update: WhatsAppStatusUpdate,
): Promise<ProcessWhatsAppStatusResult> {
  const client = getServerSupabaseClient();
  const [messageResult, notificationResult, replyAlertResult] = await Promise.all([
    client.rpc(
      "process_whatsapp_message_status",
      {
        p_meta_phone_number_id: update.metaPhoneNumberId,
        p_meta_message_id: update.metaMessageId,
        p_status: update.status,
        p_source_timestamp: update.sourceTimestamp,
        p_error_code: update.errorCode,
        p_error_title: update.errorTitle,
        p_error_message: update.errorMessage,
        p_error_details: update.errorDetails,
      },
    ),
    client.rpc(
      "process_notification_delivery_status",
      {
        p_provider_message_id: update.metaMessageId,
        p_status: update.status,
        p_source_timestamp: update.sourceTimestamp,
        p_error_code: update.errorCode,
        p_error_message: update.errorMessage ?? update.errorDetails,
      },
    ),
    client.rpc(
      "process_whatsapp_reply_alert_status",
      {
        p_provider_message_id: update.metaMessageId,
        p_status: update.status,
        p_source_timestamp: update.sourceTimestamp,
        p_error_code: update.errorCode,
        p_error_message: update.errorMessage ?? update.errorDetails,
      },
    ),
  ]);

  if (messageResult.error) {
    throw new Error(
      `Could not process WhatsApp status (${messageResult.error.code})`,
      { cause: messageResult.error },
    );
  }
  if (notificationResult.error) {
    throw new Error(
      `Could not process notification status (${notificationResult.error.code})`,
      { cause: notificationResult.error },
    );
  }
  if (replyAlertResult.error) {
    throw new Error(
      `Could not process reply alert status (${replyAlertResult.error.code})`,
      { cause: replyAlertResult.error },
    );
  }

  const row = (
    messageResult.data as ProcessWhatsAppStatusRow[] | null
  )?.[0];
  const notificationRow = (
    notificationResult.data as ProcessNotificationStatusRow[] | null
  )?.[0];
  const replyAlertRow = (
    replyAlertResult.data as ProcessNotificationStatusRow[] | null
  )?.[0];

  if (!row) {
    throw new Error("WhatsApp status RPC returned no result");
  }

  const notificationFound = (notificationRow?.delivery_found ?? false) ||
    (replyAlertRow?.delivery_found ?? false);

  return {
    mapped: row.mapped || notificationFound,
    found: row.message_found || notificationFound,
    updated: row.updated || (notificationRow?.updated ?? false) ||
      (replyAlertRow?.updated ?? false),
    companyId: row.company_id ?? notificationRow?.company_id ??
      replyAlertRow?.company_id ?? null,
    messageId: row.message_id ?? notificationRow?.delivery_id ??
      replyAlertRow?.delivery_id ?? null,
    status: row.status ?? notificationRow?.status ?? replyAlertRow?.status ?? null,
  };
}

export async function processNotificationOptOut(
  message: InboundWhatsAppMessage,
): Promise<ProcessNotificationOptOutResult> {
  if (message.messageType !== "text" || !message.textBody) {
    return { action: "ignored", affectedRecipients: 0 };
  }
  const { data, error } = await getServerSupabaseClient().rpc(
    "process_notification_opt_out",
    {
      p_contact_wa_id: message.contactWaId,
      p_text_body: message.textBody,
    },
  );
  if (error) {
    throw new Error(
      `Could not process notification opt-out (${error.code})`,
      { cause: error },
    );
  }
  const row = (data as Array<{
    action?: string;
    affected_recipients?: number;
  }> | null)?.[0];
  const action = row?.action === "unsubscribed" ||
      row?.action === "resubscribed"
    ? row.action
    : "ignored";
  return {
    action,
    affectedRecipients: row?.affected_recipients ?? 0,
  };
}
