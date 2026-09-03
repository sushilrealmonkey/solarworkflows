export type QuotationPackageItem = {
  id: string;
  company_id: string;
  organization_id: string;
  quotation_package_id: string;
  product_id: string;
  product_name: string;
  hsn_code: string | null;
  brand: string | null;
  model_number: string | null;
  specification: string | null;
  quantity: number;
  unit: string;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
};

export type QuotationPackage = {
  id: string;
  company_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  commercial_cost: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  items: QuotationPackageItem[];
};

export type QuotationPackageItemFormValues = {
  product_id: string;
  quantity: string;
};

export type QuotationPackageFormValues = {
  name: string;
  description: string;
  commercial_cost: string;
  is_active: boolean;
  items: QuotationPackageItemFormValues[];
};
