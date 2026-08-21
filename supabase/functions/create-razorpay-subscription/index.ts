import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { trialCheckoutAction } from "./checkout-state.ts";
import { discountCodeMatches } from "./discount-code.ts";

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
      discountCode?: unknown;
    };
    if (body.planKey !== "starter" && body.planKey !== "premium") {
      return json({ error: "Invalid plan" }, 400);
    }
    if (body.billingPeriod !== "monthly" && body.billingPeriod !== "yearly") {
      return json({ error: "Invalid billing period" }, 400);
    }
    const planKey = body.planKey as PlanKey;
    const billingPeriod = body.billingPeriod as BillingPeriod;
    const offerId = resolveDiscountOffer(body.discountCode);

    const { data: access, error: accessError } = await caller.rpc(
      "get_current_subscription_access",
    );
    if (accessError || !access?.company_id) {
      return json({ error: "Workspace subscription not found" }, 404);
    }
    if (!access.is_admin) return json({ error: "Company admin access required" }, 403);
    if (access.plan_key === "premium" && planKey === "starter" && access.status === "active") {
      return json({ error: "Pro downgrades are not available yet" }, 409);
    }

    if (planKey === "starter") {
      const { data: corePlan, error: planError } = await service
        .from("subscription_plans")
        .select("seat_limit")
        .eq("plan_key", "starter")
        .single();
      if (planError) throw new Error(planError.message);

      const { count: seatsUsed, error: seatsError } = await service
        .from("users_profile")
        .select("id", { count: "exact", head: true })
        .eq("company_id", access.company_id)
        .in("status", ["active", "invited"]);
      if (seatsError) throw new Error(seatsError.message);

      if (corePlan.seat_limit !== null && (seatsUsed ?? 0) > corePlan.seat_limit) {
        return json({
          error: `Bizlee Core supports ${corePlan.seat_limit} total users. Deactivate active or invited staff before choosing Core.`,
          code: "seat_limit_exceeded",
          seatLimit: corePlan.seat_limit,
          seatsUsed: seatsUsed ?? 0,
        }, 409);
      }
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
      offerId &&
      currentSubscription?.razorpay_subscription_id &&
      currentSubscription.status !== "trialing"
    ) {
      throw new CheckoutError(
        "Discount codes apply only when creating a new subscription.",
        409,
      );
    }

    // A tenant remains on Pro for the whole free trial. If it already started
    // checkout, reuse it when it already targets the selected plan. Razorpay
    // does not allow a subscription in the `created` state to be updated, so a
    // different selection must replace that unauthenticated checkout instead.
    // The webhook applies the paid plan after activation.
    if (
      currentSubscription?.razorpay_subscription_id &&
      currentSubscription.status === "trialing"
    ) {
      const providerSubscription = await razorpayRequest(
        `/v1/subscriptions/${currentSubscription.razorpay_subscription_id}`,
        undefined,
        "GET",
      );
      const targetPlanId = planId(planKey, billingPeriod);
      const providerStatus = typeof providerSubscription.status === "string"
        ? providerSubscription.status
        : null;
      const providerPlanId = typeof providerSubscription.plan_id === "string"
        ? providerSubscription.plan_id
        : null;
      const providerOfferId = typeof providerSubscription.offer_id === "string"
        ? providerSubscription.offer_id
        : null;
      const offerChanged = providerOfferId !== (offerId ?? null);
      const checkoutAction = trialCheckoutAction(
        providerStatus,
        providerPlanId,
        targetPlanId,
      );

      if (offerChanged && providerStatus === "created") {
        await razorpayRequest(
          `/v1/subscriptions/${currentSubscription.razorpay_subscription_id}/cancel`,
          { cancel_at_cycle_end: false },
        );
      } else if (
        offerChanged &&
        offerId &&
        providerStatus !== "cancelled" &&
        providerStatus !== "expired"
      ) {
        throw new CheckoutError(
          "This discount code cannot be applied after subscription authorization has started.",
          409,
        );
      } else if (checkoutAction === "reuse") {
        return checkoutResponse(
          currentSubscription.razorpay_subscription_id,
          planKey,
          profile,
          authData.user,
          Boolean(providerOfferId),
        );
      } else if (checkoutAction === "update") {
        await razorpayRequest(
          `/v1/subscriptions/${currentSubscription.razorpay_subscription_id}`,
          {
            plan_id: targetPlanId,
            schedule_change_at: "now",
            customer_notify: 1,
          },
          "PATCH",
        );
        const { error: trialCheckoutError } = await service
          .from("company_subscriptions")
          .update({ billing_period: billingPeriod })
          .eq("company_id", access.company_id)
          .eq(
            "razorpay_subscription_id",
            currentSubscription.razorpay_subscription_id,
          );
        if (trialCheckoutError) throw new Error(trialCheckoutError.message);

        return checkoutResponse(
          currentSubscription.razorpay_subscription_id,
          planKey,
          profile,
          authData.user,
          Boolean(providerOfferId),
        );
      } else if (providerStatus === "created") {
        await razorpayRequest(
          `/v1/subscriptions/${currentSubscription.razorpay_subscription_id}/cancel`,
          { cancel_at_cycle_end: false },
        );
      }
    }

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
        planName: displayPlanName(planKey),
        customerName: profile?.full_name ?? null,
        customerEmail: profile?.email ?? authData.user.email ?? null,
        customerPhone: profile?.phone ?? authData.user.phone ?? null,
      });
    }

    if (
      currentSubscription?.razorpay_subscription_id &&
      currentSubscription.plan_key === planKey &&
      currentSubscription.billing_period === billingPeriod &&
      currentSubscription.status === "past_due"
    ) {
      return json({
        keyId: requiredEnv("RAZORPAY_KEY_ID"),
        subscriptionId: currentSubscription.razorpay_subscription_id,
        planName: displayPlanName(planKey),
        customerName: profile?.full_name ?? null,
        customerEmail: profile?.email ?? authData.user.email ?? null,
        customerPhone: profile?.phone ?? authData.user.phone ?? null,
      });
    }

    const razorpaySubscription = await razorpayRequest("/v1/subscriptions", {
      plan_id: planId(planKey, billingPeriod),
      ...(offerId ? { offer_id: offerId } : {}),
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
    const providerOfferId = typeof razorpaySubscription.offer_id === "string"
      ? razorpaySubscription.offer_id
      : null;
    if (offerId && providerOfferId !== offerId) {
      await cancelCreatedSubscription(razorpaySubscription.id);
      throw new CheckoutError(
        "Razorpay created checkout without applying the discount offer. Verify the offer is enabled and applicable to this plan.",
        502,
      );
    }

    const subscriptionPatch = currentSubscription?.status === "trialing"
      ? {
        billing_period: billingPeriod,
        razorpay_subscription_id: razorpaySubscription.id,
      }
      : {
        plan_key: planKey,
        billing_period: billingPeriod,
        razorpay_subscription_id: razorpaySubscription.id,
      };
    const { error: saveError } = await service
      .from("company_subscriptions")
      .update(subscriptionPatch)
      .eq("company_id", access.company_id);
    if (saveError) throw new Error(saveError.message);

    return json({
      keyId: requiredEnv("RAZORPAY_KEY_ID"),
      subscriptionId: razorpaySubscription.id,
      planName: displayPlanName(planKey),
      discountApplied: Boolean(providerOfferId),
      customerName: profile?.full_name ?? null,
      customerEmail: profile?.email ?? authData.user.email ?? null,
      customerPhone: profile?.phone ?? authData.user.phone ?? null,
    });
  } catch (error) {
    console.error("Create Razorpay subscription failed", safeMessage(error));
    return json(
      { error: safeMessage(error) },
      error instanceof CheckoutError ? error.status : 500,
    );
  }
});

function planId(planKey: PlanKey, billingPeriod: BillingPeriod) {
  const prefix = planKey === "starter" ? "STARTER" : "PREMIUM";
  const suffix = billingPeriod === "yearly" ? "YEARLY" : "MONTHLY";
  return requiredEnv(`RAZORPAY_${prefix}_${suffix}_PLAN_ID`);
}

function displayPlanName(planKey: PlanKey) {
  return planKey === "starter" ? "Bizlee Core" : "Bizlee Pro";
}

function checkoutResponse(
  subscriptionId: string,
  planKey: PlanKey,
  profile: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null,
  user: { email?: string | null; phone?: string | null },
  discountApplied = false,
) {
  return json({
    keyId: requiredEnv("RAZORPAY_KEY_ID"),
    subscriptionId,
    planName: displayPlanName(planKey),
    discountApplied,
    customerName: profile?.full_name ?? null,
    customerEmail: profile?.email ?? user.email ?? null,
    customerPhone: profile?.phone ?? user.phone ?? null,
  });
}

function resolveDiscountOffer(discountCode: unknown) {
  if (discountCode === undefined || discountCode === null || discountCode === "") {
    return undefined;
  }
  if (
    typeof discountCode !== "string" ||
    !discountCodeMatches(
      discountCode,
      Deno.env.get("RAZORPAY_LIVE_DISCOUNT_CODE"),
    )
  ) {
    throw new CheckoutError("Invalid discount code", 400);
  }
  return requiredEnv("RAZORPAY_LIVE_DISCOUNT_OFFER_ID");
}

class CheckoutError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function razorpayRequest(
  path: string,
  body?: Record<string, unknown>,
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
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new CheckoutError(
      razorpayErrorMessage(payload?.error?.description),
      502,
    );
  }
  return payload as Record<string, unknown>;
}

async function cancelCreatedSubscription(subscriptionId: string) {
  try {
    await razorpayRequest(`/v1/subscriptions/${subscriptionId}/cancel`, {
      cancel_at_cycle_end: false,
    });
  } catch (error) {
    console.error("Unable to cancel non-discounted Razorpay checkout", safeMessage(error));
  }
}

function razorpayErrorMessage(description: unknown) {
  const message = typeof description === "string" && description.trim()
    ? description.trim()
    : "Razorpay rejected the request";
  if (message.toLowerCase().includes("discounted amount less than minimum")) {
    return "Razorpay cannot apply a full subscription discount because the payable amount must stay above Rs.1. Update the offer to leave at least Rs.1 payable, then retry checkout.";
  }
  return message;
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
