import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseDailyTrialFallback,
  hasDailySummaryInsights,
  isActiveTrial,
  TRIAL_EMPTY_SUMMARY_MESSAGES,
} from "./daily-summary-fallback.ts";

test("uses fallbacks only when the operational snapshot has no insight", () => {
  assert.equal(
    hasDailySummaryInsights({
      overdue_followups: 0,
      overdue_invoices: 0,
      low_stock_items: 0,
      new_enquiries_today: 0,
    }),
    false,
  );
  assert.equal(
    hasDailySummaryInsights({
      overdue_followups: 1,
      overdue_invoices: 0,
      low_stock_items: 0,
      new_enquiries_today: 0,
    }),
    true,
  );
});

test("keeps fallback selection stable for a company and day", () => {
  const first = chooseDailyTrialFallback("company-1", "2026-09-03");
  const retry = chooseDailyTrialFallback("company-1", "2026-09-03");

  assert.deepEqual(first, retry);
  assert.ok(TRIAL_EMPTY_SUMMARY_MESSAGES.includes(first));
});

test("includes short Hinglish options in the trial fallback rotation", () => {
  assert.ok(
    TRIAL_EMPTY_SUMMARY_MESSAGES.some(
      ({ headline }) => headline === "Aaj se shuru karein",
    ),
  );
});

test("limits fallbacks to an unexpired trial", () => {
  const now = new Date("2026-09-03T04:30:00.000Z");

  assert.equal(
    isActiveTrial({ status: "trialing", trial_ends_at: "2026-09-04T04:30:00.000Z" }, now),
    true,
  );
  assert.equal(
    isActiveTrial({ status: "trialing", trial_ends_at: "2026-09-03T04:30:00.000Z" }, now),
    false,
  );
  assert.equal(
    isActiveTrial({ status: "active", trial_ends_at: "2026-09-04T04:30:00.000Z" }, now),
    false,
  );
});
