import assert from "node:assert/strict";
import test from "node:test";
import { hasWorkspacePaymentAccess } from "./paymentAccess.ts";

test("a generic trial cannot enter the workspace", () => {
  assert.equal(
    hasWorkspacePaymentAccess({ status: "trialing", is_invitation_trial: false }),
    false,
  );
  assert.equal(
    hasWorkspacePaymentAccess({ status: "trialing" }),
    false,
  );
});

test("only a verified Super Admin invitation can use a trial", () => {
  assert.equal(
    hasWorkspacePaymentAccess({ status: "trialing", is_invitation_trial: true }),
    true,
  );
});

test("a paid or grandfathered subscription can enter the workspace", () => {
  assert.equal(hasWorkspacePaymentAccess({ status: "active" }), true);
  assert.equal(hasWorkspacePaymentAccess({ status: "grandfathered" }), true);
  assert.equal(hasWorkspacePaymentAccess({ status: "past_due" }), false);
  assert.equal(hasWorkspacePaymentAccess(null), false);
});
