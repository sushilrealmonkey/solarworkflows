import type { SurveyCustomerSummary } from "../site-surveys/types";

export type PaymentSource = "customer_direct" | "bank_loan";

export type PaymentMode =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "loan_disbursement"
  | "other";

export type PaymentStatus = "received" | "failed" | "cancelled";

export type ProjectPaymentStatus = "pending" | "partial" | "paid" | "overdue";

export type Payment = {
  id: string;
  organization_id: string;
  project_id: string | null;
  customer_id: string;
  quotation_id: string | null;
  proforma_invoice_id: string | null;
  invoice_id: string | null;
  b2b_sale_id: string | null;
  payment_source: PaymentSource;
  payment_mode: PaymentMode | null;
  amount: number;
  payment_date: string | null;
  reference_number: string | null;
  bank_name: string | null;
  loan_account_number: string | null;
  receipt_url: string | null;
  notes: string | null;
  status: PaymentStatus | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
};

export type PaymentProjectSummary = {
  id: string;
  organization_id: string;
  project_id: string;
  quotation_id: string | null;
  customer_id: string;
  total_project_amount: number | null;
  subsidy_amount: number | null;
  company_receivable_amount: number | null;
  amount_received: number | null;
  balance_due: number | null;
  payment_status: ProjectPaymentStatus | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PaymentQuotationSummary = {
  id: string;
  quotation_code: string | null;
  total_amount: number | null;
  subsidy_amount: number | null;
  net_payable_amount: number | null;
};

export type PaymentProjectOption = {
  id: string;
  organization_id: string;
  project_code: string | null;
  project_name: string | null;
  customer_id: string;
  quotation_id: string | null;
  customer?: SurveyCustomerSummary | null;
  quotation?: PaymentQuotationSummary | null;
};

export type PaymentWithRelations = Payment & {
  customer?: SurveyCustomerSummary | null;
  project?: PaymentProjectOption | null;
  quotation?: PaymentQuotationSummary | null;
  invoice?: {
    id: string;
    invoice_code: string | null;
    total_amount: number | null;
    balance_due: number | null;
    status: string | null;
  } | null;
  proforma_invoice?: {
    id: string;
    proforma_code: string | null;
    total_amount: number | null;
    balance_due: number | null;
    status: string | null;
  } | null;
  b2b_sale?: {
    id: string;
    sale_code: string | null;
    total_amount: number | null;
    status: string | null;
  } | null;
  created_by_profile?: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export type PaymentFormValues = {
  project_id: string;
  customer_id: string;
  quotation_id: string;
  proforma_invoice_id: string;
  invoice_id: string;
  b2b_sale_id: string;
  payment_source: PaymentSource;
  payment_mode: PaymentMode;
  amount: string;
  payment_date: string;
  reference_number: string;
  bank_name: string;
  loan_account_number: string;
  receipt_url: string;
  notes: string;
  status: PaymentStatus;
};
