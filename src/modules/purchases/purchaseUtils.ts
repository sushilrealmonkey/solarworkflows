import { requiredError } from "../crm/crmUtils";
import type { InventoryItem } from "../inventory/types";
import type {
  PurchaseOrderFormValues,
  PurchaseOrderItemFormValues,
  PurchaseOrderWithRelations,
  PurchaseReceiveFormValues,
  PurchaseReceiveItemFormValues,
  PurchaseStatus,
} from "./types";

export type PurchasePriceDefaults = {
  current_purchase_price: number | null;
  gst_percent: number | null;
};

export const purchaseStatusOptions: PurchaseStatus[] = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
];

export function emptyPurchaseItemForm(
  item?: InventoryItem,
  price?: PurchasePriceDefaults | null,
): PurchaseOrderItemFormValues {
  return {
    item_id: item?.id ?? "",
    quantity: "1",
    unit_price: String(price?.current_purchase_price ?? 0),
    gst_percent: String(price?.gst_percent ?? item?.catalog_product?.gst_percent ?? 0),
  };
}

export function emptyPurchaseOrderForm(): PurchaseOrderFormValues {
  return {
    vendor_id: "",
    order_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: "",
    notes: "",
    items: [emptyPurchaseItemForm()],
  };
}

export function purchaseOrderToForm(
  order: PurchaseOrderWithRelations,
): PurchaseOrderFormValues {
  return {
    vendor_id: order.vendor_id,
    order_date: order.order_date ?? new Date().toISOString().slice(0, 10),
    expected_delivery_date: order.expected_delivery_date ?? "",
    notes: order.notes ?? "",
    items:
      order.items && order.items.length > 0
        ? order.items.map((item) => ({
            id: item.id,
            item_id: item.item_id,
            quantity: String(item.quantity ?? 1),
            unit_price: String(item.unit_price ?? 0),
            gst_percent: String(item.gst_percent ?? 0),
          }))
        : [emptyPurchaseItemForm()],
  };
}

export function calculatePurchaseItemTotal(item: PurchaseOrderItemFormValues) {
  const quantity = numberValue(item.quantity);
  const unitPrice = numberValue(item.unit_price);
  const gstPercent = numberValue(item.gst_percent);
  const subtotal = quantity * unitPrice;
  const gstAmount = subtotal * (gstPercent / 100);

  return {
    subtotal,
    gstAmount,
    total: subtotal + gstAmount,
  };
}

export function calculatePurchaseTotals(values: PurchaseOrderFormValues) {
  return values.items.reduce(
    (totals, item) => {
      const next = calculatePurchaseItemTotal(item);
      return {
        subtotal: totals.subtotal + next.subtotal,
        gstAmount: totals.gstAmount + next.gstAmount,
        total: totals.total + next.total,
      };
    },
    { subtotal: 0, gstAmount: 0, total: 0 },
  );
}

export function validatePurchaseOrderForm(values: PurchaseOrderFormValues) {
  const itemErrors = values.items.map(validatePurchaseItemForm);
  return {
    vendor_id: requiredError(values.vendor_id, "Supplier"),
    items: values.items.length === 0 ? "At least one item is required." : "",
    itemErrors,
  };
}

export function hasPurchaseOrderFormErrors(
  errors: ReturnType<typeof validatePurchaseOrderForm>,
) {
  return (
    Boolean(errors.vendor_id || errors.items) ||
    errors.itemErrors.some((item) => Object.values(item).some(Boolean))
  );
}

export function numberValue(value: string, fallback = 0) {
  if (!value.trim()) {
    return fallback;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

export function formatPurchaseCode(value: string | null | undefined) {
  return value ?? "Purchase Order";
}

export function emptyPurchaseReceiveForm(
  order: PurchaseOrderWithRelations,
): PurchaseReceiveFormValues {
  return {
    bill_no: "",
    received_date: new Date().toISOString().slice(0, 10),
    notes: "",
    items: (order.items ?? [])
      .map((item) => {
        const orderedQuantity = Number(item.quantity ?? 0);
        const alreadyReceivedQuantity = Number(item.received_quantity ?? 0);
        const pendingQuantity = Math.max(
          orderedQuantity - alreadyReceivedQuantity,
          0,
        );

        return {
          purchase_order_item_id: item.id,
          item_name: item.item?.item_name ?? "Inventory item",
          ordered_quantity: orderedQuantity,
          already_received_quantity: alreadyReceivedQuantity,
          received_quantity: pendingQuantity > 0 ? String(pendingQuantity) : "0",
          actual_unit_purchase_price: String(item.unit_price ?? 0),
          gst_percent: String(item.gst_percent ?? 0),
          update_current_purchase_price: false,
        };
      })
      .filter((item) => item.ordered_quantity > item.already_received_quantity),
  };
}

export function validatePurchaseReceiveForm(values: PurchaseReceiveFormValues) {
  const itemErrors = values.items.map(validatePurchaseReceiveItemForm);
  const hasPositiveQuantity = values.items.some(
    (item) => numberValue(item.received_quantity) > 0,
  );

  return {
    received_date: requiredError(values.received_date, "Received date"),
    items: hasPositiveQuantity ? "" : "At least one received quantity is required.",
    itemErrors,
  };
}

export function hasPurchaseReceiveFormErrors(
  errors: ReturnType<typeof validatePurchaseReceiveForm>,
) {
  return (
    Boolean(errors.received_date || errors.items) ||
    errors.itemErrors.some((item) => Object.values(item).some(Boolean))
  );
}

function validatePurchaseItemForm(values: PurchaseOrderItemFormValues) {
  const quantity = numberValue(values.quantity);
  const unitPrice = numberValue(values.unit_price);
  const gstPercent = numberValue(values.gst_percent);

  return {
    item_id: requiredError(values.item_id, "Item"),
    quantity: quantity > 0 ? "" : "Quantity must be greater than zero.",
    unit_price: unitPrice >= 0 ? "" : "Unit price cannot be negative.",
    gst_percent: gstPercent >= 0 ? "" : "GST percent cannot be negative.",
  };
}

function validatePurchaseReceiveItemForm(values: PurchaseReceiveItemFormValues) {
  const quantity = numberValue(values.received_quantity);
  const unitPrice = numberValue(values.actual_unit_purchase_price);
  const gstPercent = numberValue(values.gst_percent);
  const pendingQuantity = Math.max(
    values.ordered_quantity - values.already_received_quantity,
    0,
  );

  return {
    received_quantity:
      quantity < 0
        ? "Received quantity cannot be negative."
        : quantity > pendingQuantity
          ? "Received quantity cannot exceed pending quantity."
          : "",
    actual_unit_purchase_price:
      unitPrice >= 0 ? "" : "Unit price cannot be negative.",
    gst_percent: gstPercent >= 0 ? "" : "GST percent cannot be negative.",
  };
}
