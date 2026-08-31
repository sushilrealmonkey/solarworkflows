import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithJwtFutureRetry,
  isJwtIssuedAtFutureMessage,
  registerSupabaseSessionRefresh,
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

test("refreshes the session and uses the new token on replay", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let calls = 0;

  registerSupabaseSessionRefresh(async () => "refreshed-access-token");
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    requests.push(headers.get("Authorization"));
    calls += 1;

    return calls === 1
      ? new Response(JSON.stringify({ code: "PGRST303" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithJwtFutureRetry("https://example.test", {
      headers: { Authorization: "Bearer old-access-token" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(requests, ["Bearer old-access-token", "Bearer refreshed-access-token"]);
  } finally {
    registerSupabaseSessionRefresh(null);
    globalThis.fetch = originalFetch;
  }
});

test("does not classify unrelated authentication errors as clock skew", () => {
  assert.equal(isJwtIssuedAtFutureMessage("JWT expired"), false);
  assert.equal(isJwtIssuedAtFutureMessage("JWT issued at future"), true);
});
