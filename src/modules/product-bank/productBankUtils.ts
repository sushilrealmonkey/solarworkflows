import { requiredError } from "../crm/crmUtils";
import { productUnitOptions } from "../product-master/productFormCore";
import type {
  ProductBankProduct,
  ProductBankProductFormValues,
} from "./types";

export const productBankPublicationOptions = [
  "draft",
  "published",
  "archived",
] as const;

export { productUnitOptions };

export function emptyProductBankForm(): ProductBankProductFormValues {
  return {
    category_id: "",
    product_name: "",
    brand: "",
    model_number: "",
    specifications: "",
    unit: "piece",
    hsn_code: "",
    gst_percent: "0",
    warranty_description: "",
    notes: "",
    publication_status: "draft",
  };
}

export function productBankToForm(
  product: ProductBankProduct,
): ProductBankProductFormValues {
  return {
    category_id: product.category_id,
    product_name: product.product_name,
    brand: product.brand ?? "",
    model_number: product.model_number ?? "",
    specifications: product.specifications ?? "",
    unit: product.unit,
    hsn_code: product.hsn_code ?? "",
    gst_percent: String(product.gst_percent ?? 0),
    warranty_description: product.warranty_description ?? "",
    notes: product.notes ?? "",
    publication_status: product.publication_status,
  };
}

export function validateProductBankForm(values: ProductBankProductFormValues) {
  return {
    category_id: requiredError(values.category_id, "Category"),
    product_name: requiredError(values.product_name, "Product name"),
    unit: requiredError(values.unit, "Unit"),
    gst_percent: validGstError(values.gst_percent),
  };
}

function validGstError(value: string) {
  if (!value.trim()) return "";
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    return "GST percent must be a non-negative number.";
  }
  return "";
}
