import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  QuotationPackage,
  QuotationPackageFormValues,
} from "./types";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireOrganization(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function commercialCost(value: string) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

function itemPayload(
  quotationPackageId: string,
  values: QuotationPackageFormValues,
) {
  return values.items.map((item, index) => ({
    quotation_package_id: quotationPackageId,
    product_id: item.product_id,
    quantity: Number(item.quantity),
    display_order: index + 1,
  }));
}

async function attachItems(
  packages: Omit<QuotationPackage, "items">[],
): Promise<QuotationPackage[]> {
  if (packages.length === 0) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("quotation_package_items")
    .select("*")
    .in(
      "quotation_package_id",
      packages.map((quotationPackage) => quotationPackage.id),
    )
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const itemsByPackage = new Map<string, QuotationPackage["items"]>();
  (data ?? []).forEach((item) => {
    const packageItems = itemsByPackage.get(item.quotation_package_id) ?? [];
    packageItems.push(item as QuotationPackage["items"][number]);
    itemsByPackage.set(item.quotation_package_id, packageItems);
  });

  return packages.map((quotationPackage) => ({
    ...quotationPackage,
    items: itemsByPackage.get(quotationPackage.id) ?? [],
  }));
}

export async function fetchQuotationPackages(
  profile: UserProfile | null,
  includeInactive = false,
) {
  const client = requireSupabase();
  let query = client
    .from("quotation_packages")
    .select("*")
    .eq("organization_id", requireOrganization(profile))
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return attachItems((data ?? []) as Omit<QuotationPackage, "items">[]);
}

export async function createQuotationPackage(
  profile: UserProfile | null,
  values: QuotationPackageFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("quotation_packages")
    .insert({
      organization_id: requireOrganization(profile),
      name: values.name.trim(),
      description: nullable(values.description),
      commercial_cost: commercialCost(values.commercial_cost),
      is_active: values.is_active,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const { error: itemError } = await client
    .from("quotation_package_items")
    .insert(itemPayload(data.id, values));
  if (itemError) {
    await client.from("quotation_packages").delete().eq("id", data.id);
    throw new Error(itemError.message);
  }

  return data as Omit<QuotationPackage, "items">;
}

export async function updateQuotationPackage(
  profile: UserProfile | null,
  packageId: string,
  values: QuotationPackageFormValues,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);
  const { data, error } = await client
    .from("quotation_packages")
    .update({
      name: values.name.trim(),
      description: nullable(values.description),
      commercial_cost: commercialCost(values.commercial_cost),
      is_active: values.is_active,
    })
    .eq("id", packageId)
    .eq("organization_id", organizationId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const { error: deleteError } = await client
    .from("quotation_package_items")
    .delete()
    .eq("quotation_package_id", packageId)
    .eq("organization_id", organizationId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { error: itemError } = await client
    .from("quotation_package_items")
    .insert(itemPayload(packageId, values));
  if (itemError) {
    throw new Error(itemError.message);
  }

  return data as Omit<QuotationPackage, "items">;
}
