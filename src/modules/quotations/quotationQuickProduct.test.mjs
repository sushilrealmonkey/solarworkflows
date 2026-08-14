import assert from "node:assert/strict";
import test from "node:test";
import {
  quotationMaterialItemWithProduct,
  quotationQuickProductIdentificationError,
  quotationQuickProductIdentificationMessage,
} from "./quotationQuickProduct.ts";

test("quotation quick product accepts brand, model, and specifications", () => {
  assert.equal(
    quotationQuickProductIdentificationError({
      brand: "Waaree",
      model_number: "WS-550",
      specifications: "550 W Mono PERC",
    }),
    "",
  );
});

test("quotation quick product accepts specifications only", () => {
  assert.equal(
    quotationQuickProductIdentificationError({
      brand: "",
      model_number: "",
      specifications: "4 sq mm copper DC cable",
    }),
    "",
  );
});

test("quotation quick product rejects blank identifying details", () => {
  assert.equal(
    quotationQuickProductIdentificationError({
      brand: "  ",
      model_number: "",
      specifications: "\t",
    }),
    quotationQuickProductIdentificationMessage,
  );
});

test("created product maps into its BOM row without replacing unrelated draft data", () => {
  const originalItem = {
    inventory_item_id: "old-inventory",
    product_category_id: "panel-category",
    product_id: "",
    hsn_code: "",
    description: "",
    brand: "",
    specification: "",
    make_specification: "",
    quantity: "12",
    unit: "",
    bom_category_key: "solar_panel",
    bom_category_name: "Solar Panel",
  };
  const createdProduct = {
    id: "new-product",
    category_id: "panel-category",
    product_name: "Waaree Solar Panel WS-550 550 W Mono PERC",
    brand: "Waaree",
    model_number: "WS-550",
    specifications: "550 W Mono PERC",
    hsn_code: "85414300",
    unit: "piece",
  };

  const selectedItem = quotationMaterialItemWithProduct(
    originalItem,
    createdProduct.id,
    [createdProduct],
  );

  assert.deepEqual(
    {
      product_id: selectedItem.product_id,
      description: selectedItem.description,
      brand: selectedItem.brand,
      specification: selectedItem.specification,
      hsn_code: selectedItem.hsn_code,
      unit: selectedItem.unit,
    },
    {
      product_id: "new-product",
      description: "Waaree Solar Panel WS-550 550 W Mono PERC",
      brand: "Waaree",
      specification: "550 W Mono PERC",
      hsn_code: "85414300",
      unit: "piece",
    },
  );
  assert.equal(selectedItem.quantity, "12");
  assert.equal(selectedItem.bom_category_key, "solar_panel");
  assert.equal(selectedItem.bom_category_name, "Solar Panel");
});
