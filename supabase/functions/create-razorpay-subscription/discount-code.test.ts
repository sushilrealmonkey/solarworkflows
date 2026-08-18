import assert from "node:assert/strict";
import test from "node:test";
import { discountCodeMatches } from "./discount-code.ts";

test("matches codes without case or surrounding whitespace", () => {
  assert.equal(discountCodeMatches(" live-test-123 ", "LIVE-TEST-123"), true);
});

test("rejects absent, incomplete, and incorrect codes", () => {
  assert.equal(discountCodeMatches(undefined, "LIVE-TEST-123"), false);
  assert.equal(discountCodeMatches("LIVE-TEST", "LIVE-TEST-123"), false);
  assert.equal(discountCodeMatches("LIVE-TEST-124", "LIVE-TEST-123"), false);
});
