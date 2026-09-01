import type { BillingPeriod, BillingPlan, CheckoutQuote } from "./types";

const SUBSCRIPTION_GST_RATE = 18;

export function checkoutQuoteFromPlan(
  plan: BillingPlan,
  billingPeriod: BillingPeriod,
): CheckoutQuote {
  const baseAmountPaise =
    billingPeriod === "yearly" ? plan.yearly_price_paise : plan.price_paise;
  const totalAmountPaise = Math.round(
    baseAmountPaise * (100 + SUBSCRIPTION_GST_RATE) / 100,
  );

  return {
    planName: plan.display_name,
    billingPeriod,
    baseAmountPaise,
    gstAmountPaise: totalAmountPaise - baseAmountPaise,
    totalAmountPaise,
    discountAmountPaise: 0,
    payableAmountPaise: totalAmountPaise,
    discountApplied: false,
  };
}

export function formatBillingAmount(amountPaise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountPaise / 100);
}
