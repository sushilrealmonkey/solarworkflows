import { supabase } from "../../services/supabaseClient";
import type {
  ProductBankImportResult,
  ProductBankProduct,
  ProductBankProductFormValues,
} from "./types";

type ProductBankPublicRow = {
  product_data: ProductBankProduct;
};

type ProductBankPublicPageRow = ProductBankPublicRow & {
  total_count: number | string;
};

export type ProductBankPageFilters = {
  search?: string;
  categoryId?: string;
  brand?: string;
};

export type ProductBankPage = {
  products: ProductBankProduct[];
  total: number;
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nonNegativeNumber(value: string) {
  if (!value.trim()) return 0;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function productBankPayload(values: ProductBankProductFormValues) {
  return {
    category_id: values.category_id,
    product_name: values.product_name.trim(),
    brand: nullable(values.brand),
    model_number: nullable(values.model_number),
    specifications: nullable(values.specifications),
    unit: values.unit,
    hsn_code: nullable(values.hsn_code),
    gst_percent: nonNegativeNumber(values.gst_percent),
    warranty_description: nullable(values.warranty_description),
    notes: nullable(values.notes),
    publication_status: values.publication_status,
  };
}

export async function fetchProductBankProducts() {
  const client = requireSupabase();
  const pageSize = 1_000;
  const rows: ProductBankPublicRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .rpc("product_bank_public_rows")
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as ProductBankPublicRow[];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows.map(
    (row) => row.product_data,
  );
}

/** Fetches only the rows required for the visible Product Bank page. */
export async function fetchProductBankPage(
  filters: ProductBankPageFilters,
  page: number,
  pageSize = 50,
): Promise<ProductBankPage> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const { data, error } = await requireSupabase().rpc("product_bank_public_page", {
    p_search: filters.search?.trim() || null,
    p_category_id: filters.categoryId || null,
    p_brand: filters.brand || null,
    p_limit: safePageSize,
    p_offset: (safePage - 1) * safePageSize,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ProductBankPublicPageRow[];
  return {
    products: rows.map((row) => row.product_data),
    total: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function createProductBankProduct(
  values: ProductBankProductFormValues,
) {
  const { data, error } = await requireSupabase()
    .from("catalog_library_products")
    .insert(productBankPayload(values))
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string };
}

export async function updateProductBankProduct(
  id: string,
  values: ProductBankProductFormValues,
) {
  const { error } = await requireSupabase()
    .from("catalog_library_products")
    .update(productBankPayload(values))
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function importProductBankProducts(productBankIds: string[]) {
  const { data, error } = await requireSupabase().rpc(
    "import_product_bank_products",
    { target_product_bank_ids: productBankIds },
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductBankImportResult[];
}
