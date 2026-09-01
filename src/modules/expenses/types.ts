import type { Vendor, VendorCategory } from "../vendors/types";

export type ExpensePaymentStatus = "due" | "paid";

export type ExpensePaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "card"
  | "other";

export type VendorExpense = {
  id: string;
  company_id: string;
  organization_id: string;
  vendor_id: string;
  category_id: string | null;
  project_id: string | null;
  amount: number;
  expense_date: string;
  payment_status: ExpensePaymentStatus;
  due_date: string | null;
  paid_date: string | null;
  payment_method: ExpensePaymentMethod | null;
  invoice_number: string | null;
  payment_reference: string | null;
  description: string;
  notes: string | null;
  receipt_file_path: string | null;
  receipt_file_name: string | null;
  receipt_mime_type: string | null;
  receipt_file_size: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseProjectOption = {
  id: string;
  project_code: string | null;
  project_name: string | null;
};

export type VendorExpenseWithRelations = VendorExpense & {
  vendor?: Pick<
    Vendor,
    | "id"
    | "vendor_code"
    | "vendor_name"
    | "phone"
    | "category_id"
    | "preferred_payment_method"
    | "payment_terms_days"
    | "status"
  > | null;
  category?: Pick<VendorCategory, "id" | "name" | "is_active"> | null;
  project?: ExpenseProjectOption | null;
};

export type ExpenseFormValues = {
  vendor_id: string;
  category_id: string;
  project_id: string;
  amount: string;
  expense_date: string;
  payment_status: ExpensePaymentStatus;
  due_date: string;
  paid_date: string;
  payment_method: "" | ExpensePaymentMethod;
  invoice_number: string;
  description: string;
};
