import type { Vendor } from "../vendors/types";
import type {
  ExpenseFormValues,
  ExpensePaymentMethod,
  VendorExpenseWithRelations,
} from "./types";

export const expensePaymentMethods: ExpensePaymentMethod[] = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "card",
  "other",
];

export const expenseReceiptMaxBytes = 10 * 1024 * 1024;
export const expenseReceiptMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function emptyExpenseForm(vendor?: Vendor | null): ExpenseFormValues {
  const expenseDate = todayInputValue();
  return {
    vendor_id: vendor?.id ?? "",
    category_id: vendor?.category_id ?? "",
    project_id: "",
    amount: "",
    expense_date: expenseDate,
    payment_status: "due",
    due_date: dueDateForVendor(expenseDate, vendor),
    paid_date: "",
    payment_method: "",
    invoice_number: "",
    description: "",
  };
}

export function expenseToForm(expense: VendorExpenseWithRelations): ExpenseFormValues {
  return {
    vendor_id: expense.vendor_id,
    category_id: expense.category_id ?? "",
    project_id: expense.project_id ?? "",
    amount: String(expense.amount),
    expense_date: expense.expense_date,
    payment_status: expense.payment_status,
    due_date: expense.due_date ?? "",
    paid_date: expense.paid_date ?? "",
    payment_method: expense.payment_method ?? "",
    invoice_number: expense.invoice_number ?? "",
    description: expense.description ?? "",
  };
}

export function validateExpenseForm(values: ExpenseFormValues) {
  const amount = Number(values.amount);
  return {
    vendor_id: values.vendor_id ? "" : "Select a vendor.",
    category_id: values.category_id ? "" : "Select an expense category.",
    amount:
      values.amount.trim() && Number.isFinite(amount) && amount > 0
        ? ""
        : "Enter an amount greater than zero.",
    expense_date: values.expense_date ? "" : "Select the expense date.",
    description: values.description.trim() ? "" : "Enter the expense purpose.",
    due_date:
      values.due_date && values.due_date < values.expense_date
        ? "Due date cannot be before the expense date."
        : "",
    paid_date:
      values.payment_status === "paid" && !values.paid_date
        ? "Select the paid date."
        : values.paid_date && values.paid_date < values.expense_date
          ? "Paid date cannot be before the expense date."
          : "",
    payment_method:
      values.payment_status === "paid" && !values.payment_method
        ? "Select how this expense was paid."
        : "",
  };
}

export function validateExpenseReceipt(file: File | null) {
  if (!file) return "";
  if (file.size > expenseReceiptMaxBytes) {
    return "Receipt must be 10 MB or smaller.";
  }
  if (!expenseReceiptMimeTypes.has(file.type)) {
    return "Use a PDF, JPG, PNG, or WebP receipt.";
  }
  return "";
}

export function dueDateForVendor(expenseDate: string, vendor?: Vendor | null) {
  if (!expenseDate || vendor?.payment_terms_days == null) return "";
  const dueDate = new Date(`${expenseDate}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return "";
  dueDate.setDate(dueDate.getDate() + vendor.payment_terms_days);
  const local = new Date(
    dueDate.getTime() - dueDate.getTimezoneOffset() * 60_000,
  );
  return local.toISOString().slice(0, 10);
}

export function formatExpenseCurrency(
  value: number | null | undefined,
  currency = "INR",
) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function expenseProjectLabel(project: {
  project_code: string | null;
  project_name: string | null;
}) {
  return [project.project_code, project.project_name].filter(Boolean).join(" · ") || "Project";
}
