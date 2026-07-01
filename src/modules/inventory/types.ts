import type { Project } from "../projects/types";
import type { B2BSale } from "../b2b-sales/types";
import type { Product, ProductCategory } from "../product-master/types";

export type InventoryItemCategory =
  | "solar_panel"
  | "inverter"
  | "battery"
  | "mounting_structure"
  | "cable"
  | "connector"
  | "meter"
  | "safety_equipment"
  | "tool"
  | "other";

export type InventoryItemStatus = "active" | "inactive" | "discontinued";

export type InventoryUnit = "pcs" | "unit" | "meter" | "roll" | "set" | "kg";

export type InventoryMasterOption = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string | null;
};

export type InventoryModelOption = InventoryMasterOption & {
  product_id: string;
  brand_id: string;
};

export type InventoryCatalogProduct = Pick<
  Product,
  | "id"
  | "tenant_id"
  | "product_code"
  | "product_name"
  | "category_id"
  | "category_type"
  | "hsn_code"
  | "brand"
  | "model_number"
  | "specifications"
  | "unit"
  | "gst_percent"
  | "status"
> & {
  category?: Pick<
    ProductCategory,
    "id" | "name" | "category_type" | "display_order"
  > | null;
};

export type InventoryMasters = {
  products: InventoryCatalogProduct[];
  categories: Pick<ProductCategory, "id" | "name" | "category_type" | "display_order">[];
  vendors: InventoryMasterOption[];
};

export type InventoryTransactionType =
  | "stock_in"
  | "stock_out"
  | "adjustment"
  | "project_issue"
  | "return";

export type InventoryItem = {
  id: string;
  organization_id: string;
  catalog_product_id: string | null;
  product_id: string | null;
  brand_id: string | null;
  model_id: string | null;
  vendor_id: string | null;
  item_code: string | null;
  item_name: string;
  item_category: InventoryItemCategory;
  brand: string | null;
  model: string | null;
  unit: string | null;
  current_stock: number | null;
  opening_stock: number | null;
  minimum_stock: number | null;
  purchase_price: number | null;
  selling_price: number | null;
  gst_percent: number | null;
  status: InventoryItemStatus | null;
  bill_no: string | null;
  inventory_date: string | null;
  notes: string | null;
  reserved_qty?: number | null;
  available_qty?: number | null;
  shortage_qty?: number | null;
  created_at: string | null;
  updated_at: string | null;
  product_master?: Pick<InventoryMasterOption, "id" | "name"> | null;
  brand_master?: Pick<InventoryMasterOption, "id" | "name"> | null;
  model_master?: Pick<InventoryModelOption, "id" | "name"> | null;
  vendor_master?: Pick<InventoryMasterOption, "id" | "name"> | null;
  catalog_product?: InventoryCatalogProduct | null;
};

export type InventoryItemFormValues = {
  catalog_product_id: string;
  vendor_id: string;
  current_stock: string;
  opening_stock: string;
  minimum_alert: string;
  status: InventoryItemStatus;
  bill_no: string;
  inventory_date: string;
  notes: string;
};

export type InventoryTransaction = {
  id: string;
  organization_id: string;
  item_id: string;
  project_id: string | null;
  transaction_type: InventoryTransactionType;
  quantity: number;
  transaction_date: string | null;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InventoryTransactionWithRelations = InventoryTransaction & {
  item?: Pick<
    InventoryItem,
    "id" | "item_code" | "item_name" | "unit" | "current_stock" | "minimum_stock"
  > | null;
  project?: Pick<Project, "id" | "project_code" | "project_name"> | null;
  b2b_sale?: Pick<B2BSale, "id" | "sale_code" | "status"> | null;
  creator?: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export type InventoryBatch = {
  id: string;
  inventory_item_id: string;
  product_id: string;
  purchase_order_id: string | null;
  purchase_order_item_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  received_quantity: number | null;
  remaining_quantity: number | null;
  actual_unit_purchase_price: number | null;
  gst_percent: number | null;
  bill_no: string | null;
  received_date: string | null;
  notes: string | null;
  created_at: string | null;
};

export type InventoryTransactionFormValues = {
  item_id: string;
  transaction_type: InventoryTransactionType;
  quantity: string;
  transaction_date: string;
  project_id: string;
  reference_type: string;
  reference_id: string;
  notes: string;
};

export type InventoryProjectOption = Pick<
  Project,
  "id" | "project_code" | "project_name" | "customer_id"
>;
