import assert from "node:assert/strict";
import test from "node:test";
import { trialCheckoutAction } from "./checkout-state.ts";

test("reuses an unauthenticated checkout for the same plan", () => {
  assert.equal(
    trialCheckoutAction("created", "plan_pro_monthly", "plan_pro_monthly"),
    "reuse",
  );
});

test("replaces an unauthenticated checkout when the plan changes", () => {
  assert.equal(
    trialCheckoutAction("created", "plan_pro_monthly", "plan_core_yearly"),
    "replace",
  );
});

test("updates authenticated subscriptions when the plan changes", () => {
  assert.equal(
    trialCheckoutAction(
      "authenticated",
      "plan_pro_monthly",
      "plan_core_yearly",
    ),
    "update",
  );
});

test("replaces expired or cancelled checkout ids", () => {
  assert.equal(
    trialCheckoutAction("cancelled", "plan_core_yearly", "plan_core_yearly"),
    "replace",
  );
  assert.equal(
    trialCheckoutAction("expired", "plan_core_yearly", "plan_core_yearly"),
    "replace",
  );
});
