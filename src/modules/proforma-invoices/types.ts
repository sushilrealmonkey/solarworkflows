import type { SurveyCustomerSummary } from "../site-surveys/types";
import type { PaymentWithRelations } from "../payments/types";
import type {
  InvoiceFormValues,
  InvoiceInventoryItemOption,
  InvoiceItemFormValues,
  InvoiceProjectOption,
  InvoiceQuotationSummary,
  InvoiceWithRelations,
} from "../invoices/types";

export type ProformaInvoiceStatus =
  | "unpaid"
  | "partially_paid"
  | "paid";

export type ProformaInvoice = {
  id: string;
  company_id: string;
  organization_id: string;
  proforma_code: string | null;
  customer_id: string;
  project_id: string | null;
  quotation_id: string | null;
  b2b_sale_id: string | null;
  final_invoice_id: string | null;
  proforma_date: string | null;
  due_date: string | null;
  base_amount: number | null;
  gst_amount: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  status: ProformaInvoiceStatus | null;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  paid_at: string | null;
  converted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

export type ProformaInvoiceItem = {
  id: string;
  company_id: string;
  organization_id: string;
  proforma_invoice_id: string;
  inventory_item_id: string | null;
  item_name: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  gst_percent: number | null;
  discount_amount: number | null;
  line_total: number | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  inventory_item?: Pick<InvoiceInventoryItemOption, "id" | "item_code"> & {
    catalog_product?: Pick<
      NonNullable<InvoiceInventoryItemOption["catalog_product"]>,
      "id" | "hsn_code"
    > | null;
  } | null;
};

export type ProformaInvoiceWithRelations = ProformaInvoice & {
  customer?: SurveyCustomerSummary | null;
  project?: InvoiceProjectOption | null;
  quotation?: InvoiceQuotationSummary | null;
  b2b_sale?: {
    id: string;
    sale_code: string | null;
    billing_address: string | null;
    delivery_address: string | null;
    gst_number: string | null;
    total_amount: number | null;
    status: string | null;
  } | null;
  linked_b2b_sales?: Array<{
    id: string;
    sale_code: string | null;
    billing_address: string | null;
    delivery_address: string | null;
    gst_number: string | null;
    total_amount: number | null;
    status: string | null;
  }> | null;
  final_invoice?: Pick<
    InvoiceWithRelations,
    "id" | "invoice_code" | "total_amount" | "balance_due" | "status"
  > | null;
  created_by_profile?: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export type ProformaInvoiceLinkOptions = {
  customers: SurveyCustomerSummary[];
  projects: InvoiceProjectOption[];
  quotations: InvoiceQuotationSummary[];
  inventoryItems: InvoiceInventoryItemOption[];
};

export type ProformaInvoiceFormValues = InvoiceFormValues;
export type ProformaInvoiceItemFormValues = InvoiceItemFormValues;

export type ProformaPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_mode: string;
  reference_number: string;
  bank_name: string;
  notes: string;
  status: string;
};

export type ProformaInvoiceDetailData = {
  proformaInvoice: ProformaInvoiceWithRelations | null;
  items: ProformaInvoiceItem[];
  payments: PaymentWithRelations[];
};
