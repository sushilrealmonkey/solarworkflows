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

export interface ProcessWhatsAppStatusResult {
  mapped: boolean;
  found: boolean;
  updated: boolean;
  companyId: string | null;
  messageId: string | null;
  status: string | null;
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
  const { data, error } = await getServerSupabaseClient().rpc(
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
  );

  if (error) {
    throw new Error(
      `Could not process WhatsApp status (${error.code})`,
      { cause: error },
    );
  }

  const row = (data as ProcessWhatsAppStatusRow[] | null)?.[0];

  if (!row) {
    throw new Error("WhatsApp status RPC returned no result");
  }

  return {
    mapped: row.mapped,
    found: row.message_found,
    updated: row.updated,
    companyId: row.company_id,
    messageId: row.message_id,
    status: row.status,
  };
}
