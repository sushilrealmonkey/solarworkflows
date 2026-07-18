import { numberToInput } from "../quotations/quotationUtils";
import {
  defaultDueDateInput,
  emptyInvoiceForm,
  emptyInvoiceItemForm,
  invoiceItemToForm,
  todayInput,
  validateInvoiceForm,
} from "../invoices/invoiceUtils";
import type {
  ProformaInvoice,
  ProformaInvoiceFormValues,
  ProformaInvoiceItem,
  ProformaInvoiceStatus,
  ProformaInvoiceWithRelations,
  ProformaPaymentFormValues,
} from "./types";

export const proformaInvoiceStatusOptions: ProformaInvoiceStatus[] = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "converted",
  "cancelled",
];

export const proformaPaymentModeOptions = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "loan_disbursement",
  "other",
];

export const proformaPaymentStatusOptions = [
  "received",
  "failed",
  "cancelled",
];

export function emptyProformaInvoiceForm(): ProformaInvoiceFormValues {
  return emptyInvoiceForm(null, "manual");
}

export function proformaInvoiceToForm(
  proformaInvoice: ProformaInvoice,
): ProformaInvoiceFormValues {
  return {
    creation_mode: proformaInvoice.project_id ? "project" : "manual",
    proforma_invoice_id: "",
    customer_id: proformaInvoice.customer_id ?? "",
    project_id: proformaInvoice.project_id ?? "",
    quotation_id: proformaInvoice.quotation_id ?? "",
    invoice_date: proformaInvoice.proforma_date ?? todayInput(),
    due_date: proformaInvoice.due_date ?? defaultDueDateInput(),
    discount_amount: numberToInput(proformaInvoice.discount_amount),
    notes: proformaInvoice.notes ?? "",
    items: [],
  };
}

export function proformaInvoiceItemToForm(item: ProformaInvoiceItem) {
  return invoiceItemToForm({
    ...item,
    invoice_id: item.proforma_invoice_id,
  });
}

export function proformaInvoiceContextLabel(
  proformaInvoice: ProformaInvoiceWithRelations,
) {
  if (proformaInvoice.project_id) {
    return (
      proformaInvoice.project?.project_code ??
      proformaInvoice.project?.project_name ??
      "Project proforma"
    );
  }

  if (proformaInvoice.b2b_sale_id) {
    return proformaInvoice.b2b_sale?.sale_code ?? "B2B sale proforma";
  }

  return "Manual proforma";
}

export function proformaInvoiceContextDescription(
  proformaInvoice: ProformaInvoiceWithRelations,
) {
  const customerName =
    proformaInvoice.customer?.business_name ||
    proformaInvoice.customer?.full_name ||
    "Customer";

  return `${customerName} / ${proformaInvoiceContextLabel(proformaInvoice)}`;
}

export function proformaInvoiceStatusTone(value: string | null | undefined) {
  if (value === "paid" || value === "converted") {
    return "green" as const;
  }

  if (value === "cancelled") {
    return "red" as const;
  }

  if (value === "sent" || value === "partially_paid") {
    return "blue" as const;
  }

  return "neutral" as const;
}

export function validateProformaInvoiceForm(values: ProformaInvoiceFormValues) {
  return validateInvoiceForm(values, {
    includeItems: true,
    requireProject: values.creation_mode === "project",
  });
}

export function emptyProformaPaymentForm(): ProformaPaymentFormValues {
  return {
    amount: "",
    payment_date: todayInput(),
    payment_mode: "bank_transfer",
    reference_number: "",
    bank_name: "",
    notes: "",
    status: "received",
  };
}

export function validateProformaPaymentForm(values: ProformaPaymentFormValues) {
  const amount = Number(values.amount);

  return {
    amount:
      !values.amount.trim()
        ? "Amount is required."
        : !Number.isFinite(amount) || amount <= 0
          ? "Amount must be greater than 0."
          : "",
    payment_date: values.payment_date.trim() ? "" : "Payment date is required.",
  };
}

export function canCreateFinalInvoice(
  proformaInvoice: ProformaInvoiceWithRelations,
) {
  return (
    proformaInvoice.status === "paid" &&
    !proformaInvoice.final_invoice_id
  );
}

export { emptyInvoiceItemForm };
