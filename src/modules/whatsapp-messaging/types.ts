export type WhatsAppPhoneNumber = {
  id: string;
  companyId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  metaPhoneNumberId: string;
};

export type WhatsAppTemplate = {
  name: string;
  language: string;
  category: string | null;
  body: string | null;
  bodyParameterCount: number;
  bodyParameterNames: string[];
};

export type WhatsAppMessage = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  message_type: string;
  text_body: string | null;
  source_timestamp: string;
  meta_message_id: string;
  whatsapp_conversations:
    | {
        contact_wa_id: string;
        contact_name: string | null;
      }
    | Array<{
        contact_wa_id: string;
        contact_name: string | null;
      }>
    | null;
  whatsapp_phone_numbers:
    | {
        display_phone_number: string | null;
        verified_name: string | null;
      }
    | Array<{
        display_phone_number: string | null;
        verified_name: string | null;
      }>
    | null;
};

export type WhatsAppContactList = {
  id: string;
  company_id: string;
  name: string;
  source_filename: string | null;
  contact_count: number;
  created_at: string;
};

export type WhatsAppCampaign = {
  id: string;
  company_id: string;
  name: string;
  status: string;
  template_name: string;
  template_language: string;
  batch_size: number;
  delay_seconds: number;
  daily_message_limit: number;
  daily_send_time: string;
  send_timezone: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  next_batch_at: string;
  created_at: string;
  whatsapp_contact_lists: { name: string; contact_count: number } | null;
  whatsapp_phone_numbers: {
    display_phone_number: string | null;
    verified_name: string | null;
  } | null;
  recipientSummary: {
    counts: Record<"queued" | "processing" | "sent" | "delivered" | "read" | "failed" | "skipped", number>;
    failures: Array<{
      contactName: string | null;
      phoneSuffix: string;
      reason: string;
      code: string | null;
    }>;
  };
};

export type WhatsAppDailyQueue = {
  campaignId: string;
  campaignName: string;
  dailyMessageLimit: number;
  sentToday: number;
  remainingToday: number;
  rows: Array<{
    id: string;
    name: string | null;
    phoneNumber: string;
    status: string;
    sentAt: string | null;
    crmMarkedAt: string | null;
  }>;
};

export type WhatsAppWorkerHealth = {
  cronActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastHttpStatus: number | null;
  lastResponse: {
    mode?: string;
    claimed?: number;
    sent?: number;
    retried?: number;
    failed?: number;
    skipped?: number;
  } | null;
  nextRunAt: string | null;
  testMode: boolean;
};

export type WhatsAppConversation = {
  id: string;
  company_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  last_message_at: string;
  whatsapp_phone_numbers:
    | { display_phone_number: string | null; verified_name: string | null }
    | null;
};

export type WhatsAppThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  message_type: string;
  text_body: string | null;
  source_timestamp: string;
};
