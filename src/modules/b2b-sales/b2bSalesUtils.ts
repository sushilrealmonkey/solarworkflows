import { requiredError } from "../crm/crmUtils";
import { numberToInput } from "../quotations/quotationUtils";
import type {
  B2BInventoryItemOption,
  B2BPaymentFormValues,
  B2BSale,
  B2BSaleFormItem,
  B2BSaleFormValues,
  B2BSaleItem,
  B2BSaleStatus,
} from "./types";
import type { SurveyCustomerSummary } from "../site-surveys/types";

export const b2bSaleStatusOptions: B2BSaleStatus[] = [
  "draft",
  "confirmed",
  "dispatched",
  "cancelled",
];

export function todayInput() {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

export function emptyB2BSaleItem(): B2BSaleFormItem {
  return {
    inventory_item_id: "",
    item_name: "",
    description: "",
    quantity: "1",
    unit: "",
    unit_price: "",
    discount_amount: "0",
    gst_percent: "0",
  };
}

export function emptyB2BSaleForm(): B2BSaleFormValues {
  return {
    customer_id: "",
    billing_address: "",
    delivery_address: "",
    gst_number: "",
    sale_date: todayInput(),
    notes: "",
    items: [emptyB2BSaleItem()],
  };
}

export function saleToForm(
  sale: B2BSale,
  items: B2BSaleItem[],
): B2BSaleFormValues {
  return {
    customer_id: sale.customer_id,
    billing_address: sale.billing_address ?? "",
    delivery_address: sale.delivery_address ?? "",
    gst_number: sale.gst_number ?? "",
    sale_date: sale.sale_date ?? todayInput(),
    notes: sale.notes ?? "",
    items:
      items.length > 0
        ? items.map(saleItemToForm)
        : [emptyB2BSaleItem()],
  };
}

export function customerAddressForSale(customer: SurveyCustomerSummary | undefined) {
  if (!customer) {
    return "";
  }

  return [
    customer.address_line_1,
    customer.address_line_2,
    customer.city,
    customer.district,
    customer.state,
    customer.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function applyCustomerSnapshotToSaleForm(
  values: B2BSaleFormValues,
  customer: SurveyCustomerSummary | undefined,
  options: { overwrite?: boolean } = {},
): B2BSaleFormValues {
  if (!customer) {
    return values;
  }

  const address = customerAddressForSale(customer);
  const overwrite = options.overwrite ?? false;

  return {
    ...values,
    customer_id: customer.id,
    billing_address: overwrite || !values.billing_address
      ? address
      : values.billing_address,
    delivery_address: overwrite || !values.delivery_address
      ? address
      : values.delivery_address,
    gst_number: overwrite || !values.gst_number
      ? customer.gst_number ?? ""
      : values.gst_number,
  };
}

export function availableStockQuantity(item: B2BInventoryItemOption | undefined) {
  if (!item) {
    return null;
  }

  const value = item.available_qty ?? item.current_stock;
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) ? quantity : null;
}

export function saleItemToForm(item: B2BSaleItem): B2BSaleFormItem {
  return {
    id: item.id,
    inventory_item_id: item.inventory_item_id,
    item_name: item.item_name,
    description: item.description ?? "",
    quantity: numberToInput(item.quantity) || "1",
    unit: item.unit ?? "",
    unit_price: numberToInput(item.unit_price),
    discount_amount: numberToInput(item.discount_amount) || "0",
    gst_percent: numberToInput(item.gst_percent) || "0",
  };
}

export function inventoryItemToSaleItem(
  item: B2BInventoryItemOption,
  current: B2BSaleFormItem = emptyB2BSaleItem(),
): B2BSaleFormItem {
  const product = item.catalog_product;
  const unitPrice =
    item.current_selling_price === null || item.current_selling_price === undefined
      ? current.unit_price
      : numberToInput(item.current_selling_price);
  const gstPercent =
    item.pricing_gst_percent ??
    product?.gst_percent ??
    (current.gst_percent ? Number(current.gst_percent) : 0);

  return {
    ...current,
    inventory_item_id: item.id,
    item_name: product?.product_name || item.item_name,
    description:
      [
        item.item_code,
        product?.product_code,
        product?.specifications,
        item.brand ?? product?.brand,
        item.model ?? product?.model_number,
      ]
        .filter(Boolean)
        .join(" / ") || current.description,
    unit: item.unit || product?.unit || current.unit,
    unit_price: unitPrice,
    gst_percent: numberToInput(gstPercent) || "0",
  };
}

export function inventoryItemLabel(item: B2BInventoryItemOption) {
  return [
    item.item_code ?? item.catalog_product?.product_code ?? "Item",
    item.catalog_product?.product_name ?? item.item_name,
    item.brand ?? item.catalog_product?.brand,
    item.model ?? item.catalog_product?.model_number,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function saleStatusTone(value: string | null | undefined) {
  if (value === "dispatched") {
    return "green" as const;
  }

  if (value === "cancelled") {
    return "red" as const;
  }

  if (value === "confirmed") {
    return "blue" as const;
  }

  return "neutral" as const;
}

export function draftLineTotal(item: B2BSaleFormItem) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const discountAmount = Number(item.discount_amount || 0);
  const gstPercent = Number(item.gst_percent || 0);
  const grossBase = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0;
  const discount = Number.isFinite(discountAmount)
    ? Math.min(Math.max(discountAmount, 0), grossBase)
    : 0;
  const base = Math.max(grossBase - discount, 0);
  const gst = base * (Number.isFinite(gstPercent) ? gstPercent : 0) / 100;

  return {
    base,
    discount,
    gst,
    gross: base + gst,
  };
}

export function lineGstAmount(item: B2BSaleItem) {
  return Number(item.line_total ?? 0) * Number(item.gst_percent ?? 0) / 100;
}

export function lineGrossAmount(item: B2BSaleItem) {
  return Number(item.line_total ?? 0) + lineGstAmount(item);
}

export function emptyB2BPaymentForm(): B2BPaymentFormValues {
  return {
    amount: "",
    payment_date: todayInput(),
    payment_mode: "bank_transfer",
    reference_number: "",
    bank_name: "",
    notes: "",
    status: "received",
  };
}

export function validateB2BSaleForm(values: B2BSaleFormValues) {
  const errors: Record<string, string> = {
    customer_id: requiredError(values.customer_id, "Business customer"),
    sale_date: requiredError(values.sale_date, "Sale date"),
  };

  values.items.forEach((item, index) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price || 0);
    const discountAmount = Number(item.discount_amount || 0);
    const gstPercent = Number(item.gst_percent || 0);
    const baseAmount =
      Number.isFinite(quantity) && Number.isFinite(unitPrice)
        ? quantity * unitPrice
        : 0;

    if (!item.item_name.trim()) {
      errors[`items.${index}.inventory_item_id`] = "Select an inventory item.";
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors[`items.${index}.quantity`] = "Quantity must be greater than 0.";
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors[`items.${index}.unit_price`] = "Unit price must be 0 or more.";
    }

    if (
      !Number.isFinite(discountAmount) ||
      discountAmount < 0 ||
      discountAmount > Math.max(baseAmount, 0)
    ) {
      errors[`items.${index}.discount_amount`] =
        "Discount must be 0 or less than the line amount.";
    }

    if (!Number.isFinite(gstPercent) || gstPercent < 0) {
      errors[`items.${index}.gst_percent`] = "GST must be 0 or more.";
    }
  });

  return errors;
}

export function validateB2BPaymentForm(values: B2BPaymentFormValues) {
  const amount = Number(values.amount);

  return {
    amount:
      requiredError(values.amount, "Amount") ||
      (!Number.isFinite(amount) || amount < 0 ? "Amount must be 0 or more." : ""),
    payment_date: requiredError(values.payment_date, "Payment date"),
  };
}
