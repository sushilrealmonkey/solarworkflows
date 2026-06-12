import { labelize, requiredError } from "../crm/crmUtils";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
  ProductCategoryType,
  ProductFormValues,
  ProductPrice,
  ProductPriceFormValues,
  ProductStatus,
  ProductType,
  ProductTypeFormValues,
  ProductUnit,
  ProductUsageSummary,
} from "./types";

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

export const productUnitOptions: ProductUnit[] = [
  "piece",
  "set",
  "roll",
  "meter",
  "watt",
  "kw",
  "lot",
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
    display_order: "999",
    description: "",
  };
}

export function productCategoryToForm(
  category: ProductCategory,
): ProductCategoryFormValues {
  return {
    name: category.name ?? "",
    category_type: category.category_type ?? "",
    display_order: numberToInput(category.display_order),
    description: category.description ?? "",
  };
}

export function emptyProductTypeForm(categoryId: string): ProductTypeFormValues {
  return {
    category_id: categoryId,
    name: "",
    display_order: "999",
    is_active: true,
  };
}

export function productTypeToForm(
  productType: ProductType,
): ProductTypeFormValues {
  return {
    category_id: productType.category_id,
    name: productType.name ?? "",
    display_order: numberToInput(productType.display_order),
    is_active: productType.is_active !== false,
  };
}

export function emptyProductForm(): ProductFormValues {
  return {
    category_id: "",
    hsn_code: "",
    product_type_id: "",
    product_name: "",
    brand: "",
    model_number: "",
    specifications: "",
    unit: "piece",
    gst_percent: "0",
    warranty_description: "",
    status: "active",
    notes: "",
  };
}

export function productToForm(product: Product): ProductFormValues {
  return {
    category_id: product.category_id,
    hsn_code: product.hsn_code ?? "",
    product_type_id: product.product_type_id ?? "",
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

export function productTypeName(product: Product) {
  return product.product_type?.name ?? "-";
}

export function productCategoryTypeLabel(
  categoryType: ProductCategoryType | "" | null | undefined,
) {
  return labelize(categoryType);
}

export function buildGeneratedProductName(
  values: ProductFormValues,
  categories: ProductCategory[],
) {
  const categoryName =
    categories.find((category) => category.id === values.category_id)?.name ?? "";

  return [
    values.brand,
    categoryName,
    values.model_number,
    values.specifications,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
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

export function validateProductForm(values: ProductFormValues) {
  return {
    category_id: requiredError(values.category_id, "Category"),
    product_name: requiredError(
      values.product_name,
      "Auto generated display name",
    ),
    unit: requiredError(values.unit, "Unit"),
    gst_percent: nonNegativeNumberError(values.gst_percent, "GST percent"),
    status: requiredError(values.status, "Status"),
  };
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

export function validateProductTypeForm(values: ProductTypeFormValues) {
  return {
    category_id: requiredError(values.category_id, "Category"),
    name: requiredError(values.name, "Product type name"),
    display_order: positiveIntegerError(values.display_order, "Display order"),
  };
}

export function validateProductCategoryForm(values: ProductCategoryFormValues) {
  return {
    name: requiredError(values.name, "Category name"),
    category_type: requiredError(values.category_type, "Category type"),
    display_order: positiveIntegerError(values.display_order, "Display order"),
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

function positiveIntegerError(value: string, label: string) {
  if (!value.trim()) {
    return `${label} is required.`;
  }

  const nextValue = Number(value);

  if (!Number.isInteger(nextValue)) {
    return `${label} must be a positive integer.`;
  }

  if (nextValue <= 0) {
    return `${label} cannot be negative or zero.`;
  }

  return "";
}

function isProductUnit(value: string | null | undefined): value is ProductUnit {
  return productUnitOptions.includes(value as ProductUnit);
}
