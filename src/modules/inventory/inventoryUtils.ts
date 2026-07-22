import { labelize, requiredError } from "../crm/crmUtils";
import type {
  InventoryItem,
  InventoryItemCategory,
  InventoryItemFormValues,
  InventoryItemStatus,
  InventoryStockCorrectionValues,
  InventoryUnit,
  InventoryTransactionFormValues,
  InventoryTransactionType,
} from "./types";

export const inventoryUnitOptions: InventoryUnit[] = [
  "pcs",
  "unit",
  "meter",
  "roll",
  "set",
  "kg",
];

export const inventoryStatusOptions: InventoryItemStatus[] = [
  "active",
  "inactive",
  "discontinued",
];

export const inventoryTransactionTypeOptions: InventoryTransactionType[] = [
  "stock_in",
  "stock_out",
  "adjustment",
  "project_issue",
  "return",
];

export function emptyInventoryItemForm(): InventoryItemFormValues {
  return {
    minimum_alert: "0",
    notes: "",
  };
}

export function inventoryItemToForm(
  item: InventoryItem,
): InventoryItemFormValues {
  return {
    minimum_alert: numberToInput(item.minimum_stock),
    notes: item.notes ?? "",
  };
}

export function emptyInventoryStockCorrection(
  item: InventoryItem,
): InventoryStockCorrectionValues {
  return {
    counted_quantity: numberToInput(item.current_stock),
    correction_date: new Date().toISOString().slice(0, 10),
    reason: "",
  };
}

export function emptyInventoryTransactionForm(
  itemId = "",
): InventoryTransactionFormValues {
  return {
    item_id: itemId,
    transaction_type: "stock_in",
    quantity: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    project_id: "",
    reference_type: "",
    reference_id: "",
    notes: "",
  };
}

export function isLowStock(item: InventoryItem) {
  return (
    isActiveInventoryItem(item) &&
    availableStockNumber(item) <= stockNumber(item.minimum_stock)
  );
}

export function isOutOfStock(item: InventoryItem) {
  return isActiveInventoryItem(item) && availableStockNumber(item) <= 0;
}

export function isActiveInventoryItem(item: InventoryItem) {
  return (
    item.status === "active" &&
    item.catalog_product?.status !== "discontinued"
  );
}

export function stockNumber(value: number | null | undefined) {
  return Number(value ?? 0);
}

export function availableStockNumber(item: InventoryItem) {
  return stockNumber(item.available_qty ?? item.current_stock);
}

export function formatStock(value: number | null | undefined, unit?: string | null) {
  const stock = stockNumber(value);
  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(stock)}${unit ? ` ${unit}` : ""}`;
}

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function inventoryProductName(item: InventoryItem) {
  return item.catalog_product?.product_name ?? item.product_master?.name ?? item.item_name ?? "";
}

export function inventoryBrandName(item: InventoryItem) {
  return item.catalog_product?.brand ?? item.brand_master?.name ?? item.brand ?? "";
}

export function inventoryModelName(item: InventoryItem) {
  return (
    item.catalog_product?.model_number ??
    item.catalog_product?.specifications ??
    item.model_master?.name ??
    item.model ??
    ""
  );
}

export function inventoryVendorName(item: InventoryItem) {
  return item.vendor_master?.name ?? "";
}

export function inventoryItemTitle(item: InventoryItem) {
  return [inventoryProductName(item), inventoryBrandName(item), inventoryModelName(item)]
    .filter(Boolean)
    .join(" / ");
}

export function inventoryCategoryFromProduct(productName: string): InventoryItemCategory {
  const normalized = normalizeInventoryName(productName);

  if (normalized.includes("solar panel")) {
    return "solar_panel";
  }

  if (normalized.includes("inverter")) {
    return "inverter";
  }

  if (normalized.includes("battery")) {
    return "battery";
  }

  if (normalized.includes("mounting")) {
    return "mounting_structure";
  }

  if (normalized.includes("cable")) {
    return "cable";
  }

  if (
    normalized.includes("acdb") ||
    normalized.includes("dcdb") ||
    normalized.includes("earthing") ||
    normalized.includes("lightning")
  ) {
    return "safety_equipment";
  }

  return "other";
}

export function normalizeInventoryName(value: string) {
  return value.trim().toLowerCase();
}

export function transactionAffectsProject(type: InventoryTransactionType) {
  return type === "project_issue";
}

export function transactionDecreasesStock(type: InventoryTransactionType) {
  return type === "stock_out" || type === "project_issue";
}

export function transactionIncreasesStock(type: InventoryTransactionType) {
  return type === "stock_in" || type === "return";
}

export function transactionTypeLabel(type: InventoryTransactionType | null) {
  return labelize(type);
}

export function validateInventoryItemForm(values: InventoryItemFormValues) {
  return {
    minimum_alert: nonNegativeNumberError(values.minimum_alert, "Minimum alert"),
  };
}

export function validateInventoryStockCorrection(
  values: InventoryStockCorrectionValues,
) {
  return {
    counted_quantity: nonNegativeNumberError(
      values.counted_quantity,
      "Counted stock",
    ),
    correction_date: requiredError(values.correction_date, "Correction date"),
    reason: requiredError(values.reason, "Correction reason"),
  };
}

export function inventoryItemValidationSummary(
  errors: Record<string, string>,
) {
  return Object.values(errors)
    .filter(Boolean)
    .map((error) => `- ${error}`)
    .join("\n");
}

export function validateTransactionForm(
  values: InventoryTransactionFormValues,
  items: InventoryItem[],
) {
  const selectedItem = items.find((item) => item.id === values.item_id);
  const quantity = Number(values.quantity);
  const quantityError =
    !values.quantity.trim() || !Number.isFinite(quantity)
      ? "Quantity is required."
      : values.transaction_type === "adjustment" && quantity === 0
        ? "Adjustment quantity cannot be zero."
        : values.transaction_type !== "adjustment" && quantity <= 0
          ? "Quantity must be greater than zero."
          : "";
  const projectError =
    values.transaction_type === "project_issue" && !values.project_id
      ? "Project is required for project issue."
      : "";
  const stockError =
    selectedItem &&
    transactionDecreasesStock(values.transaction_type) &&
    quantity > availableStockNumber(selectedItem)
      ? "Available stock cannot go below zero for this transaction type."
      : "";
  const inactiveProjectIssueError =
    selectedItem &&
    values.transaction_type === "project_issue" &&
    !isActiveInventoryItem(selectedItem)
      ? "Only active items can be issued to projects."
      : "";

  return {
    item_id: requiredError(values.item_id, "Item"),
    quantity: quantityError || stockError || inactiveProjectIssueError,
    project_id: projectError,
  };
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
