import { numberToInput } from "../quotations/quotationUtils";
import { requiredError } from "../crm/crmUtils";
import type {
  Payment,
  PaymentFormValues,
  PaymentMode,
  PaymentProjectOption,
  PaymentProjectSummary,
  PaymentSource,
  PaymentStatus,
} from "./types";

export const paymentSourceOptions: PaymentSource[] = [
  "customer_direct",
  "bank_loan",
];

export const paymentModeOptions: PaymentMode[] = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "loan_disbursement",
  "other",
];

export const paymentStatusOptions: PaymentStatus[] = [
  "received",
  "failed",
  "cancelled",
];

export function todayInput() {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

export function emptyPaymentForm(project?: PaymentProjectOption): PaymentFormValues {
  return {
    project_id: project?.id ?? "",
    customer_id: project?.customer_id ?? "",
    quotation_id: project?.quotation_id ?? "",
    proforma_invoice_id: "",
    invoice_id: "",
    b2b_sale_id: "",
    payment_source: "customer_direct",
    payment_mode: "bank_transfer",
    amount: "",
    payment_date: todayInput(),
    reference_number: "",
    bank_name: "",
    loan_account_number: "",
    receipt_url: "",
    notes: "",
    status: "received",
  };
}

export function paymentToForm(payment: Payment): PaymentFormValues {
  return {
    project_id: payment.project_id ?? "",
    customer_id: payment.customer_id ?? "",
    quotation_id: payment.quotation_id ?? "",
    proforma_invoice_id: payment.proforma_invoice_id ?? "",
    invoice_id: payment.invoice_id ?? "",
    b2b_sale_id: payment.b2b_sale_id ?? "",
    payment_source: payment.payment_source ?? "customer_direct",
    payment_mode: payment.payment_mode ?? "bank_transfer",
    amount: numberToInput(payment.amount),
    payment_date: payment.payment_date ?? todayInput(),
    reference_number: payment.reference_number ?? "",
    bank_name: payment.bank_name ?? "",
    loan_account_number: payment.loan_account_number ?? "",
    receipt_url: payment.receipt_url ?? "",
    notes: payment.notes ?? "",
    status: payment.status ?? "received",
  };
}

export function projectPaymentLabel(project: PaymentProjectOption) {
  return [
    project.project_code ?? "Project",
    project.project_name ?? project.customer?.full_name ?? "Customer",
  ].join(" - ");
}

export function paymentStatusTone(value: string | null | undefined) {
  if (value === "received" || value === "paid") {
    return "green" as const;
  }

  if (value === "failed" || value === "cancelled" || value === "overdue") {
    return "red" as const;
  }

  if (value === "partial") {
    return "blue" as const;
  }

  return "amber" as const;
}

export function sourceDefaultMode(source: PaymentSource) {
  return source === "bank_loan" ? "loan_disbursement" : "bank_transfer";
}

export function fallbackSummaryForProject(project: PaymentProjectOption): PaymentProjectSummary {
  const total = Number(project.quotation?.total_amount ?? 0);
  const subsidy = Number(project.quotation?.subsidy_amount ?? 0);
  const receivable = Math.max(total - subsidy, 0);

  return {
    id: `fallback-${project.id}`,
    organization_id: project.organization_id,
    project_id: project.id,
    quotation_id: project.quotation_id,
    customer_id: project.customer_id,
    total_project_amount: total,
    subsidy_amount: subsidy,
    company_receivable_amount: receivable,
    amount_received: 0,
    balance_due: receivable,
    payment_status: receivable <= 0 ? "paid" : "pending",
    created_at: null,
    updated_at: null,
  };
}

export function validatePaymentForm(values: PaymentFormValues) {
  const amount = Number(values.amount);

  return {
    project_id: requiredError(values.project_id, "Project"),
    amount:
      requiredError(values.amount, "Amount") ||
      (!Number.isFinite(amount) || amount < 0 ? "Amount must be 0 or more." : ""),
    payment_date: requiredError(values.payment_date, "Payment date"),
  };
}
