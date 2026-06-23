import { supabase } from "../../services/supabaseClient";
import type {
  CatalogLibraryBrand,
  CatalogLibraryBrandFormValues,
  CatalogLibraryCategory,
  CatalogLibraryCategoryFormValues,
  CatalogLibraryImportResult,
} from "./types";

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

function orderValue(value: string) {
  const nextValue = Number(value);
  return Number.isInteger(nextValue) && nextValue > 0 ? nextValue : 999;
}

function categoryPayload(values: CatalogLibraryCategoryFormValues) {
  return {
    name: values.name.trim(),
    category_type: values.category_type,
    display_order: orderValue(values.display_order),
    description: nullable(values.description),
    is_active: values.is_active,
  };
}

function brandPayload(values: CatalogLibraryBrandFormValues) {
  return {
    name: values.name.trim(),
    display_order: orderValue(values.display_order),
    is_active: values.is_active,
  };
}

export async function fetchCatalogLibraryCategories() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_categories")
    .select("*")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CatalogLibraryCategory[];
}

export async function fetchCatalogLibraryBrands() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_brands")
    .select("*")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CatalogLibraryBrand[];
}

export async function createCatalogLibraryCategory(
  values: CatalogLibraryCategoryFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_categories")
    .insert(categoryPayload(values))
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CatalogLibraryCategory;
}

export async function updateCatalogLibraryCategory(
  id: string,
  values: CatalogLibraryCategoryFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_categories")
    .update(categoryPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CatalogLibraryCategory;
}

export async function createCatalogLibraryBrand(
  values: CatalogLibraryBrandFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_brands")
    .insert(brandPayload(values))
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CatalogLibraryBrand;
}

export async function updateCatalogLibraryBrand(
  id: string,
  values: CatalogLibraryBrandFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("catalog_library_brands")
    .update(brandPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CatalogLibraryBrand;
}

export async function importCatalogLibraryDefaults() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("import_catalog_library_defaults");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? {}) as CatalogLibraryImportResult;
}
