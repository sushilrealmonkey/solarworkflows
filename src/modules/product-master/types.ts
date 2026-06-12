export type ProductStatus = "active" | "inactive" | "discontinued";

export type ProductCategoryType =
  | "SOLAR_PANEL"
  | "INVERTER"
  | "STRUCTURE"
  | "DC_CABLE"
  | "AC_CABLE"
  | "EARTHING"
  | "LIGHTNING_ARRESTOR"
  | "BATTERY"
  | "MONITORING_DEVICE"
  | "PROTECTION_DEVICE"
  | "ACCESSORY"
  | "OTHER";

export type ProductUnit =
  | "piece"
  | "set"
  | "roll"
  | "meter"
  | "watt"
  | "kw"
  | "lot";

export type ProductCategory = {
  id: string;
  tenant_id: string;
  name: string;
  category_type: ProductCategoryType;
  display_order: number;
  description: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductType = {
  id: string;
  tenant_id: string;
  category_id: string;
  name: string;
  display_order: number;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductCategoryFormValues = {
  name: string;
  category_type: ProductCategoryType | "";
  display_order: string;
  description: string;
};

export type ProductTypeFormValues = {
  category_id: string;
  name: string;
  display_order: string;
  is_active: boolean;
};

export type Product = {
  id: string;
  tenant_id: string;
  product_code: string;
  product_name: string;
  category_id: string;
  category_type: ProductCategoryType;
  hsn_code: string | null;
  product_type_id: string | null;
  brand: string | null;
  model_number: string | null;
  specifications: string | null;
  unit: string;
  /** @deprecated Current pricing is stored in product_prices. */
  purchase_price: number | null;
  /** @deprecated Current pricing is stored in product_prices. */
  selling_price: number | null;
  gst_percent: number | null;
  warranty_description: string | null;
  /** @deprecated Minimum stock is now managed by Inventory records. */
  minimum_stock_alert: number | null;
  status: ProductStatus | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  category?: Pick<
    ProductCategory,
    "id" | "name" | "category_type" | "display_order"
  > | null;
  product_type?: Pick<
    ProductType,
    "id" | "name" | "category_id" | "display_order" | "is_active"
  > | null;
};

export type ProductFormValues = {
  category_id: string;
  hsn_code: string;
  product_type_id: string;
  product_name: string;
  brand: string;
  model_number: string;
  specifications: string;
  unit: ProductUnit | "";
  gst_percent: string;
  warranty_description: string;
  status: ProductStatus;
  notes: string;
};

export type ProductPrice = {
  id: string;
  company_id: string | null;
  organization_id: string;
  product_id: string;
  current_purchase_price: number | null;
  current_selling_price: number | null;
  gst_percent: number | null;
  effective_date: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductPriceHistory = {
  id: string;
  product_id: string;
  product_price_id: string | null;
  old_purchase_price: number | null;
  new_purchase_price: number | null;
  old_selling_price: number | null;
  new_selling_price: number | null;
  old_gst_percent: number | null;
  new_gst_percent: number | null;
  effective_date: string | null;
  source: "manual" | "purchase_receive" | "legacy_migration" | null;
  changed_by: string | null;
  changed_at: string | null;
};

export type ProductPriceFormValues = {
  current_purchase_price: string;
  current_selling_price: string;
  gst_percent: string;
  effective_date: string;
};

export type ProductUsageSummary = {
  inventory: number;
  quotations: number;
  purchaseOrders: number;
  projects: number;
};
