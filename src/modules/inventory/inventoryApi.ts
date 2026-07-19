import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import { filterByArchiveScope } from "../lifecycle/archiveScope";
import type {
  InventoryItem,
  InventoryBatch,
  InventoryItemFormValues,
  InventoryCatalogProduct,
  InventoryMasterOption,
  InventoryMasters,
  InventoryOpeningBalanceCandidate,
  InventoryOpeningBalanceEntry,
  InventoryOpeningBalanceResult,
  InventoryProjectOption,
  InventoryStockCorrectionValues,
  InventoryTransaction,
  InventoryTransactionWithRelations,
} from "./types";
import type { QuotationInventoryReservation } from "../quotations/types";

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

function numberValue(value: string, fallback = 0) {
  if (!value.trim()) {
    return fallback;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function itemPayload(values: InventoryItemFormValues) {
  return {
    minimum_stock: numberValue(values.minimum_alert),
    notes: nullable(values.notes),
  };
}

const inventoryTransactionSelect = `
  *,
  item:inventory_items(id, item_code, item_name, unit, current_stock, minimum_stock),
  project:projects(id, project_code, project_name),
  supplier:vendors!inventory_transactions_vendor_id_fkey(id, vendor_name),
  creator:users_profile!inventory_transactions_created_by_fkey(id, full_name, email, phone)
`;

const inventoryReservationSelect =
  "*, inventory_item:inventory_items(id, item_code, item_name, brand, model, unit, current_stock), catalog_product:products(id, product_code, product_name, brand, model_number, unit)";

const inventoryProductSelect = `
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
  status,
  category:product_categories(id, name, category_type, display_order)
`;

const inventoryItemSelect = `
  id,
  organization_id,
  catalog_product_id,
  product_id,
  brand_id,
  model_id,
  vendor_id,
  item_code,
  item_name,
  item_category,
  brand,
  model,
  unit,
  current_stock,
  opening_stock,
  minimum_stock,
  gst_percent,
  status,
  bill_no,
  inventory_date,
  notes,
  created_at,
  updated_at,
  catalog_product:products(${inventoryProductSelect})
`;

type InventoryItemPublicRow = {
  item_data: InventoryItem;
};

function redactLegacyInventoryPricing(item: InventoryItem): InventoryItem {
  return {
    ...item,
    purchase_price: null,
    selling_price: null,
  };
}

type InventoryReservationSummaryRow = {
  inventory_item_id: string | null;
  reserved_qty: number | null;
  shortage_qty: number | null;
  status: string | null;
};

type B2BSaleUsageRow = NonNullable<
  InventoryTransactionWithRelations["b2b_sale"]
>;

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

async function attachB2BSaleUsage(
  profile: UserProfile | null,
  transactions: InventoryTransactionWithRelations[],
) {
  const saleIds = Array.from(
    new Set(
      transactions
        .filter(
          (transaction) =>
            transaction.reference_type === "b2b_sale" &&
            Boolean(transaction.reference_id),
        )
        .map((transaction) => transaction.reference_id as string),
    ),
  );

  if (saleIds.length === 0) {
    return transactions;
  }

  const client = requireSupabase();
  let query = client
    .from("b2b_sales")
    .select("id, sale_code, status")
    .in("id", saleIds);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  if (profile?.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data, error } = await query;

  if (error) {
    return transactions;
  }

  const salesById = new Map(
    ((data ?? []) as B2BSaleUsageRow[]).map((sale) => [sale.id, sale]),
  );

  return transactions.map((transaction) =>
    transaction.reference_type === "b2b_sale" && transaction.reference_id
      ? {
          ...transaction,
          b2b_sale: salesById.get(transaction.reference_id) ?? null,
        }
      : transaction,
  );
}

async function attachPurchaseOrderReferences(
  profile: UserProfile | null,
  transactions: InventoryTransactionWithRelations[],
) {
  const purchaseOrderIds = Array.from(
    new Set(
      transactions
        .filter(
          (transaction) =>
            transaction.reference_type === "purchase_order" &&
            Boolean(transaction.reference_id),
        )
        .map((transaction) => transaction.reference_id as string),
    ),
  );

  if (purchaseOrderIds.length === 0) {
    return transactions;
  }

  const client = requireSupabase();
  let query = client
    .from("purchase_orders")
    .select("id, purchase_code")
    .in("id", purchaseOrderIds);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return transactions;
  }

  const purchaseOrdersById = new Map(
    ((data ?? []) as Array<{ id: string; purchase_code: string | null }>).map(
      (order) => [order.id, order],
    ),
  );

  return transactions.map((transaction) =>
    transaction.reference_type === "purchase_order" && transaction.reference_id
      ? {
          ...transaction,
          purchase_order:
            purchaseOrdersById.get(transaction.reference_id) ?? null,
        }
      : transaction,
  );
}

async function attachInventoryTransactionReferences(
  profile: UserProfile | null,
  transactions: InventoryTransactionWithRelations[],
) {
  const [withB2BSales, withPurchaseOrders] = await Promise.all([
    attachB2BSaleUsage(profile, transactions),
    attachPurchaseOrderReferences(profile, transactions),
  ]);

  return withB2BSales.map((transaction, index) => ({
    ...transaction,
    purchase_order: withPurchaseOrders[index]?.purchase_order,
  }));
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
  const vendorsQuery =
    profile?.is_super_admin && !organizationId
      ? Promise.resolve({ data: [], error: null })
      : client.rpc("purchase_vendor_options");

  if (!profile?.is_super_admin) {
    const requiredOrganizationId = requireOrganization(profile);
    productsQuery = productsQuery.eq("tenant_id", requiredOrganizationId);
    categoriesQuery = categoriesQuery.eq("tenant_id", requiredOrganizationId);
  } else if (organizationId) {
    productsQuery = productsQuery.eq("tenant_id", organizationId);
    categoriesQuery = categoriesQuery.eq("tenant_id", organizationId);
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
    vendors: (
      (vendorsResult.data ?? []) as Array<{
        id: string;
        vendor_name: string;
      }>
    ).map((vendor) => ({
      id: vendor.id,
      organization_id: organizationId,
      name: vendor.vendor_name,
      created_at: null,
    })) as InventoryMasterOption[],
  };
}

export async function fetchInventoryItems(profile: UserProfile | null, archiveScope: "active" | "archived" | "all" = "active") {
  const client = requireSupabase();
  void profile;

  const { data, error } = await client.rpc("inventory_item_public_rows", {
    target_item_id: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return attachReservationTotals(
    filterByArchiveScope(
      ((data ?? []) as InventoryItemPublicRow[]).map((row) =>
        redactLegacyInventoryPricing(row.item_data),
      ),
      archiveScope,
    ),
  );
}

export async function fetchInventoryItem(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  void profile;

  const { data, error } = await client.rpc("inventory_item_public_rows", {
    target_item_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  const item = ((data ?? []) as InventoryItemPublicRow[])[0]?.item_data;

  if (!item) {
    return null;
  }

  const [itemWithReservations] = await attachReservationTotals([
    redactLegacyInventoryPricing(item),
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

export async function updateInventoryItem(
  id: string,
  profile: UserProfile | null,
  values: InventoryItemFormValues,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);

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
    redactLegacyInventoryPricing(data as unknown as InventoryItem),
  ]);
  return (
    itemWithReservations ??
    redactLegacyInventoryPricing(data as unknown as InventoryItem)
  );
}

export async function fetchInventoryOpeningBalanceCandidates() {
  const client = requireSupabase();
  const { data, error } = await client.rpc(
    "inventory_opening_balance_candidates",
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as InventoryOpeningBalanceCandidate[];
}

export async function setInventoryOpeningBalances(
  entries: InventoryOpeningBalanceEntry[],
  balanceDate: string,
  notes: string,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("set_inventory_opening_balances", {
    entries,
    balance_date: balanceDate,
    notes: nullable(notes),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryOpeningBalanceResult;
}

export async function correctInventoryStock(
  itemId: string,
  values: InventoryStockCorrectionValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("correct_inventory_stock", {
    target_item_id: itemId,
    counted_quantity: numberValue(values.counted_quantity),
    correction_date: values.correction_date,
    reason: values.reason.trim(),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryTransaction;
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

  return attachInventoryTransactionReferences(
    profile,
    (data ?? []) as unknown as InventoryTransactionWithRelations[],
  );
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

  return attachInventoryTransactionReferences(
    profile,
    (data ?? []) as unknown as InventoryTransactionWithRelations[],
  );
}

export async function fetchProjectInventoryReservations(
  profile: UserProfile | null,
  projectId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_reservations")
    .select(inventoryReservationSelect)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationInventoryReservation[];
  }

  return (data ?? []) as unknown as QuotationInventoryReservation[];
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
