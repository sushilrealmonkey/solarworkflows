import type { User } from "@supabase/supabase-js";

import { getServerSupabaseClient } from "./persistence.js";

const ACCESS_TOKEN_ENV_NAME = "META_WHATSAPP_ACCESS_TOKEN";
const GRAPH_VERSION_ENV_NAME = "META_WHATSAPP_GRAPH_API_VERSION";
const PHONE_NUMBER_PATH = "/api/whatsapp/phone-numbers";
const TEMPLATE_PATH = "/api/whatsapp/templates";
const MESSAGE_PATH = "/api/whatsapp/messages";
const SEND_PATH = "/api/whatsapp/send-template";

type JsonObject = Record<string, unknown>;

type PhoneNumberRow = {
  id: string;
  company_id: string;
  meta_phone_number_id: string;
  meta_business_account_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  is_active: boolean;
};

type MetaTemplate = {
  name?: string;
  status?: string;
  language?: string;
  category?: string;
  components?: Array<{
    type?: string;
    text?: string;
  }>;
};

type MetaTemplateResponse = {
  data?: MetaTemplate[];
  error?: {
    code?: number;
    message?: string;
  };
};

type MetaSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    code?: number;
    message?: string;
  };
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isWhatsAppAdminPath(pathname: string): boolean {
  return (
    pathname === PHONE_NUMBER_PATH ||
    pathname === TEMPLATE_PATH ||
    pathname === MESSAGE_PATH ||
    pathname === SEND_PATH
  );
}

export async function handleWhatsAppAdminRequest(
  request: Request,
): Promise<Response> {
  try {
    await requireSuperAdmin(request);
    const url = new URL(request.url);

    if (url.pathname === PHONE_NUMBER_PATH && request.method === "GET") {
      return jsonResponse({ phoneNumbers: await listPhoneNumbers() }, 200);
    }

    if (url.pathname === TEMPLATE_PATH && request.method === "GET") {
      return jsonResponse(
        {
          templates: await listTemplates(
            requireUuid(url.searchParams.get("phoneNumberId")),
          ),
        },
        200,
      );
    }

    if (url.pathname === MESSAGE_PATH && request.method === "GET") {
      return jsonResponse({ messages: await listRecentMessages() }, 200);
    }

    if (url.pathname === SEND_PATH && request.method === "POST") {
      return jsonResponse(
        await sendTemplateMessage(await parseJsonBody(request)),
        201,
      );
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    console.error("WhatsApp admin API error", safeError(error));
    if (safeError(error).includes("must be configured")) {
      return jsonResponse(
        { error: "WhatsApp server configuration is incomplete" },
        503,
      );
    }
    return jsonResponse({ error: "WhatsApp request failed" }, 500);
  }
}

async function requireSuperAdmin(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    throw new ApiError("Authentication required", 401);
  }

  const supabase = getServerSupabaseClient();
  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);

  if (userError || !userData.user) {
    throw new ApiError("Invalid session", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users_profile")
    .select("status, is_super_admin")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    profile.status !== "active" ||
    profile.is_super_admin !== true
  ) {
    throw new ApiError("Super-admin access required", 403);
  }

  return userData.user;
}

async function listPhoneNumbers() {
  const { data, error } = await getServerSupabaseClient()
    .from("whatsapp_phone_numbers")
    .select(
      "id, company_id, meta_phone_number_id, meta_business_account_id, display_phone_number, verified_name, is_active",
    )
    .eq("is_active", true)
    .order("verified_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load phone numbers (${error.code})`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    displayPhoneNumber: row.display_phone_number,
    verifiedName: row.verified_name,
    metaPhoneNumberId: row.meta_phone_number_id,
  }));
}

async function getPhoneNumber(id: string): Promise<PhoneNumberRow> {
  const { data, error } = await getServerSupabaseClient()
    .from("whatsapp_phone_numbers")
    .select(
      "id, company_id, meta_phone_number_id, meta_business_account_id, display_phone_number, verified_name, is_active",
    )
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    throw new ApiError("WhatsApp phone number was not found", 404);
  }

  return data as PhoneNumberRow;
}

async function listTemplates(phoneNumberId: string) {
  const phoneNumber = await getPhoneNumber(phoneNumberId);

  if (!phoneNumber.meta_business_account_id) {
    throw new ApiError(
      "The WhatsApp Business Account ID is not configured",
      409,
    );
  }

  const endpoint = new URL(
    `${graphBaseUrl()}/${phoneNumber.meta_business_account_id}/message_templates`,
  );
  endpoint.searchParams.set(
    "fields",
    "name,status,language,category,components",
  );
  endpoint.searchParams.set("limit", "250");

  const response = await fetch(endpoint, {
    headers: metaHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await parseJson<MetaTemplateResponse>(response);

  if (!response.ok) {
    console.error("Meta template lookup failed", {
      status: response.status,
      code: payload.error?.code ?? null,
    });
    throw new ApiError("Could not load Meta templates", 502);
  }

  return (payload.data ?? [])
    .filter(
      (template) =>
        template.status === "APPROVED" &&
        typeof template.name === "string" &&
        typeof template.language === "string",
    )
    .map((template) => {
      const body = template.components?.find(
        (component) => component.type === "BODY",
      )?.text;

      return {
        name: template.name,
        language: template.language,
        category: template.category ?? null,
        body: body ?? null,
        bodyParameterCount: countTemplateParameters(body),
        bodyParameterNames: getTemplateParameterNames(body),
      };
    })
    .sort((left, right) => left.name!.localeCompare(right.name!));
}

async function listRecentMessages() {
  const { data, error } = await getServerSupabaseClient()
    .from("whatsapp_messages")
    .select(
      "id, direction, status, message_type, text_body, source_timestamp, meta_message_id, whatsapp_conversations(contact_wa_id, contact_name), whatsapp_phone_numbers(display_phone_number, verified_name)",
    )
    .order("source_timestamp", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Could not load WhatsApp messages (${error.code})`);
  }

  return data ?? [];
}

async function sendTemplateMessage(body: JsonObject) {
  const phoneNumberId = requireUuid(getString(body.phoneNumberId));
  const recipient = normalizeWhatsAppRecipient(getString(body.recipient));
  const templateName = requireTemplateName(getString(body.templateName));
  const language = requireLanguage(getString(body.language));
  const contactName = optionalText(getString(body.contactName), 200);
  const parameters = getStringArray(body.bodyParameters, 20, 1_000);
  const phoneNumber = await getPhoneNumber(phoneNumberId);
  const requestBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(parameters.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: parameters.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ],
          }
        : {}),
    },
  };

  const providerResponse = await fetch(
    `${graphBaseUrl()}/${phoneNumber.meta_phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        ...metaHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const providerPayload = await parseJson<MetaSendResponse>(providerResponse);
  const metaMessageId = providerPayload.messages?.[0]?.id?.trim();

  if (!providerResponse.ok || !metaMessageId) {
    console.error("Meta message send failed", {
      status: providerResponse.status,
      code: providerPayload.error?.code ?? null,
    });
    throw new ApiError(
      providerPayload.error?.message?.slice(0, 300) ||
        "Meta rejected the WhatsApp message",
      502,
    );
  }

  let recorded = true;

  try {
    await persistOutboundMessage({
      phoneNumber,
      recipient,
      contactName,
      templateName,
      language,
      parameters,
      metaMessageId,
    });
  } catch (error) {
    recorded = false;
    console.error(
      "Meta accepted a WhatsApp message but local persistence failed",
      {
        metaMessageId,
        error: safeError(error),
      },
    );
  }

  return {
    accepted: true,
    metaMessageId,
    recorded,
  };
}

async function persistOutboundMessage(input: {
  phoneNumber: PhoneNumberRow;
  recipient: string;
  contactName: string | null;
  templateName: string;
  language: string;
  parameters: string[];
  metaMessageId: string;
}) {
  const supabase = getServerSupabaseClient();
  const timestamp = new Date().toISOString();
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .upsert(
      {
        company_id: input.phoneNumber.company_id,
        whatsapp_phone_number_id: input.phoneNumber.id,
        contact_wa_id: input.recipient,
        contact_name: input.contactName,
        last_message_at: timestamp,
      },
      {
        onConflict: "company_id,whatsapp_phone_number_id,contact_wa_id",
      },
    )
    .select("id")
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Could not persist WhatsApp conversation (${conversationError?.code ?? "unknown"})`,
    );
  }

  const { error: messageError } = await supabase
    .from("whatsapp_messages")
    .insert({
      company_id: input.phoneNumber.company_id,
      conversation_id: conversation.id,
      whatsapp_phone_number_id: input.phoneNumber.id,
      meta_message_id: input.metaMessageId,
      direction: "outbound",
      message_type: "template",
      status: "sent",
      sender_wa_id:
        input.phoneNumber.display_phone_number ||
        input.phoneNumber.meta_phone_number_id,
      text_body: input.templateName,
      source_timestamp: timestamp,
      raw_payload: {
        templateName: input.templateName,
        language: input.language,
        bodyParameters: input.parameters,
      },
    });

  if (messageError) {
    throw new Error(
      `Could not persist WhatsApp message (${messageError.code})`,
    );
  }
}

async function parseJsonBody(request: Request): Promise<JsonObject> {
  try {
    const body = (await request.json()) as unknown;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error();
    }

    return body as JsonObject;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function getStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ApiError("Invalid template parameters", 400);
  }

  return value.map((item) => {
    const text = getString(item);

    if (!text || text.length > maximumLength) {
      throw new ApiError("Invalid template parameter", 400);
    }

    return text;
  });
}

function requireUuid(value: string | null): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError("Invalid phone number selection", 400);
  }

  return value;
}

function normalizeWhatsAppRecipient(value: string | null): string {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new ApiError(
      "Enter a recipient number with its country code",
      400,
    );
  }

  return digits;
}

function requireTemplateName(value: string | null): string {
  if (!value || !/^[a-z0-9_]{1,512}$/.test(value)) {
    throw new ApiError("Invalid template name", 400);
  }

  return value;
}

function requireLanguage(value: string | null): string {
  if (!value || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value)) {
    throw new ApiError("Invalid template language", 400);
  }

  return value;
}

function optionalText(
  value: string | null,
  maximumLength: number,
): string | null {
  if (!value) {
    return null;
  }

  if (value.length > maximumLength) {
    throw new ApiError("Contact name is too long", 400);
  }

  return value;
}

function countTemplateParameters(body: string | undefined): number {
  return getTemplateParameterNames(body).length;
}

function getTemplateParameterNames(body: string | undefined): string[] {
  if (!body) {
    return [];
  }

  const names = [...body.matchAll(/\{\{\s*([a-zA-Z_][\w]*|\d+)\s*\}\}/g)]
    .map((match) => match[1]);
  const numeric = names.filter((name) => /^\d+$/.test(name)).map(Number);
  if (numeric.length > 0) {
    return Array.from(
      { length: Math.max(...numeric) },
      (_, index) => String(index + 1),
    );
  }
  return [...new Set(names)];
}

function metaHeaders() {
  return {
    Authorization: `Bearer ${requireEnv(ACCESS_TOKEN_ENV_NAME)}`,
  };
}

function graphBaseUrl() {
  const version = requireEnv(GRAPH_VERSION_ENV_NAME);

  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(`${GRAPH_VERSION_ENV_NAME} is invalid`);
  }

  return `https://graph.facebook.com/${version}`;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

function jsonResponse(body: JsonObject, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
