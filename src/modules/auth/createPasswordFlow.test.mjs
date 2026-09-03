import assert from "node:assert/strict";
import test from "node:test";
import {
  hasVerifiedPasswordSetupSession,
  isPasswordSetupLinkAwaitingVerification,
  shouldRedirectReadyPasswordSetupUser,
} from "./createPasswordFlow.ts";

test("an invite link always requires verification before using an existing session", () => {
  assert.equal(
    isPasswordSetupLinkAwaitingVerification("token", "pending"),
    true,
  );
  assert.equal(
    hasVerifiedPasswordSetupSession({
      hasSession: true,
      isVerifying: false,
      linkKind: "token",
      verificationStatus: "pending",
    }),
    false,
  );
  assert.equal(shouldRedirectReadyPasswordSetupUser(true, "token"), false);
});

test("the verified invite session can create a password", () => {
  assert.equal(
    hasVerifiedPasswordSetupSession({
      hasSession: true,
      isVerifying: false,
      linkKind: "token",
      verificationStatus: "complete",
    }),
    true,
  );
});

test("a direct create-password visit still returns a ready user home", () => {
  assert.equal(shouldRedirectReadyPasswordSetupUser(true, "none"), true);
  assert.equal(shouldRedirectReadyPasswordSetupUser(false, "none"), false);
});
