import assert from "node:assert/strict";
import test from "node:test";
import { renderTrialOutreachEmail } from "./trial-outreach-email.ts";

test("renders an escaped activation email with the first-value CTA", () => {
  const email = renderTrialOutreachEmail({
    touchpointKey: "trial_activation_quick_start",
    language: "en",
    firstName: "Asha <Admin>",
    companyName: "Solar & Co.",
    trialEndDate: "28 August 2026",
    nextStepUrl: "https://app.getbizlee.com/dashboard",
    supportPhone: "+91 90000 00000",
    progress: "0 leads; 0 workflows",
    blocker: null,
  });

  assert.match(email.subject, /first Bizlee result/i);
  assert.match(email.html, /Asha &lt;Admin&gt;/);
  assert.match(email.html, /Solar &amp; Co\./);
  assert.match(email.html, /https:\/\/app\.getbizlee\.com\/dashboard/);
  assert.doesNotMatch(email.html, /\{\{[^}]+\}\}/);
  assert.match(email.text, /0 leads; 0 workflows/);
});

test("renders the Hindi variant without exposing raw markup", () => {
  const email = renderTrialOutreachEmail({
    touchpointKey: "trial_activation_blocker_check",
    language: "hi",
    firstName: "Ravi",
    companyName: "Surya <EPC>",
    trialEndDate: "28 August 2026",
    nextStepUrl: "https://app.getbizlee.com/dashboard",
    supportPhone: "+91 90000 00000",
    progress: "पहला workflow बाकी है",
    blocker: "setup",
  });

  assert.match(email.html, /lang="hi"/);
  assert.match(email.html, /Surya &lt;EPC&gt;/);
  assert.doesNotMatch(email.html, /Surya <EPC>/);
});
