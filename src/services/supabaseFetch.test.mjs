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

test("coalesces identical safe reads while returning an independent response body", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const [first, second] = await Promise.all([
      fetchWithJwtFutureRetry("https://example.test/rest/v1/projects?select=id", {
        headers: { Authorization: "Bearer test-token" },
      }),
      fetchWithJwtFutureRetry("https://example.test/rest/v1/projects?select=id", {
        headers: { Authorization: "Bearer test-token" },
      }),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(await first.json(), { ok: true });
    assert.deepEqual(await second.json(), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not coalesce writes", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 201 });
  };

  try {
    await Promise.all([
      fetchWithJwtFutureRetry("https://example.test/rest/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "One" }),
      }),
      fetchWithJwtFutureRetry("https://example.test/rest/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "One" }),
      }),
    ]);

    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caches a completed safe read briefly and clears it after a write", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ calls }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const url = "https://example.test/rest/v1/cache-test?select=id";
    const first = await fetchWithJwtFutureRetry(url, {
      headers: { Authorization: "Bearer cache-test-token" },
    });
    const second = await fetchWithJwtFutureRetry(url, {
      headers: { Authorization: "Bearer cache-test-token" },
    });

    assert.equal(calls, 1);
    assert.deepEqual(await first.json(), { calls: 1 });
    assert.deepEqual(await second.json(), { calls: 1 });

    await fetchWithJwtFutureRetry("https://example.test/rest/v1/cache-test", {
      method: "POST",
      body: JSON.stringify({ name: "Updated" }),
    });
    await fetchWithJwtFutureRetry(url, {
      headers: { Authorization: "Bearer cache-test-token" },
    });

    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
