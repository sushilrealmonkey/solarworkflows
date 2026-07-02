import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { PaymentWithRelations } from "../payments/types";
import type { QuotationItem } from "../quotations/types";
import type {
  ProformaInvoice,
  ProformaInvoiceFormValues,
  ProformaInvoiceItem,
  ProformaInvoiceItemFormValues,
  ProformaInvoiceLinkOptions,
  ProformaInvoiceWithRelations,
  ProformaPaymentFormValues,
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

function proformaPayload(values: ProformaInvoiceFormValues) {
  return {
    customer_id: values.customer_id,
    project_id: nullable(values.project_id),
    quotation_id: nullable(values.quotation_id),
    proforma_date: nullable(values.invoice_date),
    due_date: nullable(values.due_date),
    discount_amount: nullableNumber(values.discount_amount) ?? 0,
    notes: nullable(values.notes),
  };
}

function itemPayload(values: ProformaInvoiceItemFormValues, sortOrder?: number) {
  return {
    inventory_item_id: nullable(values.inventory_item_id),
    item_name: values.item_name.trim(),
    description: nullable(values.description),
    quantity: nullableNumber(values.quantity) ?? 1,
    unit: nullable(values.unit),
    unit_price: nullableNumber(values.unit_price) ?? 0,
    gst_percent: nullableNumber(values.gst_percent) ?? 0,
    ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
  };
}

function paymentPayload(values: ProformaPaymentFormValues) {
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

const quotationSummarySelect =
  "id, quotation_code, customer_id, base_amount, gst_amount, discount_amount, total_amount, subsidy_amount, net_payable_amount";

const projectOptionSelect = `
  id,
  organization_id,
  project_code,
  project_name,
  customer_id,
  quotation_id,
  customer:customers(${customerSelect}),
  quotation:quotations(${quotationSummarySelect})
`;

const proformaSelect = `
  *,
  customer:customers(${customerSelect}),
  project:projects(${projectOptionSelect}),
  quotation:quotations(${quotationSummarySelect}),
  b2b_sale:b2b_sales!proforma_invoices_b2b_sale_id_fkey(id, sale_code, billing_address, delivery_address, gst_number, total_amount, status),
  final_invoice:invoices!proforma_invoices_final_invoice_id_fkey(id, invoice_code, total_amount, balance_due, status),
  created_by_profile:users_profile!proforma_invoices_created_by_fkey(
    id,
    full_name,
    phone,
    email
  )
`;

const invoiceInventoryProductSelect =
  "id, product_code, product_name, brand, model_number, specifications, unit, gst_percent, status";

const invoiceInventoryItemSelect = `
  id,
  organization_id,
  item_code,
  item_name,
  unit,
  brand,
  model,
  current_stock,
  status,
  catalog_product:products(${invoiceInventoryProductSelect})
`;

const paymentSelect = `
  *,
  customer:customers(${customerSelect}),
  project:projects(${projectOptionSelect}),
  quotation:quotations(id, quotation_code, total_amount, subsidy_amount, net_payable_amount),
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

export async function fetchProformaInvoices(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("proforma_invoices")
    .select(proformaSelect)
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

  return (data ?? []) as unknown as ProformaInvoiceWithRelations[];
}

export async function fetchProformaInvoice(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  let query = client.from("proforma_invoices").select(proformaSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as ProformaInvoiceWithRelations | null;
}

export async function fetchProformaInvoiceItems(
  profile: UserProfile | null,
  proformaInvoiceId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("proforma_invoice_items")
    .select("*, inventory_item:inventory_items(id, item_code, catalog_product:products(id, hsn_code))")
    .eq("proforma_invoice_id", proformaInvoiceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProformaInvoiceItem[];
}

export async function fetchProformaInvoicePayments(
  profile: UserProfile | null,
  proformaInvoiceId: string | null,
) {
  if (!proformaInvoiceId) {
    return [] as PaymentWithRelations[];
  }

  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(paymentSelect)
    .eq("proforma_invoice_id", proformaInvoiceId)
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

export async function fetchProformaInvoiceLinkOptions(
  profile: UserProfile | null,
): Promise<ProformaInvoiceLinkOptions> {
  const client = requireSupabase();
  const organizationId = profile?.is_super_admin
    ? profile.organization_id
    : requireOrganization(profile);

  let customersQuery = client
    .from("customers")
    .select(customerSelect)
    .order("created_at", { ascending: false });
  let projectsQuery = client
    .from("projects")
    .select(projectOptionSelect)
    .order("created_at", { ascending: false });
  let quotationsQuery = client
    .from("quotations")
    .select(quotationSummarySelect)
    .order("created_at", { ascending: false });
  let inventoryQuery = client
    .from("inventory_items")
    .select(invoiceInventoryItemSelect)
    .eq("status", "active")
    .not("catalog_product_id", "is", null)
    .order("item_name", { ascending: true });

  if (organizationId) {
    customersQuery = customersQuery.eq("organization_id", organizationId);
    projectsQuery = projectsQuery.eq("organization_id", organizationId);
    quotationsQuery = quotationsQuery.eq("organization_id", organizationId);
    inventoryQuery = inventoryQuery.eq("organization_id", organizationId);
  }

  const [customersResult, projectsResult, quotationsResult, inventoryResult] =
    await Promise.all([
      customersQuery,
      projectsQuery,
      quotationsQuery,
      inventoryQuery,
    ]);

  if (customersResult.error) {
    throw new Error(
      `Unable to load proforma invoice customers: ${customersResult.error.message}`,
    );
  }

  if (projectsResult.error) {
    throw new Error(
      `Unable to load proforma invoice projects: ${projectsResult.error.message}`,
    );
  }

  if (quotationsResult.error) {
    throw new Error(
      `Unable to load proforma invoice quotations: ${quotationsResult.error.message}`,
    );
  }

  return {
    customers: customersResult.data ?? [],
    projects: (projectsResult.data ?? []) as unknown as ProformaInvoiceLinkOptions["projects"],
    quotations: quotationsResult.data ?? [],
    inventoryItems: inventoryResult.error
      ? []
      : ((inventoryResult.data ?? []) as unknown as ProformaInvoiceLinkOptions["inventoryItems"]),
  };
}

export async function fetchQuotationItemsForProformaInvoice(
  profile: UserProfile | null,
  quotationId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationItem[];
  }

  return (data ?? []) as QuotationItem[];
}

export async function createProformaInvoice(
  profile: UserProfile | null,
  values: ProformaInvoiceFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("proforma_invoices")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      status: "draft",
      ...proformaPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const proformaInvoice = data as ProformaInvoice;
  const items = values.items.filter((item) => item.item_name.trim());

  if (items.length > 0) {
    const { error: itemError } = await client.from("proforma_invoice_items").insert(
      items.map((item, index) => ({
        proforma_invoice_id: proformaInvoice.id,
        ...itemPayload(item, index + 1),
      })),
    );

    if (itemError) {
      throw new Error(itemError.message);
    }
  }

  return recalculateProformaInvoiceTotals(proformaInvoice.id);
}

export async function updateProformaInvoice(
  id: string,
  values: ProformaInvoiceFormValues,
  options: { deleteMissingItems: boolean },
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("proforma_invoices")
    .update(proformaPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await syncProformaInvoiceItems(id, values.items, options);
  return data as ProformaInvoice;
}

async function syncProformaInvoiceItems(
  proformaInvoiceId: string,
  values: ProformaInvoiceItemFormValues[],
  options: { deleteMissingItems: boolean },
) {
  const client = requireSupabase();
  const items = values.filter((item) => item.item_name.trim());
  const { data: existingItems, error: existingError } = await client
    .from("proforma_invoice_items")
    .select("id")
    .eq("proforma_invoice_id", proformaInvoiceId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const submittedIds = new Set(
    items.map((item) => item.id).filter((itemId): itemId is string => Boolean(itemId)),
  );

  for (const [index, item] of items.entries()) {
    if (item.id) {
      const { error } = await client
        .from("proforma_invoice_items")
        .update(itemPayload(item, index + 1))
        .eq("proforma_invoice_id", proformaInvoiceId)
        .eq("id", item.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { error } = await client.from("proforma_invoice_items").insert({
        proforma_invoice_id: proformaInvoiceId,
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
        .from("proforma_invoice_items")
        .delete()
        .eq("proforma_invoice_id", proformaInvoiceId)
        .in("id", missingIds);

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  await recalculateProformaInvoiceTotals(proformaInvoiceId);
}

export async function deleteProformaInvoice(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("proforma_invoices").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function recalculateProformaInvoiceTotals(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("recalculate_proforma_invoice_totals", {
    target_proforma_invoice_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ProformaInvoice;
}

export async function markProformaInvoiceSent(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_proforma_invoice_sent", {
    target_proforma_invoice_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ProformaInvoice;
}

export async function markProformaInvoiceCancelled(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_proforma_invoice_cancelled", {
    target_proforma_invoice_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ProformaInvoice;
}

export async function createInvoiceFromProformaInvoice(id: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_invoice_from_proforma_invoice", {
    target_proforma_invoice_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; invoice_code: string | null };
}

export async function createProformaInvoiceFromB2BSale(saleId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_proforma_invoice_from_b2b_sale", {
    target_sale_id: saleId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; proforma_code: string | null };
}

export async function createProformaInvoicePayment(
  profile: UserProfile | null,
  proformaInvoice: ProformaInvoiceWithRelations,
  values: ProformaPaymentFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("payments")
    .insert({
      organization_id: requireOrganization(profile),
      customer_id: proformaInvoice.customer_id,
      project_id: proformaInvoice.project_id,
      quotation_id: proformaInvoice.quotation_id,
      b2b_sale_id: proformaInvoice.b2b_sale_id,
      invoice_id: proformaInvoice.final_invoice_id,
      proforma_invoice_id: proformaInvoice.id,
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
