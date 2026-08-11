export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "suspended"
  | "grandfathered";

export type BillingPeriod = "monthly" | "yearly";

export type PlanAccessLevel = "full" | "read_only" | "locked";

export type SubscriptionAccess = {
  company_id: string | null;
  plan_key: "starter" | "premium" | null;
  plan_name: string | null;
  price_paise: number | null;
  monthly_price_paise: number | null;
  yearly_price_paise: number | null;
  currency: string | null;
  billing_period: BillingPeriod;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  days_remaining: number;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  write_allowed: boolean;
  is_admin: boolean;
  enabled_modules: string[];
  module_access: Record<string, PlanAccessLevel>;
  capability_access: Record<string, PlanAccessLevel>;
  seat_limit: number | null;
  seats_used: number;
};

export type BillingPlan = {
  plan_key: "starter" | "premium";
  display_name: string;
  price_paise: number;
  yearly_price_paise: number;
  currency: string;
  billing_period: "monthly";
};

export type CheckoutSession = {
  upgradeCompleted?: boolean;
  keyId: string;
  subscriptionId?: string;
  planName: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
};

export type RazorpayAuthorizationResult = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};
