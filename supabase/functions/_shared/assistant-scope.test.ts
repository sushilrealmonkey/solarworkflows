import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSISTANT_SCOPE_MESSAGE,
  isTenantBusinessRequest,
} from "./assistant-scope.ts";

test("allows tenant business questions", () => {
  assert.equal(
    isTenantBusinessRequest([
      { role: "user", content: "Which invoices are overdue?" },
    ]),
    true,
  );
  assert.equal(
    isTenantBusinessRequest([
      { role: "user", content: "What needs my attention today?" },
    ]),
    true,
  );
});

test("allows short follow-ups only after business context", () => {
  assert.equal(
    isTenantBusinessRequest([
      { role: "user", content: "Show overdue quotations" },
      { role: "assistant", content: "Two quotations need attention." },
      { role: "user", content: "Show more" },
    ]),
    true,
  );
  assert.equal(
    isTenantBusinessRequest([{ role: "user", content: "Show more" }]),
    false,
  );
});

test("rejects external topics before a model call", () => {
  for (const content of [
    "What is the weather today?",
    "Search the web for solar industry news",
    "Write code for me",
    "Who won the election?",
  ]) {
    assert.equal(
      isTenantBusinessRequest([{ role: "user", content }]),
      false,
      content,
    );
  }
  assert.equal(ASSISTANT_SCOPE_MESSAGE.includes("business data"), true);
});
