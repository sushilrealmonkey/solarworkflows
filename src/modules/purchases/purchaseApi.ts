import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  PurchaseOrder,
  PurchaseOrderFormValues,
  PurchaseReceiveFormValues,
  PurchaseOrderWithRelations,
  PurchaseStatus,
} from "./types";
import { numberValue } from "./purchaseUtils";
import type { Vendor } from "../vendors/types";
import type { InventoryItem } from "../inventory/types";

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

const purchaseOrderSelect = `
  *,
  vendor:vendors(id, vendor_code, vendor_name, contact_person, phone, email, gst_number, address_line_1, address_line_2, city, district, state, pincode),
  creator:users_profile!purchase_orders_created_by_fkey(id, full_name, email, phone),
  items:purchase_order_items(
    *,
    item:inventory_items(id, item_code, item_name, unit, brand, model, catalog_product:products(id, hsn_code))
  )
`;

function isMissingPurchaseSafeRpcError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "PGRST202" ||
    message.includes("purchase_order_public_rows")
  );
}

function isMissingPricingStoreError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("product_prices")
  );
}

function hidePurchasePricing(
  order: PurchaseOrderWithRelations,
): PurchaseOrderWithRelations {
  return {
    ...order,
    subtotal: null,
    gst_amount: null,
    total_amount: null,
    items:
      order.items?.map((item) => ({
        ...item,
        unit_price: null,
        gst_percent: null,
        line_total: null,
      })) ?? null,
  };
}

async function fetchPurchaseOrdersDirect(
  profile: UserProfile | null,
  filters?: { vendorId?: string; itemId?: string },
) {
  const client = requireSupabase();
  const vendorOptions = await fetchPurchaseVendorOptions();
  let query = client
    .from("purchase_orders")
    .select(purchaseOrderSelect)
    .order("created_at", { ascending: false });

  if (filters?.vendorId) {
    query = query.eq("vendor_id", filters.vendorId);
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

  const orders = ((data ?? []) as unknown as PurchaseOrderWithRelations[]).map(
    (order) => ({
      ...order,
      vendor:
        order.vendor ??
        vendorOptions.find((vendor) => vendor.id === order.vendor_id) ??
        null,
    }),
  );

  if (filters?.itemId) {
    return orders.filter((order) =>
      (order.items ?? []).some((item) => item.item_id === filters.itemId),
    );
  }

  return orders;
}

export async function fetchPurchaseOrders(
  profile: UserProfile | null,
  filters?: { vendorId?: string; itemId?: string },
  options: { includePricing?: boolean } = {},
) {
  const client = requireSupabase();
  const includePricing = options.includePricing !== false;

  if (!includePricing) {
    const { data, error } = await client.rpc("purchase_order_public_rows", {
      target_item_id: filters?.itemId ?? null,
    });

    if (error) {
      if (isMissingPurchaseSafeRpcError(error)) {
        const fallbackOrders = await fetchPurchaseOrdersDirect(profile, filters);

        return fallbackOrders
          .map(hidePurchasePricing)
          .filter((order) =>
            filters?.vendorId ? order.vendor_id === filters.vendorId : true,
          );
      }

      throw new Error(error.message);
    }

    const orders = ((data ?? []) as Array<{ order_data: unknown }>).map(
      (row) => row.order_data as PurchaseOrderWithRelations,
    );

    return filters?.vendorId
      ? orders.filter((order) => order.vendor_id === filters.vendorId)
      : orders;
  }

  try {
    return await fetchPurchaseOrdersDirect(profile, filters);
  } catch (error) {
    const { data, error: publicError } = await client.rpc(
      "purchase_order_public_rows",
      {
        target_item_id: filters?.itemId ?? null,
      },
    );

    if (publicError) {
      throw error;
    }

    const orders = ((data ?? []) as Array<{ order_data: unknown }>).map(
      (row) => row.order_data as PurchaseOrderWithRelations,
    );

    return filters?.vendorId
      ? orders.filter((order) => order.vendor_id === filters.vendorId)
      : orders;
  }
}

export async function fetchPurchaseOrder(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  const vendorOptions = await fetchPurchaseVendorOptions();
  let query = client
    .from("purchase_orders")
    .select(purchaseOrderSelect)
    .eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query.single();

  if (error) {
    const safeOrder = await fetchPurchaseOrderSafe(id);

    if (safeOrder) {
      return safeOrder;
    }

    throw new Error(error.message);
  }

  const order = data as unknown as PurchaseOrderWithRelations;

  return {
    ...order,
    vendor:
      order.vendor ??
      vendorOptions.find((vendor) => vendor.id === order.vendor_id) ??
      null,
  };
}

export async function fetchPurchaseOrderSafe(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("purchase_order_public_rows", {
    target_item_id: null,
  });

  if (error) {
    if (isMissingPurchaseSafeRpcError(error)) {
      const { data: orderData, error: orderError } = await client
        .from("purchase_orders")
        .select(purchaseOrderSelect)
        .eq("id", id)
        .maybeSingle();

      if (orderError) {
        throw new Error(orderError.message);
      }

      const order = orderData as unknown as PurchaseOrderWithRelations | null;

      return order ? hidePurchasePricing(order) : null;
    }

    throw new Error(error.message);
  }

  const orders = ((data ?? []) as Array<{ order_data: unknown }>).map(
    (row) => row.order_data as PurchaseOrderWithRelations,
  );

  return orders.find((order) => order.id === id) ?? null;
}

export async function fetchPurchaseVendorOptions() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("purchase_vendor_options");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Pick<
    Vendor,
    "id" | "vendor_code" | "vendor_name" | "contact_person" | "phone"
  >[];
}

export async function createPurchaseOrder(
  profile: UserProfile | null,
  values: PurchaseOrderFormValues,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);
  const { data: orderData, error: orderError } = await client
    .from("purchase_orders")
    .insert({
      organization_id: organizationId,
      vendor_id: values.vendor_id,
      order_date: values.order_date || new Date().toISOString().slice(0, 10),
      expected_delivery_date: nullable(values.expected_delivery_date),
      notes: nullable(values.notes),
      created_by: profile?.id ?? null,
    })
    .select("*")
    .single();

  if (orderError) {
    throw new Error(orderError.message);
  }

  const order = orderData as PurchaseOrder;
  const { error: itemsError } = await client.from("purchase_order_items").insert(
    values.items.map((item) => ({
      organization_id: organizationId,
      purchase_order_id: order.id,
      item_id: item.item_id,
      quantity: numberValue(item.quantity),
      unit_price: numberValue(item.unit_price),
      gst_percent: numberValue(item.gst_percent),
    })),
  );

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  return order;
}

export async function updatePurchaseOrder(
  id: string,
  values: PurchaseOrderFormValues,
) {
  const client = requireSupabase();
  const { data: orderData, error: orderError } = await client
    .from("purchase_orders")
    .update({
      vendor_id: values.vendor_id,
      order_date: values.order_date || new Date().toISOString().slice(0, 10),
      expected_delivery_date: nullable(values.expected_delivery_date),
      notes: nullable(values.notes),
    })
    .eq("id", id)
    .eq("status", "draft")
    .select("*")
    .single();

  if (orderError) {
    throw new Error(
      orderError.code === "PGRST116"
        ? "Only draft purchase orders can be edited."
        : orderError.message,
    );
  }

  const order = orderData as PurchaseOrder;
  const { data: existingItems, error: existingItemsError } = await client
    .from("purchase_order_items")
    .select("id")
    .eq("purchase_order_id", id);

  if (existingItemsError) {
    throw new Error(existingItemsError.message);
  }

  const retainedItemIds = values.items
    .map((item) => item.id)
    .filter((itemId): itemId is string => Boolean(itemId));
  const removedItemIds = ((existingItems ?? []) as Array<{ id: string }>)
    .map((item) => item.id)
    .filter((itemId) => !retainedItemIds.includes(itemId));

  if (removedItemIds.length > 0) {
    const { error: deleteError } = await client
      .from("purchase_order_items")
      .delete()
      .eq("purchase_order_id", id)
      .in("id", removedItemIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  for (const item of values.items) {
    const payload = {
      item_id: item.item_id,
      quantity: numberValue(item.quantity),
      unit_price: numberValue(item.unit_price),
      gst_percent: numberValue(item.gst_percent),
    };

    if (item.id) {
      const { error: itemError } = await client
        .from("purchase_order_items")
        .update(payload)
        .eq("purchase_order_id", id)
        .eq("id", item.id);

      if (itemError) {
        throw new Error(itemError.message);
      }
    } else {
      const { error: itemError } = await client
        .from("purchase_order_items")
        .insert({
          ...payload,
          organization_id: order.organization_id,
          purchase_order_id: id,
        });

      if (itemError) {
        throw new Error(itemError.message);
      }
    }
  }

  return order;
}

export async function fetchPurchasePriceDefaults(items: InventoryItem[]) {
  const client = requireSupabase();
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.catalog_product_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (productIds.length === 0) {
    return new Map<string, { current_purchase_price: number | null; gst_percent: number | null }>();
  }

  const { data, error } = await client
    .from("product_prices")
    .select("product_id, current_purchase_price, gst_percent")
    .in("product_id", productIds);

  if (error) {
    if (isMissingPricingStoreError(error)) {
      const { data: productData, error: productError } = await client
        .from("products")
        .select("id, gst_percent")
        .in("id", productIds);

      if (productError) {
        throw new Error(productError.message);
      }

      return new Map(
        (productData ?? []).map((product) => [
          product.id as string,
          {
            current_purchase_price: 0,
            gst_percent: product.gst_percent as number | null,
          },
        ]),
      );
    }

    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((price) => [
      price.product_id as string,
      {
        current_purchase_price: price.current_purchase_price as number | null,
        gst_percent: price.gst_percent as number | null,
      },
    ]),
  );
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: PurchaseStatus,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("purchase_orders")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as PurchaseOrder;
}

export async function receivePurchaseOrder(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("receive_purchase_order", {
    target_purchase_order_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as PurchaseOrder;
}

export async function receivePurchaseOrderItems(
  id: string,
  values: PurchaseReceiveFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("receive_purchase_order_items", {
    target_purchase_order_id: id,
    received_items: values.items.map((item) => ({
      purchase_order_item_id: item.purchase_order_item_id,
      received_quantity: numberValue(item.received_quantity),
      actual_unit_purchase_price: numberValue(item.actual_unit_purchase_price),
      gst_percent: numberValue(item.gst_percent),
      update_current_purchase_price: item.update_current_purchase_price,
    })),
    receipt_bill_no: values.bill_no.trim() || null,
    receipt_date:
      values.received_date || new Date().toISOString().slice(0, 10),
    receipt_notes: values.notes.trim() || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as PurchaseOrder;
}
