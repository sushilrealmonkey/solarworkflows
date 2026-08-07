import assert from "node:assert/strict";
import test from "node:test";
import { handleMobileApiRequest, isMobileApiPath } from "./handler.js";

test("recognizes only versioned mobile API paths", () => {
  assert.equal(isMobileApiPath("/api/mobile/v1"), true);
  assert.equal(isMobileApiPath("/api/mobile/v1/customers"), true);
  assert.equal(isMobileApiPath("/api/mobile/v10/customers"), false);
});

test("returns a stable authentication error with request correlation", async () => {
  const response = await handleMobileApiRequest(new Request("http://localhost/api/mobile/v1/session/context", { headers: { "x-request-id": "mobile-test-request" } }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-request-id"), "mobile-test-request");
  assert.deepEqual(await response.json(), { error: { code: "AUTH_REQUIRED", message: "Authentication is required", requestId: "mobile-test-request" } });
});
