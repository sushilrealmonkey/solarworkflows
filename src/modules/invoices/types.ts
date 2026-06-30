import type { SurveyCustomerSummary } from "../site-surveys/types";
import type { PaymentWithRelations } from "../payments/types";
import type { InventoryItem } from "../inventory/types";

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export type InvoiceCreationMode = "project" | "manual";

export type Invoice = {
  id: string;
  organization_id: string;
  invoice_code: string | null;
  customer_id: string;
  project_id: string | null;
  quotation_id: string | null;
  b2b_sale_id: string | null;
  proforma_invoice_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  base_amount: number | null;
  gst_amount: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  status: InvoiceStatus | null;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InvoiceItem = {
  id: string;
  organization_id: string;
  invoice_id: string;
  inventory_item_id: string | null;
  item_name: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  gst_percent: number | null;
  line_total: number | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InvoiceInventoryItemOption = Pick<
  InventoryItem,
  | "id"
  | "organization_id"
  | "item_code"
  | "item_name"
  | "unit"
  | "brand"
  | "model"
  | "current_stock"
  | "status"
> & {
  catalog_product?: Pick<
    NonNullable<InventoryItem["catalog_product"]>,
    | "id"
    | "product_code"
    | "product_name"
    | "brand"
    | "model_number"
    | "specifications"
    | "unit"
    | "gst_percent"
    | "status"
  > | null;
};

export type InvoiceQuotationSummary = {
  id: string;
  quotation_code: string | null;
  customer_id: string;
  base_amount: number | null;
  gst_amount: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  subsidy_amount: number | null;
  net_payable_amount: number | null;
};

export type InvoiceProjectOption = {
  id: string;
  organization_id: string;
  project_code: string | null;
  project_name: string | null;
  customer_id: string;
  quotation_id: string | null;
  customer?: SurveyCustomerSummary | null;
  quotation?: InvoiceQuotationSummary | null;
};

export type InvoiceWithRelations = Invoice & {
  customer?: SurveyCustomerSummary | null;
  project?: InvoiceProjectOption | null;
  quotation?: InvoiceQuotationSummary | null;
  b2b_sale?: {
    id: string;
    sale_code: string | null;
    total_amount: number | null;
    status: string | null;
  } | null;
  proforma_invoice?: {
    id: string;
    proforma_code: string | null;
    total_amount: number | null;
    balance_due: number | null;
    status: string | null;
  } | null;
  created_by_profile?: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export type InvoiceLinkOptions = {
  customers: SurveyCustomerSummary[];
  projects: InvoiceProjectOption[];
  quotations: InvoiceQuotationSummary[];
  inventoryItems: InvoiceInventoryItemOption[];
};

export type InvoiceItemFormValues = {
  id?: string;
  inventory_item_id: string;
  item_name: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  gst_percent: string;
};

export type InvoiceFormValues = {
  creation_mode: InvoiceCreationMode;
  customer_id: string;
  project_id: string;
  quotation_id: string;
  invoice_date: string;
  due_date: string;
  discount_amount: string;
  notes: string;
  items: InvoiceItemFormValues[];
};

export type InvoicePaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_mode: string;
  reference_number: string;
  bank_name: string;
  notes: string;
  status: string;
};

export type InvoiceDetailData = {
  invoice: InvoiceWithRelations | null;
  items: InvoiceItem[];
  payments: PaymentWithRelations[];
};
