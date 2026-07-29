import { supabase } from "../../services/supabaseClient";
import type {
  WhatsAppMessage,
  WhatsAppCampaign,
  WhatsAppContactList,
  WhatsAppConversation,
  WhatsAppPhoneNumber,
  WhatsAppTemplate,
  WhatsAppThreadMessage,
  WhatsAppWorkerHealth,
} from "./types";

type ApiErrorPayload = {
  error?: string;
};

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Your session has expired. Sign in again.");
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as T | ApiErrorPayload)
    : null;

  if (!response.ok) {
    throw new Error(
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : response.status === 502
          ? "The local API server is not running. Start it on port 3000."
          : "WhatsApp request failed.",
    );
  }

  if (!payload) {
    throw new Error(
      "The WhatsApp API returned an invalid response. Check that the local API server is running.",
    );
  }

  return payload as T;
}

export function fetchContactLists() {
  return apiRequest<{ contactLists: WhatsAppContactList[] }>("/api/whatsapp/contact-lists")
    .then((result) => result.contactLists);
}

export function importContactList(input: {
  phoneNumberId: string;
  name: string;
  filename: string;
  contacts: Array<{ phoneNumber: string; name: string; customFields: Record<string, string> }>;
}) {
  return apiRequest<{ id: string; imported: number }>("/api/whatsapp/contact-lists", {
    method: "POST", body: JSON.stringify(input),
  });
}

export function fetchCampaigns() {
  return apiRequest<{ campaigns: WhatsAppCampaign[] }>("/api/whatsapp/campaigns")
    .then((result) => result.campaigns);
}

export function createCampaign(input: Record<string, unknown>) {
  return apiRequest<{ id: string; status: string }>("/api/whatsapp/campaigns", {
    method: "POST", body: JSON.stringify(input),
  });
}

export function controlCampaign(campaignId: string, action: string) {
  return apiRequest<{ id: string; status: string }>("/api/whatsapp/campaign-control", {
    method: "POST", body: JSON.stringify({ campaignId, action }),
  });
}

export function fetchWorkerHealth() {
  return apiRequest<{ worker: WhatsAppWorkerHealth }>("/api/whatsapp/worker-health")
    .then((result) => result.worker);
}

export function processCampaignsNow() {
  return apiRequest<{ result: {
    mode: string;
    claimed: number;
    sent: number;
    retried: number;
    failed: number;
    skipped: number;
  } }>("/api/whatsapp/process-now", {
    method: "POST", body: "{}",
  }).then((result) => result.result);
}

export function fetchConversations() {
  return apiRequest<{ conversations: WhatsAppConversation[] }>("/api/whatsapp/conversations")
    .then((result) => result.conversations);
}

export function fetchConversationMessages(conversationId: string) {
  return apiRequest<{ messages: WhatsAppThreadMessage[] }>(
    `/api/whatsapp/conversation-messages?conversationId=${encodeURIComponent(conversationId)}`,
  ).then((result) => result.messages);
}

export function fetchOutreachSettings() {
  return apiRequest<{ settings: {
    company_id: string;
    default_batch_size: number;
    default_delay_seconds: number;
    daily_campaign_limit: number;
    daily_message_limit: number;
    opt_out_keywords: string[];
  } | null }>("/api/whatsapp/settings").then((result) => result.settings);
}

export function saveOutreachSettings(input: Record<string, unknown>) {
  return apiRequest<{ settings: unknown }>("/api/whatsapp/settings", {
    method: "PUT", body: JSON.stringify(input),
  });
}

export async function fetchWhatsAppPhoneNumbers() {
  const result = await apiRequest<{ phoneNumbers: WhatsAppPhoneNumber[] }>(
    "/api/whatsapp/phone-numbers",
  );

  if (!Array.isArray(result.phoneNumbers)) {
    throw new Error("The WhatsApp phone-number response is invalid.");
  }

  return result.phoneNumbers;
}

export async function fetchWhatsAppTemplates(phoneNumberId: string) {
  const result = await apiRequest<{ templates: WhatsAppTemplate[] }>(
    `/api/whatsapp/templates?phoneNumberId=${encodeURIComponent(phoneNumberId)}`,
  );

  if (!Array.isArray(result.templates)) {
    throw new Error("The WhatsApp template response is invalid.");
  }

  return result.templates;
}

export async function fetchRecentWhatsAppMessages() {
  const result = await apiRequest<{ messages: WhatsAppMessage[] }>(
    "/api/whatsapp/messages",
  );

  if (!Array.isArray(result.messages)) {
    throw new Error("The WhatsApp message response is invalid.");
  }

  return result.messages;
}

export async function sendWhatsAppTemplate(input: {
  phoneNumberId: string;
  recipient: string;
  contactName: string;
  templateName: string;
  language: string;
  bodyParameters: string[];
}) {
  return apiRequest<{
    accepted: boolean;
    metaMessageId: string;
    recorded: boolean;
  }>(
    "/api/whatsapp/send-template",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
