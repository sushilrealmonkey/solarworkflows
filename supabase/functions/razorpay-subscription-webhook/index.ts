import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type RazorpayEntity = {
  id?: string;
  plan_id?: string;
  status?: string;
  current_start?: number;
  current_end?: number;
  ended_at?: number;
  notes?: {
    company_id?: string;
    plan_key?: string;
    billing_period?: string;
  };
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";

  try {
    if (!eventId || !(await validSignature(rawBody, signature))) {
      return json({ error: "Invalid webhook signature" }, 401);
    }

    const service = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    const payload = JSON.parse(rawBody);
    const eventType = String(payload.event ?? "");

    const { error: eventError } = await service
      .from("subscription_webhook_events")
      .insert({
        provider_event_id: eventId,
        event_type: eventType,
        payload,
      });
    if (eventError?.code === "23505") {
      const { data: existingEvent } = await service
        .from("subscription_webhook_events")
        .select("processed_at")
        .eq("provider_event_id", eventId)
        .single();
      if (existingEvent?.processed_at) return json({ received: true });
    }
    if (eventError && eventError.code !== "23505") {
      throw new Error(eventError.message);
    }

    const entity = payload?.payload?.subscription?.entity as RazorpayEntity | undefined;
    const companyId = entity?.notes?.company_id;
    const resolvedPlan = resolvePlan(entity);
    const planKey = resolvedPlan?.planKey ?? entity?.notes?.plan_key;
    const billingPeriod =
      resolvedPlan?.billingPeriod ?? entity?.notes?.billing_period ?? "monthly";
    if (!entity?.id || !companyId || !["starter", "premium"].includes(planKey ?? "")) {
      throw new Error("Webhook subscription metadata is incomplete");
    }

    const patch = subscriptionPatch(
      eventType,
      entity,
      planKey!,
      billingPeriod,
    );
    const { data: updated, error: updateError } = await service
      .from("company_subscriptions")
      .update(patch)
      .eq("company_id", companyId)
      .eq("razorpay_subscription_id", entity.id)
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) throw new Error("Webhook subscription did not match a company");

    await service
      .from("subscription_webhook_events")
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("provider_event_id", eventId);

    return json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook failed", safeMessage(error));
    return json({ error: "Webhook processing failed" }, 500);
  }
});

function subscriptionPatch(
  eventType: string,
  entity: RazorpayEntity,
  planKey: string,
  billingPeriod: string,
) {
  const base: Record<string, unknown> = {
    plan_key: planKey,
    billing_period: billingPeriod,
    current_period_started_at: unixDate(entity.current_start),
    current_period_ends_at: unixDate(entity.current_end),
  };

  if (["subscription.authenticated", "subscription.activated", "subscription.charged"].includes(eventType)) {
    return { ...base, status: "active", cancel_at_period_end: false };
  }
  if (["subscription.pending", "payment.failed"].includes(eventType)) {
    return { ...base, status: "past_due" };
  }
  if (eventType === "subscription.halted") return { ...base, status: "suspended" };
  if (["subscription.cancelled", "subscription.completed"].includes(eventType)) {
    return {
      ...base,
      status: "cancelled",
      current_period_ends_at: unixDate(entity.ended_at ?? entity.current_end),
    };
  }
  return base;
}

function resolvePlan(entity: RazorpayEntity | undefined) {
  const configuredPlans = [
    {
      id: Deno.env.get("RAZORPAY_STARTER_MONTHLY_PLAN_ID"),
      planKey: "starter",
      billingPeriod: "monthly",
    },
    {
      id: Deno.env.get("RAZORPAY_STARTER_YEARLY_PLAN_ID"),
      planKey: "starter",
      billingPeriod: "yearly",
    },
    {
      id: Deno.env.get("RAZORPAY_PREMIUM_MONTHLY_PLAN_ID"),
      planKey: "premium",
      billingPeriod: "monthly",
    },
    {
      id: Deno.env.get("RAZORPAY_PREMIUM_YEARLY_PLAN_ID"),
      planKey: "premium",
      billingPeriod: "yearly",
    },
  ];
  return configuredPlans.find((plan) => plan.id && plan.id === entity?.plan_id);
}

function unixDate(value?: number) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function validSignature(body: string, received: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredEnv("RAZORPAY_WEBHOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
