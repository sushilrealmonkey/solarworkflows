import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithJwtFutureRetry,
  isJwtIssuedAtFutureMessage,
} from "./supabaseFetch.ts";

test("replays a transient PostgREST JWT future response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;

    return calls === 1
      ? new Response(JSON.stringify({ code: "PGRST303" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithJwtFutureRetry("https://example.test");

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not classify unrelated authentication errors as clock skew", () => {
  assert.equal(isJwtIssuedAtFutureMessage("JWT expired"), false);
  assert.equal(isJwtIssuedAtFutureMessage("JWT issued at future"), true);
});
