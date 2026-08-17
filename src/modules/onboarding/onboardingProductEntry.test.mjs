import assert from "node:assert/strict";
import test from "node:test";
import {
  appendOnboardingProductDraft,
  createOnboardingProductDraft,
  removeOnboardingProductDraft,
  runProductEntryTransition,
  runWithSubmissionLock,
  saveOnboardingProductDrafts,
} from "./onboardingProductEntry.ts";

const panelCategory = {
  id: "category-panel",
  tenant_id: "organization-1",
  name: "Solar Panels",
  category_type: "SOLAR_PANEL",
  display_order: 1,
  description: null,
  is_active: true,
  created_at: null,
  updated_at: null,
};

const inverterCategory = {
  ...panelCategory,
  id: "category-inverter",
  name: "Inverters",
  category_type: "INVERTER",
  display_order: 2,
};

const categories = [panelCategory, inverterCategory];

const progress = {
  company_id: "company-1",
  organization_id: "organization-1",
  setup_owner_profile_id: "owner-1",
  setup_owner_assigned_at: "2026-08-14T00:00:00Z",
  onboarding_version: 1,
  status: "in_progress",
  current_step: "product_entry",
  started_at: "2026-08-14T00:00:00Z",
  deferred_at: null,
  completed_at: null,
  completed_by_profile_id: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

test("product entry starts with one blank product row", () => {
  const rows = [createOnboardingProductDraft("row-1")];

  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.category_id, "");
  assert.equal(rows[0].values.model_number, "");
  assert.equal(rows[0].values.unit, "piece");
});

test("Add Another Product appends an independent draft row", () => {
  const first = createOnboardingProductDraft("row-1");
  const second = createOnboardingProductDraft("row-2");

  const rows = appendOnboardingProductDraft([first], second);

  assert.deepEqual(rows.map((row) => row.id), ["row-1", "row-2"]);
});

test("removing rows keeps one blank row when the final draft is removed", () => {
  const replacement = createOnboardingProductDraft("replacement");

  assert.deepEqual(
    removeOnboardingProductDraft(
      [createOnboardingProductDraft("row-1")],
      "row-1",
      replacement,
    ).map((row) => row.id),
    ["replacement"],
  );
});

test("completely empty rows are ignored during save", async () => {
  let createCalls = 0;

  const result = await saveOnboardingProductDrafts(
    [createOnboardingProductDraft("row-1")],
    categories,
    async () => {
      createCalls += 1;
      return { id: "unexpected" };
    },
  );

  assert.equal(createCalls, 0);
  assert.equal(result.attemptedCount, 0);
  assert.equal(result.allSaved, true);
});

test("invalid populated rows are blocked before any create call", async () => {
  const invalid = populatedRow("row-1", {
    category_id: "",
    model_number: "WS-550",
  });
  let createCalls = 0;

  const result = await saveOnboardingProductDrafts(
    [invalid],
    categories,
    async () => {
      createCalls += 1;
      return { id: "unexpected" };
    },
  );

  assert.equal(result.validationBlocked, true);
  assert.equal(result.rows[0].errors.category_id, "Category is required.");
  assert.equal(createCalls, 0);
});

test("valid drafts use the existing Product Master field contract", async () => {
  const submitted = [];
  const row = populatedRow("row-1", {
    category_id: panelCategory.id,
    brand: "Waaree",
    model_number: "WS-550",
    specifications: "550W Mono PERC",
    unit: "piece",
  });

  const result = await saveOnboardingProductDrafts(
    [row],
    categories,
    async (values) => {
      submitted.push(values);
      return { id: "product-1" };
    },
  );

  assert.equal(result.allSaved, true);
  assert.equal(result.rows[0].createdProductId, "product-1");
  assert.deepEqual(
    {
      category_id: submitted[0].category_id,
      brand: submitted[0].brand,
      model_number: submitted[0].model_number,
      specifications: submitted[0].specifications,
      unit: submitted[0].unit,
      product_name: submitted[0].product_name,
      gst_percent: submitted[0].gst_percent,
      status: submitted[0].status,
    },
    {
      category_id: panelCategory.id,
      brand: "Waaree",
      model_number: "WS-550",
      specifications: "550W Mono PERC",
      unit: "piece",
      product_name: "Waaree Solar Panels WS-550 550W Mono PERC",
      gst_percent: "0",
      status: "active",
    },
  );
});

test("multiple valid products are created sequentially", async () => {
  const submittedModels = [];
  let activeCreates = 0;
  let maximumConcurrentCreates = 0;
  const rows = [
    populatedRow("row-1", {
      category_id: panelCategory.id,
      model_number: "WS-550",
    }),
    populatedRow("row-2", {
      category_id: inverterCategory.id,
      model_number: "SG5.0RS",
    }),
  ];

  const result = await saveOnboardingProductDrafts(
    rows,
    categories,
    async (values) => {
      activeCreates += 1;
      maximumConcurrentCreates = Math.max(maximumConcurrentCreates, activeCreates);
      submittedModels.push(values.model_number);
      await Promise.resolve();
      activeCreates -= 1;
      return { id: `product-${submittedModels.length}` };
    },
  );

  assert.deepEqual(submittedModels, ["WS-550", "SG5.0RS"]);
  assert.equal(maximumConcurrentCreates, 1);
  assert.equal(result.savedCount, 2);
  assert.equal(result.allSaved, true);
});

test("the submission lock rejects a duplicate in-flight submit", async () => {
  const lock = { current: false };
  let release;
  let taskCalls = 0;
  const first = runWithSubmissionLock(lock, async () => {
    taskCalls += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    return "saved";
  });

  const duplicate = await runWithSubmissionLock(lock, async () => {
    taskCalls += 1;
    return "duplicate";
  });

  assert.deepEqual(duplicate, { started: false });
  assert.equal(taskCalls, 1);
  release();
  assert.deepEqual(await first, { started: true, value: "saved" });
});

test("retry after partial failure never recreates successful rows", async () => {
  const calls = [];
  const rows = [
    populatedRow("row-1", {
      category_id: panelCategory.id,
      model_number: "WS-550",
    }),
    populatedRow("row-2", {
      category_id: inverterCategory.id,
      model_number: "SG5.0RS",
    }),
  ];

  const firstAttempt = await saveOnboardingProductDrafts(
    rows,
    categories,
    async (values) => {
      calls.push(values.model_number);
      if (values.model_number === "SG5.0RS") throw new Error("Network error");
      return { id: "product-panel" };
    },
  );

  assert.deepEqual(firstAttempt.rows.map((row) => row.status), ["saved", "error"]);
  assert.equal(firstAttempt.rows[1].error, "Network error");

  const retry = await saveOnboardingProductDrafts(
    firstAttempt.rows,
    categories,
    async (values) => {
      calls.push(values.model_number);
      return { id: "product-inverter" };
    },
  );

  assert.deepEqual(calls, ["WS-550", "SG5.0RS", "SG5.0RS"]);
  assert.equal(retry.attemptedCount, 1);
  assert.equal(retry.allSaved, true);
});

test("successful save advances onboarding to Team after persistence", async () => {
  assert.deepEqual(await runTransition("complete"), [
    "persist:team",
    "commit:team",
    "navigate:/onboarding/team",
  ]);
});

test("Skip creates no product and advances onboarding to Team", async () => {
  let createCalls = 0;
  const events = await runTransition("skip");

  assert.equal(createCalls, 0);
  assert.deepEqual(events, [
    "persist:team",
    "commit:team",
    "navigate:/onboarding/team",
  ]);
});

test("Back returns to Product Setup Choice without creating products", async () => {
  assert.deepEqual(await runTransition("back"), [
    "persist:products",
    "commit:products",
    "navigate:/onboarding/products",
  ]);
});

function populatedRow(id, overrides) {
  const row = createOnboardingProductDraft(id);
  return { ...row, values: { ...row.values, ...overrides } };
}

async function runTransition(action) {
  const events = [];

  await runProductEntryTransition(action, {
    persist: async (nextStep) => {
      events.push(`persist:${nextStep}`);
      return { ...progress, current_step: nextStep };
    },
    commit: (nextProgress) => events.push(`commit:${nextProgress.current_step}`),
    navigate: (route) => events.push(`navigate:${route}`),
  });

  return events;
}
