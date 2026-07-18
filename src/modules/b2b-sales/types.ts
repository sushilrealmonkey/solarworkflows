import type { InvoiceWithRelations } from "../invoices/types";
import type { PaymentWithRelations } from "../payments/types";
import type { SurveyCustomerSummary } from "../site-surveys/types";

export type B2BSaleStatus = "draft" | "confirmed" | "dispatched" | "cancelled";

export type B2BSale = {
  id: string;
  company_id: string;
  organization_id: string;
  sale_code: string | null;
  customer_id: string;
  proforma_invoice_id: string | null;
  invoice_id: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  gst_number: string | null;
  sale_date: string | null;
  dispatch_date: string | null;
  status: B2BSaleStatus | null;
  base_amount: number | null;
  gst_amount: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

export type B2BSaleItem = {
  id: string;
  company_id: string;
  organization_id: string;
  b2b_sale_id: string;
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
};

export type B2BInventoryItemOption = {
  id: string;
  organization_id: string;
  catalog_product_id: string | null;
  item_code: string | null;
  item_name: string;
  unit: string | null;
  brand: string | null;
  model: string | null;
  current_stock: number | null;
  available_qty?: number | null;
  reserved_qty?: number | null;
  status: string | null;
  catalog_product?: {
    id: string;
    product_code: string | null;
    product_name: string;
    brand: string | null;
    model_number: string | null;
    specifications: string | null;
    unit: string | null;
    gst_percent: number | null;
    status: string | null;
  } | null;
  current_selling_price?: number | null;
  pricing_gst_percent?: number | null;
};

export type B2BSaleWithRelations = B2BSale & {
  customer?: SurveyCustomerSummary | null;
  invoice?: Pick<
    InvoiceWithRelations,
    "id" | "invoice_code" | "total_amount" | "amount_paid" | "balance_due" | "status"
  > | null;
  proforma_invoice?: {
    id: string;
    proforma_code: string | null;
    total_amount: number | null;
    amount_paid: number | null;
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

export type B2BSaleFormItem = {
  id?: string;
  inventory_item_id: string;
  item_name: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_amount: string;
  gst_percent: string;
};

export type B2BSaleFormValues = {
  customer_id: string;
  billing_address: string;
  delivery_address: string;
  gst_number: string;
  sale_date: string;
  notes: string;
  items: B2BSaleFormItem[];
};

export type B2BPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_mode: string;
  reference_number: string;
  bank_name: string;
  notes: string;
  status: string;
};

export type B2BSaleOptions = {
  customers: SurveyCustomerSummary[];
  inventoryItems: B2BInventoryItemOption[];
};

export type B2BSaleDetailData = {
  sale: B2BSaleWithRelations | null;
  items: B2BSaleItem[];
  payments: PaymentWithRelations[];
};
