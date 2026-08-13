import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionWebhookAction } from "./subscription-state.ts";

test("preserves a trial when an unpaid checkout is cancelled", () => {
  assert.equal(
    subscriptionWebhookAction("subscription.cancelled", "trialing"),
    "preserve_trial",
  );
  assert.equal(
    subscriptionWebhookAction("subscription.completed", "trialing"),
    "preserve_trial",
  );
});

test("preserves a trial when initial payment does not complete", () => {
  assert.equal(
    subscriptionWebhookAction("payment.failed", "trialing"),
    "preserve_trial",
  );
  assert.equal(
    subscriptionWebhookAction("subscription.pending", "trialing"),
    "preserve_trial",
  );
  assert.equal(
    subscriptionWebhookAction("subscription.halted", "trialing"),
    "preserve_trial",
  );
});

test("activates a trial only after Razorpay confirms authorization or payment", () => {
  for (const eventType of [
    "subscription.authenticated",
    "subscription.activated",
    "subscription.charged",
  ]) {
    assert.equal(
      subscriptionWebhookAction(eventType, "trialing"),
      "activate",
    );
  }
});

test("still applies cancellation to an already paid subscription", () => {
  assert.equal(
    subscriptionWebhookAction("subscription.cancelled", "active"),
    "cancel",
  );
});
