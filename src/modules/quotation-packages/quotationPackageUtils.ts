import type {
  QuotationPackage,
  QuotationPackageFormValues,
} from "./types";

export function emptyQuotationPackageForm(): QuotationPackageFormValues {
  return {
    name: "",
    description: "",
    commercial_cost: "",
    is_active: true,
    items: [{ product_id: "", quantity: "1" }],
  };
}

export function quotationPackageToForm(
  quotationPackage: QuotationPackage,
): QuotationPackageFormValues {
  return {
    name: quotationPackage.name,
    description: quotationPackage.description ?? "",
    commercial_cost: String(quotationPackage.commercial_cost ?? 0),
    is_active: quotationPackage.is_active !== false,
    items: quotationPackage.items.map((item) => ({
      product_id: item.product_id,
      quantity: String(item.quantity),
    })),
  };
}

export function validateQuotationPackageForm(values: QuotationPackageFormValues) {
  const errors: Record<string, string> = {};
  const cost = Number(values.commercial_cost);

  if (!values.name.trim()) {
    errors.name = "Enter a package name.";
  }

  if (!values.commercial_cost.trim() || !Number.isFinite(cost) || cost < 0) {
    errors.commercial_cost = "Enter a valid commercial cost.";
  }

  if (values.items.length === 0) {
    errors.items = "Add at least one product.";
  }

  const selectedProducts = new Set<string>();
  values.items.forEach((item, index) => {
    const quantity = Number(item.quantity);

    if (!item.product_id) {
      errors[`item-${index}-product_id`] = "Select a product.";
    } else if (selectedProducts.has(item.product_id)) {
      errors[`item-${index}-product_id`] = "Add each product only once.";
    } else {
      selectedProducts.add(item.product_id);
    }

    if (!item.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      errors[`item-${index}-quantity`] = "Enter a quantity greater than zero.";
    }
  });

  return errors;
}
