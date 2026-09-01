import { SUBSCRIPTION_GST_RATE } from "../_shared/subscription-gst.ts";

export {
  gstInclusiveAmount,
  splitInclusiveGst,
  SUBSCRIPTION_GST_RATE,
  type InclusiveGstBreakdown,
} from "../_shared/subscription-gst.ts";

export type RazorpayInvoiceItem = {
  tax_rate?: number | string | null;
  tax_amount?: number | null;
  taxable_amount?: number | null;
  sac_code?: string | number | null;
};

export type RazorpayInvoice = {
  id?: string;
  invoice_number?: string | null;
  short_url?: string | null;
  status?: string | null;
  gross_amount?: number | null;
  taxable_amount?: number | null;
  tax_amount?: number | null;
  amount_paid?: number | null;
  payment_id?: string | null;
  subscription_id?: string | null;
  issued_at?: number | null;
  paid_at?: number | null;
  date?: number | null;
  line_items?: RazorpayInvoiceItem[] | null;
  customer_details?: {
    name?: string | null;
    email?: string | null;
    contact?: string | null;
    gstin?: string | null;
    billing_address?: Record<string, unknown> | null;
  } | null;
};

export function isGstInvoice(
  invoice: RazorpayInvoice | null | undefined,
  expectedRate = SUBSCRIPTION_GST_RATE,
) {
  if (!invoice || !isHttpUrl(invoice.short_url)) return false;

  const taxAmount = numberOrNull(invoice.tax_amount);
  const taxableAmount = numberOrNull(invoice.taxable_amount);
  const grossAmount = numberOrNull(invoice.gross_amount);
  if (
    taxAmount === null ||
    taxableAmount === null ||
    grossAmount === null ||
    taxAmount <= 0 ||
    taxableAmount <= 0 ||
    taxableAmount + taxAmount !== grossAmount
  ) {
    return false;
  }

  return (invoice.line_items ?? []).some((item) => {
    const taxRate = Number(item.tax_rate);
    return Number.isFinite(taxRate) && taxRate === expectedRate;
  });
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
