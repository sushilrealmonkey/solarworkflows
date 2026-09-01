export const SUBSCRIPTION_GST_RATE = 18;

export type InclusiveGstBreakdown = {
  grossAmountPaise: number;
  taxableAmountPaise: number;
  gstAmountPaise: number;
};

export function splitInclusiveGst(
  grossAmountPaise: number,
  gstRate = SUBSCRIPTION_GST_RATE,
): InclusiveGstBreakdown {
  if (
    !Number.isInteger(grossAmountPaise) ||
    grossAmountPaise <= 0 ||
    !Number.isFinite(gstRate) ||
    gstRate < 0
  ) {
    throw new Error("A positive integer gross amount and valid GST rate are required");
  }

  const taxableAmountPaise = Math.round(
    (grossAmountPaise * 100) / (100 + gstRate),
  );

  return {
    grossAmountPaise,
    taxableAmountPaise,
    gstAmountPaise: grossAmountPaise - taxableAmountPaise,
  };
}

export function gstInclusiveAmount(
  taxableAmountPaise: number,
  gstRate = SUBSCRIPTION_GST_RATE,
) {
  if (!Number.isInteger(taxableAmountPaise) || taxableAmountPaise <= 0) {
    throw new Error("A positive integer taxable amount is required");
  }

  return Math.round(taxableAmountPaise * (100 + gstRate) / 100);
}
