import assert from "node:assert/strict";
import test from "node:test";
import { resolveTenantOnboardingDestination } from "./onboardingRouting.ts";

const baseProgress = {
  company_id: "company-1",
  organization_id: "organization-1",
  setup_owner_profile_id: "owner-1",
  setup_owner_assigned_at: "2026-08-14T00:00:00Z",
  onboarding_version: 1,
  status: "pending",
  current_step: "welcome",
  started_at: null,
  deferred_at: null,
  completed_at: null,
  completed_by_profile_id: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

function destination(overrides = {}) {
  return resolveTenantOnboardingDestination({
    bypassOnboarding: false,
    homePath: "/dashboard",
    isSetupOwner: true,
    pathname: "/dashboard",
    progress: baseProgress,
    ...overrides,
  });
}

test("pending setup owner is forced to Welcome without a dashboard flash", () => {
  assert.equal(destination(), "/onboarding");
  assert.equal(destination({ pathname: "/onboarding" }), null);
});

test("in-progress setup owner resumes the stored company step", () => {
  const progress = { ...baseProgress, status: "in_progress", current_step: "company" };
  assert.equal(destination({ progress }), "/onboarding/company");
  assert.equal(destination({ pathname: "/onboarding/company", progress }), null);
});

test("deferred setup does not reopen automatically but explicit access resumes", () => {
  const progress = { ...baseProgress, status: "deferred", current_step: "welcome" };
  assert.equal(destination({ progress }), null);
  assert.equal(destination({ pathname: "/onboarding", progress }), null);
  assert.equal(destination({ pathname: "/workspace-setup", progress }), "/onboarding");
});

test("completed, invited, backend, and super-admin paths stay out of onboarding", () => {
  const completed = { ...baseProgress, status: "completed", current_step: "ready" };
  assert.equal(destination({ pathname: "/onboarding", progress: completed }), "/dashboard");
  assert.equal(destination({ isSetupOwner: false }), null);
  assert.equal(destination({ isSetupOwner: false, pathname: "/onboarding" }), "/dashboard");
  assert.equal(destination({ bypassOnboarding: true }), null);
  assert.equal(destination({ bypassOnboarding: true, pathname: "/onboarding" }), "/dashboard");
});

test("an active tenant cannot accidentally re-enter workspace creation", () => {
  assert.equal(destination({ pathname: "/workspace-setup" }), "/onboarding");
  assert.equal(
    destination({
      pathname: "/workspace-setup",
      progress: { ...baseProgress, status: "completed", current_step: "ready" },
    }),
    "/dashboard",
  );
});
