import assert from "node:assert/strict";
import test from "node:test";
import { renderTrialWelcomeEmail } from "./trial-welcome-email.ts";

test("renders the branded trial welcome with escaped tenant data", () => {
  const email = renderTrialWelcomeEmail({
    userName: 'Asha <Admin>',
    trialEndDate: "28 August 2026",
    workspaceUrl: "https://app.getbizlee.com/",
    supportEmail: "TEAM@GetBizlee.com",
  });

  assert.equal(email.subject, "Welcome to Bizlee — your trial is ready");
  assert.match(email.html, /Asha &lt;Admin&gt;/);
  assert.doesNotMatch(email.html, /Asha <Admin>/);
  assert.match(email.html, /https:\/\/app\.getbizlee\.com\/bizlee-logo\.png/);
  assert.match(email.html, /TEAM@GetBizlee\.com/i);
  assert.match(email.text, /Open Bizlee: https:\/\/app\.getbizlee\.com/);
  assert.doesNotMatch(email.html, /\{\{[a-z_]+\}\}/);
});

test("rejects non-http workspace links", () => {
  assert.throws(
    () =>
      renderTrialWelcomeEmail({
        userName: null,
        trialEndDate: "soon",
        workspaceUrl: "javascript:alert(1)",
      }),
    /http or https/,
  );
});

test("omits an invalid support address", () => {
  const email = renderTrialWelcomeEmail({
    userName: null,
    trialEndDate: "soon",
    workspaceUrl: "https://app.getbizlee.com",
    supportEmail: "not-an-email",
  });

  assert.doesNotMatch(email.html, /mailto:/);
  assert.match(email.text, /Reply to this email/);
});
