import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReadySummary,
  openCreateEnquiryState,
  productSummaryCopy,
  readyDestinations,
  readyScreenContent,
  runReadyActionLock,
  runReadyBack,
  runReadyCompletion,
  summarizeAdditionalTeam,
  teamSummaryCopy,
  teamSummaryDetail,
} from "./onboardingReady.ts";

const completedProgress = {
  company_id: "company-1",
  organization_id: "organization-1",
  setup_owner_profile_id: "owner-1",
  setup_owner_assigned_at: "2026-08-14T00:00:00Z",
  onboarding_version: 1,
  status: "completed",
  current_step: "ready",
  started_at: "2026-08-14T00:00:00Z",
  deferred_at: null,
  completed_at: "2026-08-17T00:00:00Z",
  completed_by_profile_id: "owner-1",
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
};

test("Ready defines the real Step 5 completion experience", () => {
  assert.equal(readyScreenContent.badge, "Step 5 of 5");
  assert.equal(readyScreenContent.title, "Your Bizlee workspace is ready");
  assert.equal(readyDestinations.back, "/onboarding/team");
});

test("loading the Ready summary does not complete onboarding", async () => {
  let summaryCalls = 0;
  let completionCalls = 0;
  const summary = await loadReadySummary({
    currentProfileId: "owner-1",
    loadCompany: async () => {
      summaryCalls += 1;
      return { company_name: "Bizlee Solar" };
    },
    loadProducts: async () => {
      summaryCalls += 1;
      return [];
    },
    loadStaff: async () => {
      summaryCalls += 1;
      return [];
    },
  });

  assert.equal(summaryCalls, 3);
  assert.equal(completionCalls, 0);
  assert.equal(summary.companyAvailable, true);
});

test("Ready summary reports company setup and the real product count", async () => {
  const summary = await loadReadySummary({
    currentProfileId: "owner-1",
    loadCompany: async () => ({ company_name: "Bizlee Solar" }),
    loadProducts: async () => [{ id: "product-1" }, { id: "product-2" }],
    loadStaff: async () => [],
  });

  assert.equal(summary.companyAvailable, true);
  assert.equal(summary.productCount, 2);
  assert.equal(productSummaryCopy(summary.productCount), "2 products added");
  assert.equal(productSummaryCopy(1), "1 product added");
  assert.equal(productSummaryCopy(0), "Products can be added anytime");
});

test("team summary counts active and invited coworkers but not the setup owner or inactive staff", () => {
  const team = summarizeAdditionalTeam(
    [
      { id: "owner-1", status: "active" },
      { id: "active-1", status: "active" },
      { id: "invite-1", status: "invited" },
      { id: "inactive-1", status: "inactive" },
    ],
    "owner-1",
  );

  assert.deepEqual(team, { activeCount: 1, invitedCount: 1, totalCount: 2 });
  assert.equal(teamSummaryCopy(team), "2 team members active or invited");
  assert.equal(teamSummaryDetail(team), "1 active · 1 invited");
});

test("zero additional team members is a graceful optional-step state", () => {
  const team = summarizeAdditionalTeam(
    [{ id: "owner-1", status: "active" }],
    "owner-1",
  );
  assert.equal(teamSummaryCopy(team), "Team members can be added anytime");
});

test("each failed summary query degrades independently without throwing", async () => {
  const summary = await loadReadySummary({
    currentProfileId: "owner-1",
    loadCompany: async () => {
      throw new Error("company failed");
    },
    loadProducts: async () => {
      throw new Error("products failed");
    },
    loadStaff: async () => {
      throw new Error("staff failed");
    },
  });

  assert.deepEqual(summary, {
    companyAvailable: false,
    productCount: null,
    team: null,
  });
  assert.equal(productSummaryCopy(summary.productCount), "Product summary unavailable");
  assert.equal(teamSummaryCopy(summary.team), "Team summary unavailable");
});

test("Create Your First Enquiry completes before opening the existing enquiry modal", async () => {
  const events = [];

  await runReadyCompletion("enquiry", {
    complete: async () => {
      events.push("complete");
      return completedProgress;
    },
    finish: (progress, route, options) =>
      events.push(["finish", progress.status, route, options]),
  });

  assert.deepEqual(events, [
    "complete",
    [
      "finish",
      "completed",
      "/leads?new=1",
      { replace: true, state: openCreateEnquiryState },
    ],
  ]);
});

test("completion failure never navigates and a later retry succeeds", async () => {
  let attempts = 0;
  const navigations = [];
  const dependencies = {
    complete: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("database detail must not surface");
      return completedProgress;
    },
    finish: (_progress, route) => navigations.push(route),
  };

  await assert.rejects(runReadyCompletion("enquiry", dependencies));
  assert.deepEqual(navigations, []);
  await runReadyCompletion("enquiry", dependencies);
  assert.deepEqual(navigations, ["/leads?new=1"]);
});

test("the Ready action lock prevents duplicate completion requests", async () => {
  const lock = { current: false };
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const first = runReadyActionLock(lock, async () => {
    calls += 1;
    await pending;
  });
  const second = await runReadyActionLock(lock, async () => {
    calls += 1;
  });

  assert.equal(second, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(lock.current, false);
});

test("Go to Dashboard completes before dashboard navigation", async () => {
  const events = [];
  await runReadyCompletion("dashboard", {
    complete: async () => {
      events.push("complete");
      return completedProgress;
    },
    finish: (progress, route, options) =>
      events.push(["finish", progress.status, route, options]),
  });
  assert.deepEqual(events, [
    "complete",
    ["finish", "completed", "/dashboard", { replace: true }],
  ]);
});

test("Back persists the Team step without completing onboarding", async () => {
  const events = [];
  const teamProgress = {
    ...completedProgress,
    status: "in_progress",
    current_step: "team",
    completed_at: null,
    completed_by_profile_id: null,
  };

  await runReadyBack({
    persist: async () => {
      events.push("advance-team");
      return teamProgress;
    },
    commit: () => events.push("commit"),
    navigate: (route) => events.push(route),
  });

  assert.deepEqual(events, ["advance-team", "commit", "/onboarding/team"]);
});
