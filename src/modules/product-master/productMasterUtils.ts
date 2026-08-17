import { labelize, requiredError } from "../crm/crmUtils";
import { productUnitOptions } from "./productFormCore";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
  ProductCategoryType,
  ProductFormValues,
  ProductPrice,
  ProductPriceFormValues,
  ProductStatus,
  ProductUnit,
  ProductUsageSummary,
} from "./types";

export {
  buildGeneratedProductName,
  emptyProductForm,
  productUnitOptions,
  validateProductForm,
} from "./productFormCore";

export const productCategoryTypeOptions: ProductCategoryType[] = [
  "SOLAR_PANEL",
  "INVERTER",
  "STRUCTURE",
  "DC_CABLE",
  "AC_CABLE",
  "EARTHING",
  "LIGHTNING_ARRESTOR",
  "BATTERY",
  "MONITORING_DEVICE",
  "PROTECTION_DEVICE",
  "ACCESSORY",
  "OTHER",
];

export const productStatusOptions: ProductStatus[] = [
  "active",
  "inactive",
  "discontinued",
];

export const emptyUsageSummary: ProductUsageSummary = {
  inventory: 0,
  quotations: 0,
  purchaseOrders: 0,
  projects: 0,
};

export function emptyProductCategoryForm(): ProductCategoryFormValues {
  return {
    name: "",
    category_type: "",
    description: "",
  };
}

export function productCategoryToForm(
  category: ProductCategory,
): ProductCategoryFormValues {
  return {
    name: category.name ?? "",
    category_type: category.category_type ?? "",
    description: category.description ?? "",
  };
}

export function productToForm(product: Product): ProductFormValues {
  return {
    category_id: product.category_id,
    hsn_code: product.hsn_code ?? "",
    product_name: product.product_name ?? "",
    brand: product.brand ?? "",
    model_number: product.model_number ?? "",
    specifications: product.specifications ?? "",
    unit: isProductUnit(product.unit) ? product.unit : "",
    gst_percent: numberToInput(product.gst_percent),
    warranty_description: product.warranty_description ?? "",
    status: product.status ?? "active",
    notes: product.notes ?? "",
  };
}

export function productCategoryName(product: Product) {
  return product.category?.name ?? "-";
}

export function productCategoryTypeLabel(
  categoryType: ProductCategoryType | "" | null | undefined,
) {
  return labelize(categoryType);
}

export function formatProductCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function emptyProductPriceForm(): ProductPriceFormValues {
  return {
    current_purchase_price: "0",
    current_selling_price: "0",
    gst_percent: "0",
    effective_date: new Date().toISOString().slice(0, 10),
  };
}

export function productPriceToForm(
  price: ProductPrice | null,
): ProductPriceFormValues {
  if (!price) {
    return emptyProductPriceForm();
  }

  return {
    current_purchase_price: numberToInput(price.current_purchase_price),
    current_selling_price: numberToInput(price.current_selling_price),
    gst_percent: numberToInput(price.gst_percent),
    effective_date:
      price.effective_date ?? new Date().toISOString().slice(0, 10),
  };
}

export function productStatusLabel(status: ProductStatus | null | undefined) {
  return labelize(status);
}

export function validateProductPriceForm(values: ProductPriceFormValues) {
  return {
    current_purchase_price: nonNegativeNumberError(
      values.current_purchase_price,
      "Purchase price",
    ),
    current_selling_price: nonNegativeNumberError(
      values.current_selling_price,
      "Selling price",
    ),
    gst_percent: nonNegativeNumberError(values.gst_percent, "GST percent"),
    effective_date: requiredError(values.effective_date, "Effective date"),
  };
}

export function validateProductCategoryForm(values: ProductCategoryFormValues) {
  return {
    name: requiredError(values.name, "Category name"),
    category_type: requiredError(values.category_type, "Category type"),
  };
}

export function productValidationSummary(errors: Record<string, string>) {
  return Object.values(errors)
    .filter(Boolean)
    .map((error) => `- ${error}`)
    .join("\n");
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "0" : String(value);
}

function nonNegativeNumberError(value: string, label: string) {
  const nextValue = value.trim() ? Number(value) : 0;

  if (!Number.isFinite(nextValue)) {
    return `${label} must be a valid number.`;
  }

  if (nextValue < 0) {
    return `${label} cannot be negative.`;
  }

  return "";
}

function isProductUnit(value: string | null | undefined): value is ProductUnit {
  return productUnitOptions.includes(value as ProductUnit);
}
