import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type PlanKey = "starter" | "premium";
type BillingPeriod = "monthly" | "yearly";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

    const body = await request.json() as {
      planKey?: string;
      billingPeriod?: string;
    };
    if (body.planKey !== "starter" && body.planKey !== "premium") {
      return json({ error: "Invalid plan" }, 400);
    }
    if (body.billingPeriod !== "monthly" && body.billingPeriod !== "yearly") {
      return json({ error: "Invalid billing period" }, 400);
    }
    const planKey = body.planKey as PlanKey;
    const billingPeriod = body.billingPeriod as BillingPeriod;

    const { data: access, error: accessError } = await caller.rpc(
      "get_current_subscription_access",
    );
    if (accessError || !access?.company_id) {
      return json({ error: "Workspace subscription not found" }, 404);
    }
    if (!access.is_admin) return json({ error: "Company admin access required" }, 403);
    if (access.plan_key === "premium" && planKey === "starter" && access.status === "active") {
      return json({ error: "Premium downgrades are not available yet" }, 409);
    }

    const { data: profile } = await service
      .from("users_profile")
      .select("full_name, email, phone")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    const { data: currentSubscription } = await service
      .from("company_subscriptions")
      .select("razorpay_subscription_id, plan_key, billing_period, status")
      .eq("company_id", access.company_id)
      .single();

    if (
      currentSubscription?.razorpay_subscription_id &&
      currentSubscription.status === "active" &&
      (
        currentSubscription.plan_key !== planKey ||
        currentSubscription.billing_period !== billingPeriod
      )
    ) {
      await razorpayRequest(
        `/v1/subscriptions/${currentSubscription.razorpay_subscription_id}`,
        {
          plan_id: planId(planKey, billingPeriod),
          schedule_change_at: "now",
          customer_notify: 1,
        },
        "PATCH",
      );
      const { error: upgradeError } = await service
        .from("company_subscriptions")
        .update({
          plan_key: planKey,
          billing_period: billingPeriod,
          cancel_at_period_end: false,
        })
        .eq("company_id", access.company_id)
        .eq(
          "razorpay_subscription_id",
          currentSubscription.razorpay_subscription_id,
        );
      if (upgradeError) throw new Error(upgradeError.message);

      return json({
        keyId: requiredEnv("RAZORPAY_KEY_ID"),
        upgradeCompleted: true,
        planName: planKey === "starter" ? "Bizlee Starter" : "Bizlee Premium",
        customerName: profile?.full_name ?? null,
        customerEmail: profile?.email ?? authData.user.email ?? null,
        customerPhone: profile?.phone ?? authData.user.phone ?? null,
      });
    }

    if (
      currentSubscription?.razorpay_subscription_id &&
      currentSubscription.plan_key === planKey &&
      currentSubscription.billing_period === billingPeriod &&
      ["trialing", "past_due"].includes(currentSubscription.status)
    ) {
      return json({
        keyId: requiredEnv("RAZORPAY_KEY_ID"),
        subscriptionId: currentSubscription.razorpay_subscription_id,
        planName: planKey === "starter" ? "Bizlee Starter" : "Bizlee Premium",
        customerName: profile?.full_name ?? null,
        customerEmail: profile?.email ?? authData.user.email ?? null,
        customerPhone: profile?.phone ?? authData.user.phone ?? null,
      });
    }

    const razorpaySubscription = await razorpayRequest("/v1/subscriptions", {
      plan_id: planId(planKey, billingPeriod),
      total_count: billingPeriod === "yearly" ? 10 : 120,
      quantity: 1,
      customer_notify: 1,
      notes: {
        company_id: access.company_id,
        plan_key: planKey,
        billing_period: billingPeriod,
        created_by: authData.user.id,
      },
    });

    if (typeof razorpaySubscription.id !== "string") {
      throw new Error("Razorpay did not return a subscription id");
    }

    const { error: saveError } = await service
      .from("company_subscriptions")
      .update({
        plan_key: planKey,
        billing_period: billingPeriod,
        razorpay_subscription_id: razorpaySubscription.id,
      })
      .eq("company_id", access.company_id);
    if (saveError) throw new Error(saveError.message);

    return json({
      keyId: requiredEnv("RAZORPAY_KEY_ID"),
      subscriptionId: razorpaySubscription.id,
      planName: planKey === "starter" ? "Bizlee Starter" : "Bizlee Premium",
      customerName: profile?.full_name ?? null,
      customerEmail: profile?.email ?? authData.user.email ?? null,
      customerPhone: profile?.phone ?? authData.user.phone ?? null,
    });
  } catch (error) {
    console.error("Create Razorpay subscription failed", safeMessage(error));
    return json({ error: safeMessage(error) }, 500);
  }
});

function planId(planKey: PlanKey, billingPeriod: BillingPeriod) {
  const prefix = planKey === "starter" ? "STARTER" : "PREMIUM";
  const suffix = billingPeriod === "yearly" ? "YEARLY" : "MONTHLY";
  return requiredEnv(`RAZORPAY_${prefix}_${suffix}_PLAN_ID`);
}

async function razorpayRequest(
  path: string,
  body: Record<string, unknown>,
  method = "POST",
) {
  const credentials = btoa(
    `${requiredEnv("RAZORPAY_KEY_ID")}:${requiredEnv("RAZORPAY_KEY_SECRET")}`,
  );
  const response = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.description ?? "Razorpay rejected the request");
  }
  return payload as Record<string, unknown>;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to create payment session";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
