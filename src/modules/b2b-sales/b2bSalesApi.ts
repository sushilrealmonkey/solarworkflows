import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { PaymentWithRelations } from "../payments/types";
import type {
  B2BInventoryItemOption,
  B2BPaymentFormValues,
  B2BSale,
  B2BSaleFormItem,
  B2BSaleFormValues,
  B2BSaleItem,
  B2BSaleOptions,
  B2BSaleWithRelations,
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

function nullableNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function salePayload(values: B2BSaleFormValues) {
  return {
    customer_id: values.customer_id,
    billing_address: nullable(values.billing_address),
    delivery_address: nullable(values.delivery_address),
    gst_number: nullable(values.gst_number),
    sale_date: nullable(values.sale_date),
    discount_amount: 0,
    notes: nullable(values.notes),
  };
}

function itemPayload(values: B2BSaleFormItem, sortOrder?: number) {
  return {
    inventory_item_id: values.inventory_item_id,
    item_name: values.item_name.trim(),
    description: nullable(values.description),
    quantity: nullableNumber(values.quantity) ?? 1,
    unit: nullable(values.unit),
    unit_price: nullableNumber(values.unit_price) ?? 0,
    discount_amount: nullableNumber(values.discount_amount) ?? 0,
    gst_percent: nullableNumber(values.gst_percent) ?? 0,
    ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
  };
}

function paymentPayload(values: B2BPaymentFormValues) {
  return {
    payment_source: "customer_direct",
    payment_mode: nullable(values.payment_mode),
    amount: nullableNumber(values.amount) ?? 0,
    payment_date: nullable(values.payment_date),
    reference_number: nullable(values.reference_number),
    bank_name: nullable(values.bank_name),
    loan_account_number: null,
    receipt_url: null,
    notes: nullable(values.notes),
    status: values.status,
  };
}

const customerSelect =
  "id, customer_code, full_name, business_name, gst_number, contact_person_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, customer_segment, customer_type, assigned_to";

const b2bSaleSelect = `
  *,
  customer:customers(${customerSelect}),
  proforma_invoice:proforma_invoices!b2b_sales_proforma_invoice_id_fkey(id, proforma_code, total_amount, amount_paid, balance_due, status),
  invoice:invoices!b2b_sales_invoice_id_fkey(id, invoice_code, total_amount, amount_paid, balance_due, status),
  created_by_profile:users_profile!b2b_sales_created_by_fkey(
    id,
    full_name,
    phone,
    email
  )
`;

const productSelect =
  "id, product_code, product_name, brand, model_number, specifications, unit, gst_percent, status";

const inventorySelect = `
  id,
  organization_id,
  catalog_product_id,
  item_code,
  item_name,
  unit,
  brand,
  model,
  current_stock,
  status,
  catalog_product:products(${productSelect})
`;

const paymentSelect = `
  *,
  customer:customers(${customerSelect}),
  proforma_invoice:proforma_invoices(id, proforma_code, total_amount, balance_due, status),
  invoice:invoices(id, invoice_code, total_amount, balance_due, status),
  b2b_sale:b2b_sales(id, sale_code, total_amount, status),
  created_by_profile:users_profile!payments_created_by_fkey(
    id,
    full_name,
    phone,
    email
  )
`;

type PriceRow = {
  product_id: string;
  current_selling_price: number | null;
  gst_percent: number | null;
};

export async function fetchB2BSales(profile: UserProfile | null, archiveScope: "active" | "archived" | "all" = "active") {
  const client = requireSupabase();
  let query = client
    .from("b2b_sales")
    .select(b2bSaleSelect)
    .order("created_at", { ascending: false });

  if (archiveScope !== "all") query = archiveScope === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as B2BSaleWithRelations[];
}

export async function fetchB2BSale(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("b2b_sales").select(b2bSaleSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as B2BSaleWithRelations | null;
}

export async function fetchB2BSaleItems(
  profile: UserProfile | null,
  saleId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("b2b_sale_items")
    .select("*")
    .eq("b2b_sale_id", saleId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as B2BSaleItem[];
}

export async function fetchB2BSalePayments(
  profile: UserProfile | null,
  saleId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(paymentSelect)
    .eq("b2b_sale_id", saleId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    return [] as PaymentWithRelations[];
  }

  return (data ?? []) as unknown as PaymentWithRelations[];
}

export async function fetchB2BSaleOptions(
  profile: UserProfile | null,
  includePricing: boolean,
): Promise<B2BSaleOptions> {
  const client = requireSupabase();
  const organizationId = profile?.is_super_admin
    ? profile.organization_id
    : requireOrganization(profile);

  let customersQuery = client
    .from("customers")
    .select(customerSelect)
    .eq("customer_segment", "b2b_direct")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  let inventoryQuery = client
    .from("inventory_items")
    .select(inventorySelect)
    .eq("status", "active")
    .order("item_name", { ascending: true });

  if (organizationId) {
    customersQuery = customersQuery.eq("organization_id", organizationId);
    inventoryQuery = inventoryQuery.eq("organization_id", organizationId);
  }

  const [customersResult, inventoryResult] = await Promise.all([
    customersQuery,
    inventoryQuery,
  ]);

  if (customersResult.error) {
    throw new Error(customersResult.error.message);
  }

  if (inventoryResult.error) {
    throw new Error(inventoryResult.error.message);
  }

  const inventoryItems = (inventoryResult.data ?? []) as unknown as B2BInventoryItemOption[];

  if (!includePricing || inventoryItems.length === 0) {
    return {
      customers: customersResult.data ?? [],
      inventoryItems,
    };
  }

  const productIds = inventoryItems
    .map((item) => item.catalog_product_id)
    .filter((productId): productId is string => Boolean(productId));

  if (productIds.length === 0) {
    return {
      customers: customersResult.data ?? [],
      inventoryItems,
    };
  }

  let pricesQuery = client
    .from("product_prices")
    .select("product_id, current_selling_price, gst_percent")
    .in("product_id", productIds);

  if (organizationId) {
    pricesQuery = pricesQuery.eq("organization_id", organizationId);
  }

  const { data: priceRows } = await pricesQuery;
  const pricesByProduct = new Map(
    ((priceRows ?? []) as PriceRow[]).map((price) => [price.product_id, price]),
  );

  return {
    customers: customersResult.data ?? [],
    inventoryItems: inventoryItems.map((item) => {
      const price = item.catalog_product_id
        ? pricesByProduct.get(item.catalog_product_id)
        : undefined;

      return {
        ...item,
        current_selling_price: price?.current_selling_price ?? null,
        pricing_gst_percent: price?.gst_percent ?? null,
      };
    }),
  };
}

export async function createB2BSale(
  profile: UserProfile | null,
  values: B2BSaleFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("b2b_sales")
    .insert({
      ...(profile?.company_id ? { company_id: profile.company_id } : {}),
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      status: "draft",
      ...salePayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const sale = data as B2BSale;
  await insertSaleItems(sale.id, values.items);
  return recalculateB2BSaleTotals(sale.id);
}

export async function updateB2BSale(
  id: string,
  values: B2BSaleFormValues,
  options: { deleteMissingItems: boolean },
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("b2b_sales")
    .update(salePayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await syncSaleItems(id, values.items, options);
  return data as B2BSale;
}

async function insertSaleItems(saleId: string, values: B2BSaleFormItem[]) {
  const client = requireSupabase();
  const items = values.filter((item) => item.item_name.trim());

  if (items.length === 0) {
    return;
  }

  const { error } = await client.from("b2b_sale_items").insert(
    items.map((item, index) => ({
      b2b_sale_id: saleId,
      ...itemPayload(item, index + 1),
    })),
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function syncSaleItems(
  saleId: string,
  values: B2BSaleFormItem[],
  options: { deleteMissingItems: boolean },
) {
  const client = requireSupabase();
  const items = values.filter((item) => item.item_name.trim());
  const { data: existingItems, error: existingError } = await client
    .from("b2b_sale_items")
    .select("id")
    .eq("b2b_sale_id", saleId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const submittedIds = new Set(
    items.map((item) => item.id).filter((itemId): itemId is string => Boolean(itemId)),
  );

  for (const [index, item] of items.entries()) {
    if (item.id) {
      const { error } = await client
        .from("b2b_sale_items")
        .update(itemPayload(item, index + 1))
        .eq("b2b_sale_id", saleId)
        .eq("id", item.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { error } = await client.from("b2b_sale_items").insert({
        b2b_sale_id: saleId,
        ...itemPayload(item, index + 1),
      });

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  if (options.deleteMissingItems) {
    const missingIds = (existingItems ?? [])
      .map((item) => item.id)
      .filter((itemId) => !submittedIds.has(itemId));

    if (missingIds.length > 0) {
      const { error } = await client
        .from("b2b_sale_items")
        .delete()
        .eq("b2b_sale_id", saleId)
        .in("id", missingIds);

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  await recalculateB2BSaleTotals(saleId);
}

export async function deleteB2BSale(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("b2b_sales").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function recalculateB2BSaleTotals(saleId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("recalculate_b2b_sale_totals", {
    target_sale_id: saleId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as B2BSale;
}

export async function dispatchB2BSale(saleId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("dispatch_b2b_sale", {
    target_sale_id: saleId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as B2BSale;
}

export async function createInvoiceFromB2BSale(saleId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_invoice_from_b2b_sale", {
    target_sale_id: saleId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; invoice_code: string | null };
}

export async function createB2BSalePayment(
  profile: UserProfile | null,
  sale: B2BSaleWithRelations,
  values: B2BPaymentFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("payments")
    .insert({
      organization_id: requireOrganization(profile),
      customer_id: sale.customer_id,
      proforma_invoice_id: sale.proforma_invoice_id,
      invoice_id: sale.invoice_id,
      b2b_sale_id: sale.id,
      created_by: profile?.id ?? null,
      ...paymentPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
