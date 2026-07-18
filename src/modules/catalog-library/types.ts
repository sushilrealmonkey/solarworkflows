import type { ProductCategoryType } from "../product-master/types";

export type CatalogLibraryCategory = {
  id: string;
  name: string;
  category_type: ProductCategoryType;
  display_order: number;
  description: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CatalogLibraryBrand = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CatalogLibraryCategoryFormValues = {
  name: string;
  category_type: ProductCategoryType | "";
  display_order: string;
  description: string;
  is_active: boolean;
};

export type CatalogLibraryBrandFormValues = {
  name: string;
  display_order: string;
  is_active: boolean;
};
