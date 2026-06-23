import { requiredError } from "../crm/crmUtils";
import type {
  CatalogLibraryBrand,
  CatalogLibraryBrandFormValues,
  CatalogLibraryCategory,
  CatalogLibraryCategoryFormValues,
} from "./types";

export function emptyCatalogCategoryForm(): CatalogLibraryCategoryFormValues {
  return {
    name: "",
    category_type: "",
    display_order: "999",
    description: "",
    is_active: true,
  };
}

export function catalogCategoryToForm(
  category: CatalogLibraryCategory,
): CatalogLibraryCategoryFormValues {
  return {
    name: category.name ?? "",
    category_type: category.category_type ?? "",
    display_order: numberToInput(category.display_order),
    description: category.description ?? "",
    is_active: category.is_active !== false,
  };
}

export function emptyCatalogBrandForm(): CatalogLibraryBrandFormValues {
  return {
    name: "",
    display_order: "999",
    is_active: true,
  };
}

export function catalogBrandToForm(
  brand: CatalogLibraryBrand,
): CatalogLibraryBrandFormValues {
  return {
    name: brand.name ?? "",
    display_order: numberToInput(brand.display_order),
    is_active: brand.is_active !== false,
  };
}

export function validateCatalogCategoryForm(
  values: CatalogLibraryCategoryFormValues,
) {
  return {
    name: requiredError(values.name, "Category name"),
    category_type: requiredError(values.category_type, "Category type"),
    display_order: positiveIntegerError(values.display_order, "Display order"),
  };
}

export function validateCatalogBrandForm(
  values: CatalogLibraryBrandFormValues,
) {
  return {
    name: requiredError(values.name, "Brand name"),
    display_order: positiveIntegerError(values.display_order, "Display order"),
  };
}

export function catalogValidationSummary(errors: Record<string, string>) {
  return Object.values(errors)
    .filter(Boolean)
    .map((error) => `- ${error}`)
    .join("\n");
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "999" : String(value);
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
