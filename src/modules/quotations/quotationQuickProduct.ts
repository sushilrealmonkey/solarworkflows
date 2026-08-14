import type { Product, ProductFormValues } from "../product-master/types";
import type { QuotationMaterialItem } from "./types";

export const quotationQuickProductIdentificationMessage =
  "Add a brand, model or specification to identify this product.";

export function quotationQuickProductIdentificationError(
  values: Pick<
    ProductFormValues,
    "brand" | "model_number" | "specifications"
  >,
) {
  const hasIdentifyingDetail = [
    values.brand,
    values.model_number,
    values.specifications,
  ].some((value) => value.trim().length > 0);

  return hasIdentifyingDetail
    ? ""
    : quotationQuickProductIdentificationMessage;
}

export function quotationMaterialItemWithProduct(
  item: QuotationMaterialItem,
  productId: string,
  products: Product[],
): QuotationMaterialItem {
  const product = products.find((candidate) => candidate.id === productId);

  if (!product) {
    return {
      ...item,
      product_id: "",
      inventory_item_id: "",
      hsn_code: "",
      description: "",
      brand: "",
      specification: "",
      make_specification: "",
      unit: "",
    };
  }

  const specification = product.specifications ?? product.model_number ?? "";

  return {
    ...item,
    product_category_id: product.category_id,
    product_id: product.id,
    inventory_item_id: "",
    hsn_code: product.hsn_code ?? "",
    description: product.product_name,
    brand: product.brand ?? "",
    specification,
    make_specification:
      [product.brand, specification].filter(Boolean).join(" / ") ||
      item.make_specification,
    unit: product.unit,
  };
}
