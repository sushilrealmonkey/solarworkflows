import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  createCallerClient,
  jsonResponse,
  requireEnv,
  resolveCorsOrigin,
} from "../_shared/assistant.ts";
import { normalizePhone } from "../_shared/meta-whatsapp.ts";

const allowedTypes = new Set([
  "trial_ending",
  "trial_expired",
  "subscription_action_required",
  "subscription_payment_received",
  "requested_daily_summary",
  "new_signin_alert",
  "account_change_notice",
  "product_tip",
  "plan_offer",
  "product_announcement",
]);

type PreferenceInput = {
  notification_type?: unknown;
  is_enabled?: unknown;
  delivery_time?: unknown;
  timezone?: unknown;
};

Deno.serve(async (request) => {
  const response = await handleRequest(request);
  response.headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(request));
  response.headers.append("Vary", "Origin");
  return response;
});

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return jsonResponse({}, 204);
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication is required" }, 401);
  }

  const caller = createCallerClient(authorization);
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse({ error: "Authentication is required" }, 401);
  }
  const service = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const { data: profile, error: profileError } = await service
    .from("users_profile")
    .select(
      "id,company_id,full_name,phone,phone_verified,status,is_super_admin",
    )
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: profileError.message }, 400);
  if (
    !profile?.company_id ||
    profile.status !== "active" ||
    profile.is_super_admin
  ) {
    return jsonResponse({ error: "An active tenant account is required" }, 403);
  }

  const { data: adminRole } = await service
    .from("user_roles")
    .select("id,roles!inner(role_key)")
    .or(
      `user_profile_id.eq.${profile.id},user_id.eq.${authData.user.id}`,
    )
    .eq("roles.role_key", "admin")
    .limit(1)
    .maybeSingle();
  if (!adminRole) {
    return jsonResponse(
      { error: "Only tenant administrators can manage WhatsApp notifications" },
      403,
    );
  }

  const recipient = await ensureRecipient(service, profile);
  const body = await request.json().catch(() => ({})) as {
    action?: unknown;
    preferences?: PreferenceInput[];
  };

  if (body.action === "save") {
    if (!recipient) {
      return jsonResponse(
        { error: "A verified WhatsApp phone number is required" },
        400,
      );
    }
    const preferences = Array.isArray(body.preferences)
      ? body.preferences
      : [];
    for (const input of preferences) {
      await savePreference(service, profile.company_id, recipient.id, input);
    }
  }

  return jsonResponse(
    await loadSettings(service, profile.company_id, profile, recipient),
  );
}

async function ensureRecipient(
  service: ReturnType<typeof createClient>,
  profile: {
    id: string;
    company_id: string;
    phone: string | null;
    phone_verified: boolean | null;
  },
) {
  const { data: existing, error } = await service
    .from("notification_recipients")
    .select("*")
    .eq("company_id", profile.company_id)
    .eq("user_profile_id", profile.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing;
  if (!profile.phone || !profile.phone_verified) return null;

  let phoneE164: string;
  try {
    phoneE164 = `+${normalizePhone(profile.phone)}`;
  } catch {
    return null;
  }
  const { data, error: insertError } = await service
    .from("notification_recipients")
    .insert({
      company_id: profile.company_id,
      user_profile_id: profile.id,
      phone_e164: phoneE164,
      verification_status: "verified",
      verified_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);
  return data;
}

async function savePreference(
  service: ReturnType<typeof createClient>,
  companyId: string,
  recipientId: string,
  input: PreferenceInput,
) {
  const notificationType = typeof input.notification_type === "string"
    ? input.notification_type
    : "";
  if (!allowedTypes.has(notificationType)) {
    throw new Error("Unsupported notification preference");
  }
  const enabled = input.is_enabled === true;
  const timezone = validTimezone(input.timezone) ? input.timezone : "Asia/Kolkata";
  const deliveryTime = notificationType === "requested_daily_summary" &&
      typeof input.delivery_time === "string" &&
      /^\d{2}:\d{2}$/.test(input.delivery_time)
    ? `${input.delivery_time}:00`
    : null;

  const { error } = await service.from("notification_preferences").upsert(
    {
      company_id: companyId,
      recipient_id: recipientId,
      notification_type: notificationType,
      channel: "whatsapp",
      is_enabled: enabled,
      delivery_time: deliveryTime,
      timezone,
      consent_status: enabled ? "granted" : "revoked",
      consent_source: "bizlee_settings",
      consented_at: enabled ? new Date().toISOString() : null,
    },
    {
      onConflict: "company_id,recipient_id,notification_type,channel",
    },
  );
  if (error) throw new Error(error.message);

  const { data: unsubscribe } = await service
    .from("notification_unsubscribes")
    .select("id")
    .eq("company_id", companyId)
    .eq("recipient_id", recipientId)
    .eq("scope", notificationType)
    .maybeSingle();
  if (enabled && unsubscribe) {
    await service.from("notification_unsubscribes")
      .update({ resubscribed_at: new Date().toISOString() })
      .eq("id", unsubscribe.id);
  } else if (!enabled) {
    await service.from("notification_unsubscribes").upsert(
      {
        company_id: companyId,
        recipient_id: recipientId,
        scope: notificationType,
        source: "bizlee_settings",
        unsubscribed_at: new Date().toISOString(),
        resubscribed_at: null,
      },
      { onConflict: "company_id,recipient_id,scope" },
    );
  }
}

async function loadSettings(
  service: ReturnType<typeof createClient>,
  companyId: string,
  profile: {
    phone: string | null;
    phone_verified: boolean | null;
  },
  recipient: Record<string, unknown> | null,
) {
  if (!recipient) {
    return {
      recipient: null,
      profile_phone: profile.phone,
      profile_phone_verified: Boolean(profile.phone_verified),
      preferences: [],
      recent_deliveries: [],
    };
  }
  const [{ data: preferences, error: preferenceError }, {
    data: deliveries,
    error: deliveryError,
  }] = await Promise.all([
    service.from("notification_preferences")
      .select(
        "notification_type,is_enabled,delivery_time,timezone,consent_status",
      )
      .eq("company_id", companyId)
      .eq("recipient_id", recipient.id),
    service.from("notification_deliveries")
      .select(
        "id,status,created_at,sent_at,delivered_at,read_at,failure_message,notification_events(event_type)",
      )
      .eq("company_id", companyId)
      .eq("recipient_id", recipient.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (preferenceError) throw new Error(preferenceError.message);
  if (deliveryError) throw new Error(deliveryError.message);
  return {
    recipient,
    profile_phone: profile.phone,
    profile_phone_verified: Boolean(profile.phone_verified),
    preferences: preferences ?? [],
    recent_deliveries: deliveries ?? [],
  };
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
