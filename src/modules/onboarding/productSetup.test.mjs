import assert from "node:assert/strict";
import test from "node:test";
import {
  productSetupOptions,
  runProductSetupTransition,
  transitionForProductSetupAction,
} from "./productSetup.ts";

const progress = {
  company_id: "company-1",
  organization_id: "organization-1",
  setup_owner_profile_id: "owner-1",
  setup_owner_assigned_at: "2026-08-14T00:00:00Z",
  onboarding_version: 1,
  status: "in_progress",
  current_step: "products",
  started_at: "2026-08-14T00:00:00Z",
  deferred_at: null,
  completed_at: null,
  completed_by_profile_id: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

test("product setup exposes all three user-visible choices", () => {
  assert.deepEqual(
    productSetupOptions.map(({ title, cta }) => ({ title, cta })),
    [
      { title: "Add Products", cta: "Add Products" },
      { title: "Import Products", cta: "Import Products" },
      { title: "Do It Later", cta: "Skip for Now" },
    ],
  );
});

test("Add Products persists product entry before navigating", async () => {
  assert.deepEqual(await runTransition("add"), [
    "persist:product_entry",
    "commit:product_entry",
    "navigate:/onboarding/products/add",
  ]);
});

test("Import Products persists the products phase before navigating", async () => {
  assert.deepEqual(await runTransition("import"), [
    "persist:products",
    "commit:products",
    "navigate:/onboarding/products/import",
  ]);
});

test("Skip for Now persists Team Setup before navigating", async () => {
  assert.deepEqual(await runTransition("skip"), [
    "persist:team",
    "commit:team",
    "navigate:/onboarding/team",
  ]);
});

test("a persistence failure prevents state commit and navigation", async () => {
  const events = [];

  await assert.rejects(
    runProductSetupTransition("add", {
      persist: async () => {
        events.push("persist");
        throw new Error("Unable to save choice");
      },
      commit: () => events.push("commit"),
      navigate: () => events.push("navigate"),
    }),
    /Unable to save choice/,
  );

  assert.deepEqual(events, ["persist"]);
});

test("Back returns to Company Setup without changing company data", () => {
  assert.deepEqual(transitionForProductSetupAction("back"), {
    nextStep: "company",
    route: "/onboarding/company",
  });
});

async function runTransition(action) {
  const events = [];

  await runProductSetupTransition(action, {
    persist: async (nextStep) => {
      events.push(`persist:${nextStep}`);
      return { ...progress, current_step: nextStep };
    },
    commit: (nextProgress) => events.push(`commit:${nextProgress.current_step}`),
    navigate: (route) => events.push(`navigate:${route}`),
  });

  return events;
}
