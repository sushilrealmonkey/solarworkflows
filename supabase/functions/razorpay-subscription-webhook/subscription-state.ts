export type SubscriptionWebhookAction =
  | "activate"
  | "past_due"
  | "suspend"
  | "cancel"
  | "preserve_trial"
  | "metadata_only";

const activationEvents = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
]);

export function subscriptionWebhookAction(
  eventType: string,
  currentStatus: string,
): SubscriptionWebhookAction {
  if (activationEvents.has(eventType)) return "activate";

  // A Razorpay checkout is only a payment attempt. Until Razorpay confirms the
  // paid subscription, its failure, dismissal, or cancellation must not end an
  // existing Bizlee trial.
  if (currentStatus === "trialing") return "preserve_trial";

  if (["subscription.pending", "payment.failed"].includes(eventType)) {
    return "past_due";
  }
  if (eventType === "subscription.halted") return "suspend";
  if (["subscription.cancelled", "subscription.completed"].includes(eventType)) {
    return "cancel";
  }
  return "metadata_only";
}

export function isTerminalCheckoutEvent(eventType: string) {
  return ["subscription.cancelled", "subscription.completed"].includes(
    eventType,
  );
}
