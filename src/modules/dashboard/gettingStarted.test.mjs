import assert from "node:assert/strict";
import test from "node:test";
import {
  gettingStartedDestinations,
  hasAdditionalActiveOrInvitedTeamMember,
  isCompanySetupComplete,
  loadGettingStartedState,
  openGettingStartedEnquiryState,
  shouldShowGettingStarted,
} from "./gettingStarted.ts";
import { resolveTenantOnboardingDestination } from "../onboarding/onboardingRouting.ts";

function dependencies(overrides = {}) {
  return {
    loadCompany: async () => ({ company_name: "Bizlee Solar" }),
    loadProducts: async () => [{ id: "product-1" }],
    loadTeam: async () => ({
      setupOwnerProfileId: "owner-1",
      staff: [
        { id: "owner-1", status: "active" },
        { id: "staff-1", status: "active" },
      ],
    }),
    loadEnquiries: async () => [{ id: "enquiry-1" }],
    ...overrides,
  };
}

test("checklist renders for incomplete tasks and calculates real progress", async () => {
  const state = await loadGettingStartedState(
    dependencies({ loadProducts: async () => [], loadEnquiries: async () => [] }),
  );

  assert.equal(state.completedCount, 2);
  assert.equal(shouldShowGettingStarted(state), true);
  assert.deepEqual(
    state.tasks.map(({ key, status }) => [key, status]),
    [
      ["company", "complete"],
      ["products", "incomplete"],
      ["team", "complete"],
      ["enquiry", "incomplete"],
    ],
  );
});

test("company completion matches the onboarding minimum and ignores optional fields", () => {
  assert.equal(isCompanySetupComplete({ company_name: "Bizlee Solar" }), true);
  assert.equal(isCompanySetupComplete({ company_name: "   " }), false);
  assert.equal(isCompanySetupComplete({ company_name: null }), false);
});

test("product completion derives from any Product Master record", async () => {
  const incomplete = await loadGettingStartedState(
    dependencies({ loadProducts: async () => [] }),
  );
  const complete = await loadGettingStartedState(dependencies());

  assert.equal(incomplete.tasks[1].status, "incomplete");
  assert.equal(complete.tasks[1].status, "complete");
});

test("team completion excludes the setup owner and inactive staff", () => {
  assert.equal(
    hasAdditionalActiveOrInvitedTeamMember({
      setupOwnerProfileId: "owner-1",
      staff: [
        { id: "owner-1", status: "active" },
        { id: "inactive-1", status: "inactive" },
      ],
    }),
    false,
  );
  assert.equal(
    hasAdditionalActiveOrInvitedTeamMember({
      setupOwnerProfileId: "owner-1",
      staff: [
        { id: "owner-1", status: "active" },
        { id: "invite-1", status: "invited" },
      ],
    }),
    true,
  );
});

test("enquiry completion derives from existing enquiries", async () => {
  const state = await loadGettingStartedState(
    dependencies({ loadEnquiries: async () => [] }),
  );
  assert.equal(state.tasks[3].status, "incomplete");
});

test("completed onboarding cannot override skipped products, team, or enquiry", async () => {
  const completedOnboarding = {
    status: "completed",
    current_step: "ready",
    setup_owner_profile_id: "owner-1",
  };
  const state = await loadGettingStartedState(
    dependencies({
      loadProducts: async () => [],
      loadTeam: async () => ({
        setupOwnerProfileId: completedOnboarding.setup_owner_profile_id,
        staff: [{ id: "owner-1", status: "active" }],
      }),
      loadEnquiries: async () => [],
    }),
  );

  assert.deepEqual(
    state.tasks.map((task) => task.status),
    ["complete", "incomplete", "incomplete", "incomplete"],
  );
});

test("Welcome defer reaches a usable dashboard with the activation checklist", async () => {
  const deferredProgress = {
    company_id: "company-1",
    organization_id: "organization-1",
    setup_owner_profile_id: "owner-1",
    setup_owner_assigned_at: "2026-08-14T00:00:00Z",
    onboarding_version: 1,
    status: "deferred",
    current_step: "welcome",
    started_at: null,
    deferred_at: "2026-08-17T00:00:00Z",
    completed_at: null,
    completed_by_profile_id: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
  };

  assert.equal(
    resolveTenantOnboardingDestination({
      bypassOnboarding: false,
      homePath: "/dashboard",
      isSetupOwner: true,
      pathname: "/dashboard",
      progress: deferredProgress,
    }),
    null,
  );

  const state = await loadGettingStartedState(
    dependencies({
      loadProducts: async () => [],
      loadTeam: async () => ({
        setupOwnerProfileId: "owner-1",
        staff: [{ id: "owner-1", status: "active" }],
      }),
      loadEnquiries: async () => [],
    }),
  );
  assert.equal(shouldShowGettingStarted(state), true);
});

test("actions reuse the normal settings, Product Master, and enquiry flows", () => {
  assert.deepEqual(gettingStartedDestinations, {
    company: "/settings#company-profile",
    products: "/products-materials/products",
    team: "/settings#staff-management",
    enquiry: "/leads",
  });
  assert.deepEqual(openGettingStartedEnquiryState, { openCreateEnquiry: true });
});

test("individual data failure stays unknown without breaking other progress", async () => {
  const state = await loadGettingStartedState(
    dependencies({
      loadProducts: async () => {
        throw new Error("products unavailable");
      },
    }),
  );

  assert.equal(state.completedCount, 3);
  assert.equal(state.hasUnknown, true);
  assert.equal(state.tasks[1].status, "unknown");
  assert.equal(shouldShowGettingStarted(state), true);
});

test("four confirmed tasks remove the activation card", async () => {
  const state = await loadGettingStartedState(dependencies());
  assert.equal(state.completedCount, 4);
  assert.equal(state.hasUnknown, false);
  assert.equal(shouldShowGettingStarted(state), false);
});
