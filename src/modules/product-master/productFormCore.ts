import type { ProductCategory, ProductFormValues, ProductUnit } from "./types";

export const productUnitOptions: ProductUnit[] = [
  "piece",
  "set",
  "roll",
  "meter",
  "kg",
  "watt",
  "kw",
  "lot",
];

export function emptyProductForm(): ProductFormValues {
  return {
    category_id: "",
    hsn_code: "",
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

export function validateProductForm(values: ProductFormValues) {
  return {
    category_id: requiredValueError(values.category_id, "Category"),
    product_name: requiredValueError(
      values.product_name,
      "Auto generated display name",
    ),
    unit: requiredValueError(values.unit, "Unit"),
    gst_percent: nonNegativeNumberError(values.gst_percent, "GST percent"),
    status: requiredValueError(values.status, "Status"),
  };
}

function requiredValueError(value: string, label: string) {
  return value.trim() ? "" : `${label} is required.`;
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
