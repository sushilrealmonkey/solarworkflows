import { requiredError } from "../crm/crmUtils";
import { numberToInput } from "../quotations/quotationUtils";
import type {
  Invoice,
  InvoiceCreationMode,
  InvoiceFormValues,
  InvoiceItem,
  InvoiceItemFormValues,
  InvoiceProjectOption,
  InvoiceStatus,
  InvoiceWithRelations,
} from "./types";

export const invoiceStatusOptions: InvoiceStatus[] = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

export function todayInput() {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

export function defaultDueDateInput() {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 15);
  const offsetDate = new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

export function emptyInvoiceItemForm(): InvoiceItemFormValues {
  return {
    item_name: "",
    description: "",
    quantity: "1",
    unit: "",
    unit_price: "",
    gst_percent: "0",
  };
}

export function emptyInvoiceForm(
  project?: InvoiceProjectOption | null,
  creationMode: InvoiceCreationMode = "project",
): InvoiceFormValues {
  return {
    creation_mode: project ? "project" : creationMode,
    customer_id: project?.customer_id ?? "",
    project_id: project?.id ?? "",
    quotation_id: project?.quotation_id ?? "",
    invoice_date: todayInput(),
    due_date: defaultDueDateInput(),
    discount_amount: numberToInput(project?.quotation?.discount_amount),
    notes: "",
    items: [emptyInvoiceItemForm()],
  };
}

export function invoiceToForm(invoice: Invoice): InvoiceFormValues {
  return {
    creation_mode: invoice.project_id ? "project" : "manual",
    customer_id: invoice.customer_id ?? "",
    project_id: invoice.project_id ?? "",
    quotation_id: invoice.quotation_id ?? "",
    invoice_date: invoice.invoice_date ?? todayInput(),
    due_date: invoice.due_date ?? "",
    discount_amount: numberToInput(invoice.discount_amount),
    notes: invoice.notes ?? "",
    items: [],
  };
}

export function invoiceItemToForm(item: InvoiceItem): InvoiceItemFormValues {
  return {
    item_name: item.item_name ?? "",
    description: item.description ?? "",
    quantity: numberToInput(item.quantity) || "1",
    unit: item.unit ?? "",
    unit_price: numberToInput(item.unit_price),
    gst_percent: numberToInput(item.gst_percent) || "0",
  };
}

export function projectInvoiceLabel(project: InvoiceProjectOption) {
  return [
    project.project_code ?? "Project",
    project.project_name ?? project.customer?.full_name ?? "Customer",
  ].join(" - ");
}

export function invoiceContextLabel(invoice: InvoiceWithRelations) {
  if (invoice.project_id) {
    return invoice.project?.project_code ?? invoice.project?.project_name ?? "Project invoice";
  }

  return "Manual item invoice";
}

export function invoiceContextDescription(invoice: InvoiceWithRelations) {
  if (invoice.project_id) {
    return `${invoice.customer?.full_name ?? "Customer"} / ${invoiceContextLabel(invoice)}`;
  }

  return `${invoice.customer?.full_name ?? "Customer"} / Manual item invoice`;
}

export function isActiveInvoice(invoice: InvoiceWithRelations) {
  return invoice.status !== "cancelled";
}

export function invoiceStatusTone(value: string | null | undefined) {
  if (value === "paid") {
    return "green" as const;
  }

  if (value === "cancelled" || value === "overdue") {
    return "red" as const;
  }

  if (value === "sent" || value === "partially_paid") {
    return "blue" as const;
  }

  return "neutral" as const;
}

export function lineGstAmount(item: InvoiceItem) {
  return Number(item.line_total ?? 0) * Number(item.gst_percent ?? 0) / 100;
}

export function lineGrossAmount(item: InvoiceItem) {
  return Number(item.line_total ?? 0) + lineGstAmount(item);
}

export function draftLineTotal(item: InvoiceItemFormValues) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const gstPercent = Number(item.gst_percent || 0);
  const base = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const gst = base * (Number.isFinite(gstPercent) ? gstPercent : 0) / 100;
  return {
    base,
    gst,
    gross: base + gst,
  };
}

export function invoiceDisplayPaid(invoice: InvoiceWithRelations) {
  return Number(invoice.amount_paid ?? 0);
}

export function invoiceDisplayBalance(invoice: InvoiceWithRelations) {
  return Math.max(
    Number(invoice.total_amount ?? 0) - invoiceDisplayPaid(invoice),
    0,
  );
}

export function validateInvoiceForm(
  values: InvoiceFormValues,
  options: { includeItems: boolean; requireProject?: boolean },
) {
  const discount = Number(values.discount_amount || 0);
  const nextErrors: Record<string, string> = {
    customer_id: requiredError(values.customer_id, "Customer"),
    project_id: options.requireProject
      ? requiredError(values.project_id, "Project")
      : "",
    invoice_date: requiredError(values.invoice_date, "Invoice date"),
    discount_amount:
      Number.isFinite(discount) && discount >= 0
        ? ""
        : "Discount must be 0 or more.",
  };

  if (options.includeItems) {
    values.items.forEach((item, index) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price || 0);
      const gstPercent = Number(item.gst_percent || 0);

      if (!item.item_name.trim()) {
        nextErrors[`items.${index}.item_name`] = "Item name is required.";
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        nextErrors[`items.${index}.quantity`] = "Quantity must be greater than 0.";
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        nextErrors[`items.${index}.unit_price`] = "Unit price must be 0 or more.";
      }

      if (!Number.isFinite(gstPercent) || gstPercent < 0) {
        nextErrors[`items.${index}.gst_percent`] = "GST must be 0 or more.";
      }
    });
  }

  return nextErrors;
}
