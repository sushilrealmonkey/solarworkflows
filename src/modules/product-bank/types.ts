import type { ProductCategoryType, ProductUnit } from "../product-master/types";

export type ProductBankPublicationStatus = "draft" | "published" | "archived";

export type ProductBankCategory = {
  id: string;
  name: string;
  category_type: ProductCategoryType;
};

export type ProductBankWorkspaceProduct = {
  id: string;
  archived_at: string | null;
  product_bank_revision: number | null;
};

export type ProductBankProduct = {
  id: string;
  company_id: string;
  category_id: string;
  product_name: string;
  brand: string | null;
  model_number: string | null;
  specifications: string | null;
  unit: ProductUnit;
  hsn_code: string | null;
  gst_percent: number | null;
  warranty_description: string | null;
  notes: string | null;
  publication_status: ProductBankPublicationStatus;
  revision: number;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  category: ProductBankCategory;
  workspace_product: ProductBankWorkspaceProduct | null;
};

export type ProductBankProductFormValues = {
  category_id: string;
  product_name: string;
  brand: string;
  model_number: string;
  specifications: string;
  unit: ProductUnit | "";
  hsn_code: string;
  gst_percent: string;
  warranty_description: string;
  notes: string;
  publication_status: ProductBankPublicationStatus;
};

export type ProductBankImportAction = "added" | "already_added" | "restored";

export type ProductBankImportResult = {
  product_bank_id: string;
  product_id: string;
  import_action: ProductBankImportAction;
};
