import assert from "node:assert/strict";
import test from "node:test";
import {
  gstInclusiveAmount,
  isGstInvoice,
  splitInclusiveGst,
} from "./invoice.ts";

test("splits GST-inclusive Core payment into ₹899 taxable value and GST", () => {
  assert.deepEqual(splitInclusiveGst(106082), {
    grossAmountPaise: 106082,
    taxableAmountPaise: 89900,
    gstAmountPaise: 16182,
  });
});

test("splits GST-inclusive Pro payment into ₹1499 taxable value and GST", () => {
  assert.deepEqual(splitInclusiveGst(176882), {
    grossAmountPaise: 176882,
    taxableAmountPaise: 149900,
    gstAmountPaise: 26982,
  });
});

test("rounds GST-inclusive Razorpay plan amount to whole paise", () => {
  assert.equal(gstInclusiveAmount(89900), 106082);
  assert.equal(gstInclusiveAmount(149900), 176882);
});

test("accepts a Razorpay invoice only when it is GST-compliant and paid-link backed", () => {
  assert.equal(
    isGstInvoice({
      invoice_number: "RZP-001",
      short_url: "https://rzp.io/i/example",
      gross_amount: 106082,
      taxable_amount: 89900,
      tax_amount: 16182,
      line_items: [{ tax_rate: 18 }],
    }),
    true,
  );
  assert.equal(
    isGstInvoice({
      short_url: "https://rzp.io/i/example",
      gross_amount: 106082,
      taxable_amount: 106082,
      tax_amount: 0,
      line_items: [{ tax_rate: null }],
    }),
    false,
  );
});
