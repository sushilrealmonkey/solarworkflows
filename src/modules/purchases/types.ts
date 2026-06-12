import type { InventoryItem } from "../inventory/types";
import type { Vendor } from "../vendors/types";

export type PurchaseStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type PurchaseOrder = {
  id: string;
  organization_id: string;
  purchase_code: string | null;
  vendor_id: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  status: PurchaseStatus | null;
  subtotal: number | null;
  gst_amount: number | null;
  total_amount: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PurchaseOrderItem = {
  id: string;
  organization_id: string;
  purchase_order_id: string;
  item_id: string;
  quantity: number;
  received_quantity: number | null;
  unit_price: number | null;
  gst_percent: number | null;
  line_total: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PurchaseOrderItemWithRelations = PurchaseOrderItem & {
  item?: Pick<
    InventoryItem,
    "id" | "item_code" | "item_name" | "unit" | "brand" | "model"
  > | null;
};

export type PurchaseOrderWithRelations = PurchaseOrder & {
  vendor?: Pick<
    Vendor,
    "id" | "vendor_code" | "vendor_name" | "contact_person" | "phone"
  > | null;
  items?: PurchaseOrderItemWithRelations[] | null;
  creator?: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export type PurchaseOrderItemFormValues = {
  item_id: string;
  quantity: string;
  unit_price: string;
  gst_percent: string;
};

export type PurchaseReceiveItemFormValues = {
  purchase_order_item_id: string;
  item_name: string;
  ordered_quantity: number;
  already_received_quantity: number;
  received_quantity: string;
  actual_unit_purchase_price: string;
  gst_percent: string;
  update_current_purchase_price: boolean;
};

export type PurchaseReceiveFormValues = {
  bill_no: string;
  received_date: string;
  notes: string;
  items: PurchaseReceiveItemFormValues[];
};

export type PurchaseOrderFormValues = {
  vendor_id: string;
  order_date: string;
  expected_delivery_date: string;
  notes: string;
  items: PurchaseOrderItemFormValues[];
};
