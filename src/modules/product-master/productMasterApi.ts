import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
  ProductFormValues,
  ProductPrice,
  ProductPriceFormValues,
  ProductPriceHistory,
  ProductStatus,
  ProductUsageSummary,
} from "./types";
import { importCatalogLibraryDefaults } from "../catalog-library/catalogLibraryApi";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireTenant(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: string, fallback = 0) {
  if (!value.trim()) {
    return fallback;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function productPayload(values: ProductFormValues) {
  return {
    category_id: values.category_id,
    product_name: values.product_name.trim(),
    hsn_code: nullable(values.hsn_code),
    brand: nullable(values.brand),
    model_number: nullable(values.model_number),
    specifications: nullable(values.specifications),
    unit: values.unit,
    gst_percent: numberValue(values.gst_percent),
    warranty_description: nullable(values.warranty_description),
    status: values.status,
    notes: nullable(values.notes),
  };
}

function categoryPayload(
  values: ProductCategoryFormValues,
  includeCategoryType: boolean,
) {
  return {
    name: values.name.trim(),
    description: nullable(values.description),
    display_order: Number(values.display_order),
    ...(includeCategoryType ? { category_type: values.category_type } : {}),
  };
}

const productSelect = `
  id,
  tenant_id,
  product_code,
  product_name,
  category_id,
  category_type,
  hsn_code,
  brand,
  model_number,
  specifications,
  unit,
  gst_percent,
  warranty_description,
  status,
  notes,
  created_at,
  updated_at,
  category:product_categories(id, name, category_type, display_order)
`;

type ProductCategoryPublicRow = {
  category_data: ProductCategory;
};

type ProductPublicRow = {
  product_data: Product;
};

function redactLegacyProductPricing(product: Product): Product {
  return {
    ...product,
    purchase_price: null,
    selling_price: null,
    minimum_stock_alert: product.minimum_stock_alert ?? null,
  };
}

function isMissingPricingStoreError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    message.includes("product_prices") ||
    message.includes("product_price_history") ||
    message.includes("update_product_price")
  );
}

function legacyProductPrice(product: Pick<
  Product,
  "id" | "tenant_id" | "purchase_price" | "selling_price" | "gst_percent" | "created_at" | "updated_at"
>): ProductPrice {
  return {
    id: `legacy-${product.id}`,
    company_id: null,
    organization_id: product.tenant_id,
    product_id: product.id,
    current_purchase_price: product.purchase_price ?? 0,
    current_selling_price: product.selling_price ?? 0,
    gst_percent: product.gst_percent ?? 0,
    effective_date: new Date().toISOString().slice(0, 10),
    created_by: null,
    updated_by: null,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

export async function fetchProductCategories(profile: UserProfile | null) {
  const client = requireSupabase();
  void profile;

  const { data, error } = await client.rpc("product_category_public_rows");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ProductCategoryPublicRow[]).map(
    (row) => row.category_data,
  );
}

export async function createProductCategory(
  profile: UserProfile | null,
  values: ProductCategoryFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("product_categories")
    .insert({
      tenant_id: requireTenant(profile),
      ...categoryPayload(values, true),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductCategory;
}

export async function updateProductCategory(
  profile: UserProfile | null,
  id: string,
  values: ProductCategoryFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("product_categories")
    .update(categoryPayload(values, Boolean(profile?.is_super_admin)))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProductCategory;
}

export async function fetchProducts(profile: UserProfile | null) {
  const client = requireSupabase();
  void profile;

  const { data, error } = await client.rpc("product_catalog_public_rows");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ProductPublicRow[]).map((row) =>
    redactLegacyProductPricing(row.product_data),
  );
}

export async function fetchProductBrandSuggestions(
  profile: UserProfile | null,
) {
  const client = requireSupabase();
  let productBrandQuery = client
    .from("products")
    .select("brand")
    .not("brand", "is", null)
    .order("brand", { ascending: true });

  if (!profile?.is_super_admin) {
    productBrandQuery = productBrandQuery.eq("tenant_id", requireTenant(profile));
  } else if (profile.organization_id) {
    productBrandQuery = productBrandQuery.eq("tenant_id", profile.organization_id);
  }

  const [productBrandsResult, catalogBrandsResult] = await Promise.all([
    productBrandQuery,
    client
      .from("catalog_library_brands")
      .select("name")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (productBrandsResult.error) {
    throw new Error(productBrandsResult.error.message);
  }

  if (catalogBrandsResult.error) {
    throw new Error(catalogBrandsResult.error.message);
  }

  const names = [
    ...(catalogBrandsResult.data ?? []).map((brand) => brand.name),
    ...(productBrandsResult.data ?? []).map((product) => product.brand),
  ];

  return uniqueNames(names);
}

export async function importProductCatalogDefaults() {
  return importCatalogLibraryDefaults();
}

export async function fetchProduct(profile: UserProfile | null, id: string) {
  const products = await fetchProducts(profile);

  return products.find((product) => product.id === id) ?? null;
}

export async function createProduct(
  profile: UserProfile | null,
  values: ProductFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("products")
    .insert({
      tenant_id: requireTenant(profile),
      ...productPayload(values),
    })
    .select(productSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return redactLegacyProductPricing(data as unknown as Product);
}

export async function updateProduct(
  id: string,
  values: ProductFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("products")
    .update(productPayload(values))
    .eq("id", id)
    .select(productSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return redactLegacyProductPricing(data as unknown as Product);
}

export async function updateProductStatus(
  id: string,
  status: ProductStatus,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("products")
    .update({ status })
    .eq("id", id)
    .select(productSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return redactLegacyProductPricing(data as unknown as Product);
}

export async function fetchProductPrices(products: Product[]) {
  const client = requireSupabase();
  const productIds = products.map((product) => product.id);

  if (productIds.length === 0) {
    return new Map<string, ProductPrice>();
  }

  const { data, error } = await client
    .from("product_prices")
    .select("*")
    .in("product_id", productIds);

  if (error) {
    if (isMissingPricingStoreError(error)) {
      return new Map(
        products.map((product) => [product.id, legacyProductPrice(product)]),
      );
    }

    throw new Error(error.message);
  }

  const priceMap = new Map(
    ((data ?? []) as ProductPrice[]).map((price) => [
      price.product_id,
      price,
    ]),
  );

  products.forEach((product) => {
    if (!priceMap.has(product.id)) {
      priceMap.set(product.id, legacyProductPrice(product));
    }
  });

  return priceMap;
}

export async function fetchProductPrice(productId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("product_prices")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();

  if (error) {
    if (isMissingPricingStoreError(error)) {
      const { data: productData, error: productError } = await client
        .from("products")
        .select(productSelect)
        .eq("id", productId)
        .maybeSingle();

      if (productError) {
        throw new Error(productError.message);
      }

      return productData
        ? legacyProductPrice(
            redactLegacyProductPricing(productData as unknown as Product),
          )
        : null;
    }

    throw new Error(error.message);
  }

  if (data) {
    return data as ProductPrice;
  }

  const { data: productData, error: productError } = await client
    .from("products")
    .select(productSelect)
    .eq("id", productId)
    .maybeSingle();

  if (productError) {
    throw new Error(productError.message);
  }

  return productData
    ? legacyProductPrice(
        redactLegacyProductPricing(productData as unknown as Product),
      )
    : null;
}

export async function fetchProductPriceHistory(productId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("product_price_history")
    .select("*")
    .eq("product_id", productId)
    .order("changed_at", { ascending: false });

  if (error) {
    if (isMissingPricingStoreError(error)) {
      return [];
    }

    throw new Error(error.message);
  }

  return (data ?? []) as ProductPriceHistory[];
}

export async function saveProductPrice(
  productId: string,
  values: ProductPriceFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_product_price", {
    target_product_id: productId,
    new_purchase_price: numberValue(values.current_purchase_price),
    new_selling_price: numberValue(values.current_selling_price),
    new_gst_percent: numberValue(values.gst_percent),
    new_effective_date:
      values.effective_date || new Date().toISOString().slice(0, 10),
  });

  if (error) {
    if (isMissingPricingStoreError(error)) {
      const { data: productData, error: productError } = await client
        .from("products")
        .update({
          purchase_price: numberValue(values.current_purchase_price),
          selling_price: numberValue(values.current_selling_price),
          gst_percent: numberValue(values.gst_percent),
        })
        .eq("id", productId)
        .select(productSelect)
        .single();

      if (productError) {
        throw new Error(productError.message);
      }

      return legacyProductPrice(
        redactLegacyProductPricing(productData as unknown as Product),
      );
    }

    throw new Error(error.message);
  }

  return data as ProductPrice;
}

export async function fetchProductUsageSummary(
  profile: UserProfile | null,
  productId: string,
): Promise<ProductUsageSummary> {
  const client = requireSupabase();
  let inventoryQuery = client
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("catalog_product_id", productId);

  if (!profile?.is_super_admin) {
    inventoryQuery = inventoryQuery.eq("organization_id", requireTenant(profile));
  } else if (profile.organization_id) {
    inventoryQuery = inventoryQuery.eq("organization_id", profile.organization_id);
  }

  const { count, error } = await inventoryQuery;

  if (error) {
    throw new Error(error.message);
  }

  return {
    inventory: count ?? 0,
    quotations: 0,
    purchaseOrders: 0,
    projects: 0,
  };
}

function uniqueNames(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values.reduce<string[]>((options, value) => {
    const trimmed = value?.trim();

    if (!trimmed) {
      return options;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      return options;
    }

    seen.add(key);
    options.push(trimmed);

    return options;
  }, []);
}
