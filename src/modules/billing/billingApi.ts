import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../services/supabaseClient";
import type {
  BillingPeriod,
  BillingPlan,
  CheckoutSession,
  RazorpayAuthorizationResult,
  SubscriptionAccess,
} from "./types";

function requireClient() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

export async function fetchSubscriptionAccess() {
  const { data, error } = await requireClient().rpc(
    "get_current_subscription_access",
  );

  if (error) throw new Error(await getFunctionErrorMessage(error));
  return data as SubscriptionAccess;
}

async function getFunctionErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Fall through to the client error below.
    }
  }
  return error instanceof Error ? error.message : "Action failed.";
}

export async function fetchBillingPlans() {
  const { data, error } = await requireClient()
    .from("subscription_plans")
    .select(
      "plan_key, display_name, price_paise, yearly_price_paise, currency, billing_period",
    )
    .eq("is_active", true)
    .order("price_paise");

  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlan[];
}

export async function createRazorpayCheckout(
  planKey: BillingPlan["plan_key"],
  billingPeriod: BillingPeriod,
  discountCode?: string,
) {
  const { data, error } = await requireClient().functions.invoke(
    "create-razorpay-subscription",
    {
      body: {
        planKey,
        billingPeriod,
        discountCode: discountCode?.trim() || undefined,
      },
    },
  );

  if (error) throw new Error(await getFunctionErrorMessage(error));
  if ((!data?.subscriptionId && !data?.upgradeCompleted) || !data?.keyId) {
    throw new Error("The payment session could not be created.");
  }

  return data as CheckoutSession;
}

export async function cancelRazorpaySubscription() {
  const { data, error } = await requireClient().functions.invoke(
    "cancel-razorpay-subscription",
    { body: {} },
  );
  if (error) throw new Error(error.message);
  if (!data?.scheduled) throw new Error("Cancellation could not be scheduled.");
}

export async function verifyRazorpayAuthorization(
  authorization: RazorpayAuthorizationResult,
) {
  const { data, error } = await requireClient().functions.invoke(
    "verify-razorpay-subscription",
    { body: authorization },
  );

  if (error) throw new Error(error.message);
  if (!data?.verified) {
    throw new Error("The UPI AutoPay mandate could not be verified.");
  }
}

export async function dismissSubscriptionMilestone(milestone: string) {
  const { error } = await requireClient().rpc(
    "dismiss_subscription_notification",
    { notification_milestone: milestone },
  );
  if (error) throw new Error(error.message);
}

export async function fetchDismissedSubscriptionMilestones() {
  const { data, error } = await requireClient()
    .from("subscription_notification_state")
    .select("milestone")
    .not("dismissed_at", "is", null);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.milestone));
}
