import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoReminderParameters } from "./parameters.ts";
import { sendMetaTextTemplate } from "../_shared/meta-whatsapp.ts";

const reminder = {
  customer_name: "  Example Customer  ",
  booking_scheduled_for: "2026-09-07T08:30:00Z",
  meeting_timezone: "Asia/Kolkata",
};

test("both reminder payloads match the approved two-variable templates", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: any[] = [];
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    return Response.json({ messages: [{ id: "test-message" }] });
  };
  try {
    for (const templateName of ["reminder_60m", "reminder_10m"]) {
      const result = await sendMetaTextTemplate({
        accessToken: "test", graphVersion: "v23.0", phoneNumberId: "test",
        recipient: "+1 202 555 0100", templateName, languageCode: "en_US",
        parameters: buildDemoReminderParameters(reminder),
      });
      assert.equal(result.ok, true);
    }
    for (const payload of payloads) {
      assert.equal(payload.template.components.length, 1);
      const body = payload.template.components[0];
      assert.equal(body.type, "body");
      assert.equal(body.parameters.length, 2);
      assert.deepEqual(body.parameters[0], { type: "text", text: "Example" });
      assert.match(body.parameters[1].text, /2:00 pm/i);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("handles blank names and rejects invalid schedule inputs", () => {
  assert.equal(buildDemoReminderParameters({ ...reminder, customer_name: " " })[0], "there");
  assert.throws(() => buildDemoReminderParameters({ ...reminder, booking_scheduled_for: "invalid" }), /Booking time is invalid/);
  assert.throws(() => buildDemoReminderParameters({ ...reminder, meeting_timezone: "invalid" }), /Booking timezone is invalid/);
});
