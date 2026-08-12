import assert from "node:assert/strict";
import test from "node:test";
import { parseWhatsAppOtp } from "./payload.ts";

test("uses sms.phone when an email user adds their first phone number", () => {
  assert.deepEqual(
    parseWhatsAppOtp({
      user: {
        phone: "",
        new_phone: "+91 98765 43210",
      },
      sms: {
        otp: "123456",
        phone: "+91 98765 43210",
      },
    }),
    { mobile: "919876543210", otp: "123456" },
  );
});

test("keeps compatibility with the user phone field", () => {
  assert.deepEqual(
    parseWhatsAppOtp({
      user: { phone: "+919876543210" },
      sms: { otp: 654321 },
    }),
    { mobile: "919876543210", otp: "654321" },
  );
});

test("rejects a malformed phone or OTP", () => {
  assert.equal(
    parseWhatsAppOtp({
      sms: { phone: "+919876543210", otp: "12345" },
    }),
    null,
  );
  assert.equal(
    parseWhatsAppOtp({
      sms: { phone: "+911234567890", otp: "123456" },
    }),
    null,
  );
});
