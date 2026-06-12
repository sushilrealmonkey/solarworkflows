import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  InventoryItem,
  InventoryBatch,
  InventoryItemFormValues,
  InventoryCatalogProduct,
  InventoryMasterOption,
  InventoryMasters,
  InventoryProjectOption,
  InventoryTransaction,
  InventoryTransactionFormValues,
  InventoryTransactionWithRelations,
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
  return trimmed ? trimmed : null;
}

function nullableUuid(value: string) {
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

function dateValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function ensureUniqueInventoryProduct(
  organizationId: string,
  catalogProductId: string,
  ignoreItemId?: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("catalog_product_id", catalogProductId)
    .eq("status", "active")
    .limit(1);

  if (ignoreItemId) {
    query = query.neq("id", ignoreItemId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if ((data ?? []).length > 0) {
    throw new Error("This inventory item already exists. Please update stock instead.");
  }
}

function itemPayload(values: InventoryItemFormValues) {
  return {
    catalog_product_id: nullableUuid(values.catalog_product_id),
    product_id: null,
    brand_id: null,
    model_id: null,
    vendor_id: nullableUuid(values.vendor_id),
    current_stock: numberValue(values.current_stock),
    opening_stock: numberValue(values.opening_stock),
    minimum_stock: numberValue(values.minimum_alert),
    status: values.status,
    bill_no: nullable(values.bill_no),
    inventory_date: dateValue(values.inventory_date),
    notes: nullable(values.notes),
  };
}

function transactionPayload(values: InventoryTransactionFormValues) {
  return {
    item_id: values.item_id,
    project_id: nullableUuid(values.project_id),
    transaction_type: values.transaction_type,
    quantity: numberValue(values.quantity),
    transaction_date: values.transaction_date || new Date().toISOString().slice(0, 10),
    reference_type: nullable(values.reference_type),
    reference_id: nullableUuid(values.reference_id),
    notes: nullable(values.notes),
  };
}

const inventoryTransactionSelect = `
  *,
  item:inventory_items(id, item_code, item_name, unit, current_stock, minimum_stock),
  project:projects(id, project_code, project_name),
  creator:users_profile!inventory_transactions_created_by_fkey(id, full_name, email, phone)
`;

const inventoryProductSelect = `
  id,
  tenant_id,
  product_code,
  product_name,
  category_id,
  category_type,
  hsn_code,
  product_type_id,
  brand,
  model_number,
  specifications,
  unit,
  gst_percent,
  status,
  category:product_categories(id, name, category_type, display_order),
  product_type:product_types(id, name, category_id, display_order, is_active)
`;

const inventoryItemSelect = `
  *,
  catalog_product:products(${inventoryProductSelect}),
  vendor_master:vendors_master(id, name)
`;

type InventoryReservationSummaryRow = {
  inventory_item_id: string | null;
  reserved_qty: number | null;
  shortage_qty: number | null;
  status: string | null;
};

function withReservationTotals(
  items: InventoryItem[],
  reservationRows: InventoryReservationSummaryRow[],
) {
  const totals = new Map<
    string,
    { reserved_qty: number; shortage_qty: number }
  >();

  reservationRows.forEach((row) => {
    if (!row.inventory_item_id) {
      return;
    }

    const current = totals.get(row.inventory_item_id) ?? {
      reserved_qty: 0,
      shortage_qty: 0,
    };
    const reservedQty = Number(row.reserved_qty ?? 0);
    const shortageQty = Number(row.shortage_qty ?? 0);

    if (row.status === "active" || row.status === "partial") {
      current.reserved_qty += Number.isFinite(reservedQty) ? reservedQty : 0;
    }

    if (row.status === "partial" || row.status === "shortage") {
      current.shortage_qty += Number.isFinite(shortageQty) ? shortageQty : 0;
    }

    totals.set(row.inventory_item_id, current);
  });

  return items.map((item) => {
    const itemTotals = totals.get(item.id) ?? {
      reserved_qty: 0,
      shortage_qty: 0,
    };
    const currentStock = Number(item.current_stock ?? 0);

    return {
      ...item,
      reserved_qty: itemTotals.reserved_qty,
      available_qty: Math.max(currentStock - itemTotals.reserved_qty, 0),
      shortage_qty: itemTotals.shortage_qty,
    };
  });
}

async function attachReservationTotals(items: InventoryItem[]) {
  if (items.length === 0) {
    return items;
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("inventory_reservations")
    .select("inventory_item_id, reserved_qty, shortage_qty, status")
    .in(
      "inventory_item_id",
      items.map((item) => item.id),
    )
    .in("status", ["active", "partial", "shortage"]);

  if (error) {
    return items.map((item) => ({
      ...item,
      reserved_qty: 0,
      available_qty: Number(item.current_stock ?? 0),
      shortage_qty: 0,
    }));
  }

  return withReservationTotals(
    items,
    (data ?? []) as InventoryReservationSummaryRow[],
  );
}

export async function fetchInventoryMasters(profile: UserProfile | null) {
  const client = requireSupabase();
  const organizationId = profile?.organization_id ?? "";
  let productsQuery = client
    .from("products")
    .select(inventoryProductSelect)
    .order("product_name", { ascending: true });
  let categoriesQuery = client
    .from("product_categories")
    .select("id, name, category_type, display_order")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  let vendorsQuery = client
    .from("vendors_master")
    .select("*")
    .order("name", { ascending: true });

  if (!profile?.is_super_admin) {
    const requiredOrganizationId = requireOrganization(profile);
    productsQuery = productsQuery.eq("tenant_id", requiredOrganizationId);
    categoriesQuery = categoriesQuery.eq("tenant_id", requiredOrganizationId);
    vendorsQuery = vendorsQuery.eq("organization_id", requiredOrganizationId);
  } else if (organizationId) {
    productsQuery = productsQuery.eq("tenant_id", organizationId);
    categoriesQuery = categoriesQuery.eq("tenant_id", organizationId);
    vendorsQuery = vendorsQuery.eq("organization_id", organizationId);
  } else {
    vendorsQuery = vendorsQuery.limit(0);
  }

  const [productsResult, categoriesResult, vendorsResult] =
    await Promise.all([productsQuery, categoriesQuery, vendorsQuery]);

  const firstError =
    productsResult.error ??
    categoriesResult.error ??
    vendorsResult.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    products: (productsResult.data ?? []) as unknown as InventoryCatalogProduct[],
    categories: (categoriesResult.data ?? []) as InventoryMasters["categories"],
    vendors: (vendorsResult.data ?? []) as InventoryMasterOption[],
  };
}

export async function fetchInventoryItems(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("inventory_items")
    .select(inventoryItemSelect)
    .not("catalog_product_id", "is", null)
    .order("item_name", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return attachReservationTotals((data ?? []) as InventoryItem[]);
}

export async function fetchInventoryItem(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_items")
    .select(inventoryItemSelect)
    .eq("id", id)
    .not("catalog_product_id", "is", null);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const [itemWithReservations] = await attachReservationTotals([
    data as InventoryItem,
  ]);
  return itemWithReservations ?? null;
}

export async function fetchInventoryBatches(itemId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("inventory_batch_history", {
    target_item_id: itemId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as InventoryBatch[];
}

export async function createInventoryItem(
  profile: UserProfile | null,
  values: InventoryItemFormValues,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);

  if (values.status === "active") {
    await ensureUniqueInventoryProduct(organizationId, values.catalog_product_id);
  }

  const { data, error } = await client
    .from("inventory_items")
    .insert({
      organization_id: organizationId,
      ...itemPayload(values),
    })
    .select(inventoryItemSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [itemWithReservations] = await attachReservationTotals([
    data as InventoryItem,
  ]);
  return itemWithReservations ?? (data as InventoryItem);
}

export async function updateInventoryItem(
  id: string,
  profile: UserProfile | null,
  values: InventoryItemFormValues,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);

  if (values.status === "active") {
    await ensureUniqueInventoryProduct(
      organizationId,
      values.catalog_product_id,
      id,
    );
  }

  const { data, error } = await client
    .from("inventory_items")
    .update(itemPayload(values))
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select(inventoryItemSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [itemWithReservations] = await attachReservationTotals([
    data as InventoryItem,
  ]);
  return itemWithReservations ?? (data as InventoryItem);
}

export async function deleteInventoryItem(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("inventory_items").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchInventoryTransactions(
  profile: UserProfile | null,
  itemId?: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_transactions")
    .select(inventoryTransactionSelect)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (itemId) {
    query = query.eq("item_id", itemId);
  }

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as InventoryTransactionWithRelations[];
}

export async function fetchProjectInventoryTransactions(
  profile: UserProfile | null,
  projectId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_transactions")
    .select(inventoryTransactionSelect)
    .eq("project_id", projectId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as InventoryTransactionWithRelations[];
}

export async function createInventoryTransaction(
  profile: UserProfile | null,
  values: InventoryTransactionFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("inventory_transactions")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      ...transactionPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryTransaction;
}

export async function issueInventoryToProject(
  projectId: string,
  itemId: string,
  quantity: string,
  notes: string,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("issue_inventory_to_project", {
    target_project_id: projectId,
    target_item_id: itemId,
    issue_quantity: numberValue(quantity),
    issue_notes: nullable(notes),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryTransaction;
}

export async function fetchInventoryProjectOptions(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select("id, project_code, project_name, customer_id")
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as InventoryProjectOption[];
  }

  return (data ?? []) as InventoryProjectOption[];
}
