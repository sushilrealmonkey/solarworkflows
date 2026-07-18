import type {
  Product,
  ProductCategory,
  ProductCategoryType,
} from "../product-master/types";
import type { QuotationMaterialItem } from "./types";

type QuotationBomTemplateCategory = {
  key: string;
  label: string;
  categoryTypes: ProductCategoryType[];
  categoryAliases: string[];
  productKeywords: string[];
};

export const quotationBomTemplateCategories: QuotationBomTemplateCategory[] = [
  {
    key: "solar-panel",
    label: "Solar Panel",
    categoryTypes: ["SOLAR_PANEL"],
    categoryAliases: ["Solar Panel", "Solar Panels"],
    productKeywords: ["panel", "module"],
  },
  {
    key: "inverter",
    label: "Inverter",
    categoryTypes: ["INVERTER"],
    categoryAliases: ["Inverter", "Inverters"],
    productKeywords: ["inverter"],
  },
  {
    key: "structure",
    label: "Structure",
    categoryTypes: ["STRUCTURE"],
    categoryAliases: [
      "Structure",
      "Structures",
      "Mounting Structure",
      "Mounting Structures",
    ],
    productKeywords: ["structure", "mounting"],
  },
  {
    key: "dc-cable",
    label: "DC Cable",
    categoryTypes: ["DC_CABLE"],
    categoryAliases: ["DC Cable", "DC Cables"],
    productKeywords: ["dc cable"],
  },
  {
    key: "ac-cable",
    label: "AC Cable",
    categoryTypes: ["AC_CABLE"],
    categoryAliases: ["AC Cable", "AC Cables"],
    productKeywords: ["ac cable"],
  },
  {
    key: "earthing-kit",
    label: "Earthing Kit",
    categoryTypes: ["EARTHING"],
    categoryAliases: [
      "Earthing Kit",
      "Earthing",
      "Earthing Material",
      "Earthing Materials",
    ],
    productKeywords: ["earth"],
  },
  {
    key: "acdb",
    label: "ACDB",
    categoryTypes: ["PROTECTION_DEVICE"],
    categoryAliases: ["ACDB", "ACDB / DCDB", "Protection Devices"],
    productKeywords: ["acdb"],
  },
  {
    key: "dcdb",
    label: "DCDB",
    categoryTypes: ["PROTECTION_DEVICE"],
    categoryAliases: ["DCDB", "ACDB / DCDB", "Protection Devices"],
    productKeywords: ["dcdb"],
  },
  {
    key: "solar-meter",
    label: "Solar Meter",
    categoryTypes: ["MONITORING_DEVICE"],
    categoryAliases: [
      "Solar Meter",
      "Solar Meters",
      "Metering Equipment",
      "Monitoring Devices",
    ],
    productKeywords: ["meter"],
  },
  {
    key: "pvc-products",
    label: "PVC Products",
    categoryTypes: ["ACCESSORY", "OTHER"],
    categoryAliases: ["PVC Products", "PVC Product", "PVC"],
    productKeywords: ["pvc"],
  },
  {
    key: "hardware-items",
    label: "Hardware items",
    categoryTypes: ["ACCESSORY", "OTHER"],
    categoryAliases: [
      "Hardware items",
      "Hardware Items",
      "Hardware",
      "Connectors & Accessories",
      "Connectors and Accessories",
    ],
    productKeywords: [
      "hardware",
      "nut",
      "bolt",
      "screw",
      "clamp",
      "fastener",
    ],
  },
];

export function mergeQuotationBomTemplateRows(
  categories: ProductCategory[],
  existingItems: QuotationMaterialItem[],
): QuotationMaterialItem[] {
  const remainingItems = existingItems.slice();

  const templateRows = quotationBomTemplateCategories.map((definition) => {
    const category = matchingCategory(definition, categories);
    const existingIndex = matchingItemIndex(
      definition,
      category,
      remainingItems,
      categories,
    );
    const existingItem =
      existingIndex >= 0 ? remainingItems.splice(existingIndex, 1)[0] : null;

    return {
      ...(existingItem ?? emptyTemplateItem()),
      bom_category_key: definition.key,
      bom_category_name: definition.label,
      product_category_id:
        existingItem?.product_id
          ? existingItem.product_category_id || category?.id || ""
          : category?.id || existingItem?.product_category_id || "",
    };
  });

  return [...templateRows, ...remainingItems];
}

export function productsForQuotationBomRow(
  item: QuotationMaterialItem,
  products: Product[],
  categories: ProductCategory[],
) {
  const definition = quotationBomTemplateCategories.find(
    (candidate) => candidate.key === item.bom_category_key,
  );
  const selectedCategory = categories.find(
    (category) => category.id === item.product_category_id,
  );
  const preferredCategory = definition
    ? matchingCategory(definition, categories)
    : null;
  const matchingTypes = definition?.categoryTypes ??
    (selectedCategory ? [selectedCategory.category_type] : []);
  const categoryId = item.product_id
    ? item.product_category_id
    : preferredCategory?.id || item.product_category_id;
  const categoryPool = categoryId
    ? products.filter((product) => product.category_id === categoryId)
    : products.filter((product) => matchingTypes.includes(product.category_type));

  if (!definition || definition.productKeywords.length === 0) {
    return categoryPool;
  }

  const keywordMatches = categoryPool.filter((product) =>
    definition.productKeywords.some((keyword) =>
      normalize(product.product_name).includes(normalize(keyword)),
    ),
  );

  return keywordMatches.length > 0 ? keywordMatches : categoryPool;
}

function matchingCategory(
  definition: QuotationBomTemplateCategory,
  categories: ProductCategory[],
) {
  for (const alias of definition.categoryAliases) {
    const exactMatch = categories.find(
      (category) => normalize(category.name) === normalize(alias),
    );

    if (exactMatch) {
      return exactMatch;
    }
  }

  return (
    categories.find((category) =>
      definition.categoryTypes.includes(category.category_type),
    ) ??
    null
  );
}

function matchingItemIndex(
  definition: QuotationBomTemplateCategory,
  category: ProductCategory | null,
  items: QuotationMaterialItem[],
  categories: ProductCategory[],
) {
  const taggedIndex = items.findIndex(
    (item) => item.bom_category_key === definition.key,
  );
  if (taggedIndex >= 0) {
    return taggedIndex;
  }

  const keywordIndex = items.findIndex((item) =>
    definition.productKeywords.some((keyword) =>
      normalize(item.description).includes(normalize(keyword)),
    ),
  );
  if (keywordIndex >= 0) {
    return keywordIndex;
  }

  const aliasSet = new Set(definition.categoryAliases.map(normalize));
  const aliasIndex = items.findIndex((item) => {
    const itemCategory = categories.find(
      (candidate) => candidate.id === item.product_category_id,
    );
    return Boolean(itemCategory && aliasSet.has(normalize(itemCategory.name)));
  });
  if (aliasIndex >= 0) {
    return aliasIndex;
  }

  return category
    ? items.findIndex((item) => item.product_category_id === category.id)
    : -1;
}

function emptyTemplateItem(): QuotationMaterialItem {
  return {
    inventory_item_id: "",
    product_category_id: "",
    product_id: "",
    hsn_code: "",
    description: "",
    brand: "",
    specification: "",
    make_specification: "",
    quantity: "",
    unit: "",
  };
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
