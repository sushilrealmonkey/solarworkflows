import assert from "node:assert/strict";
import test from "node:test";
import {
  companySetupFromSettings,
  isValidBusinessEmail,
  isValidGstin,
} from "./companySetup.ts";

const settings = {
  company_name: "Existing Solar",
  gst_number: "27ABCDE1234F1Z5",
  contact_phone: "+91 98765 43210",
  contact_email: "hello@example.com",
  address: "Existing address",
  company_logo_url: "https://example.com/logo.png",
};

test("company setup prefills persisted settings and the existing company state", () => {
  assert.deepEqual(
    companySetupFromSettings(settings, {
      companyName: "Workspace fallback",
      phone: "Fallback phone",
      email: "fallback@example.com",
      state: "Rajasthan",
    }),
    {
      company_name: "Existing Solar",
      gst_number: "27ABCDE1234F1Z5",
      contact_phone: "+91 98765 43210",
      contact_email: "hello@example.com",
      address: "Existing address",
      state: "Rajasthan",
      company_logo_url: "https://example.com/logo.png",
    },
  );
});

test("company setup uses signup fallbacks only when settings are blank", () => {
  const result = companySetupFromSettings(
    {
      ...settings,
      company_name: "",
      contact_phone: null,
      contact_email: "",
    },
    {
      companyName: "Workspace fallback",
      phone: "+91 90000 00000",
      email: "fallback@example.com",
      state: "Gujarat",
    },
  );

  assert.equal(result.company_name, "Workspace fallback");
  assert.equal(result.contact_phone, "+91 90000 00000");
  assert.equal(result.contact_email, "fallback@example.com");
});

test("GSTIN and optional business email validation accept normalized values", () => {
  assert.equal(isValidGstin("27abcde1234f1z5"), true);
  assert.equal(isValidGstin("not-a-gstin"), false);
  assert.equal(isValidBusinessEmail(" billing@example.com "), true);
  assert.equal(isValidBusinessEmail("billing@"), false);
});
