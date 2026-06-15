import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { PaymentWithRelations } from "../payments/types";
import type { QuotationItem } from "../quotations/types";
import type { SurveyCustomerSummary } from "../site-surveys/types";
import type {
  Invoice,
  InvoiceFormValues,
  InvoiceInventoryItemOption,
  InvoiceItem,
  InvoiceItemFormValues,
  InvoiceLinkOptions,
  InvoiceProjectOption,
  InvoiceQuotationSummary,
  InvoiceWithRelations,
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

function invoicePayload(values: InvoiceFormValues) {
  return {
    customer_id: values.customer_id,
    project_id: nullable(values.project_id),
    quotation_id: nullable(values.quotation_id),
    invoice_date: nullable(values.invoice_date),
    due_date: nullable(values.due_date),
    discount_amount: nullableNumber(values.discount_amount) ?? 0,
    notes: nullable(values.notes),
  };
}

function itemPayload(values: InvoiceItemFormValues, sortOrder?: number) {
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

type UpdateInvoiceOptions = {
  includeItems?: boolean;
  deleteMissingItems?: boolean;
};

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

const invoiceSelect = `
  *,
  customer:customers(${customerSelect}),
  project:projects(${projectOptionSelect}),
  quotation:quotations(${quotationSummarySelect}),
  b2b_sale:b2b_sales(id, sale_code, total_amount, status),
  proforma_invoice:proforma_invoices(id, proforma_code, total_amount, balance_due, status),
  created_by_profile:users_profile!invoices_created_by_fkey(
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
  invoice:invoices(id, invoice_code, total_amount, balance_due, status),
  b2b_sale:b2b_sales(id, sale_code, total_amount, status),
  created_by_profile:users_profile!payments_created_by_fkey(
    id,
    full_name,
    phone,
    email
  )
`;

export async function fetchInvoices(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("invoices")
    .select(invoiceSelect)
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

  return (data ?? []) as unknown as InvoiceWithRelations[];
}

export async function fetchInvoice(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("invoices").select(invoiceSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as InvoiceWithRelations | null;
}

export async function fetchInvoiceItems(
  profile: UserProfile | null,
  invoiceId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as InvoiceItem[];
}

export async function createInvoice(
  profile: UserProfile | null,
  values: InvoiceFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("invoices")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      status: "draft",
      ...invoicePayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const invoice = data as Invoice;
  const items = values.items.filter((item) => item.item_name.trim());

  if (items.length > 0) {
    const { error: itemError } = await client.from("invoice_items").insert(
      items.map((item, index) => ({
        invoice_id: invoice.id,
        ...itemPayload(item, index + 1),
      })),
    );

    if (itemError) {
      throw new Error(itemError.message);
    }
  }

  return recalculateInvoiceTotals(invoice.id);
}

export async function updateInvoice(
  id: string,
  values: InvoiceFormValues,
  options: UpdateInvoiceOptions = {},
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("invoices")
    .update(invoicePayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (options.includeItems) {
    await syncInvoiceItems(id, values.items, {
      deleteMissing: Boolean(options.deleteMissingItems),
    });
  } else {
    await recalculateInvoiceTotals(id);
  }

  return data as Invoice;
}

async function syncInvoiceItems(
  invoiceId: string,
  values: InvoiceItemFormValues[],
  options: { deleteMissing: boolean },
) {
  const client = requireSupabase();
  const items = values.filter((item) => item.item_name.trim());
  const { data: existingItems, error: existingError } = await client
    .from("invoice_items")
    .select("id")
    .eq("invoice_id", invoiceId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const submittedIds = new Set(
    items.map((item) => item.id).filter((itemId): itemId is string => Boolean(itemId)),
  );

  for (const [index, item] of items.entries()) {
    if (item.id) {
      const { error } = await client
        .from("invoice_items")
        .update(itemPayload(item, index + 1))
        .eq("invoice_id", invoiceId)
        .eq("id", item.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { error } = await client.from("invoice_items").insert({
        invoice_id: invoiceId,
        ...itemPayload(item, index + 1),
      });

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  if (options.deleteMissing) {
    const missingIds = (existingItems ?? [])
      .map((item) => item.id)
      .filter((itemId) => !submittedIds.has(itemId));

    if (missingIds.length > 0) {
      const { error } = await client
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId)
        .in("id", missingIds);

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  await recalculateInvoiceTotals(invoiceId);
}

export async function deleteInvoice(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("invoices").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createInvoiceItem(
  invoiceId: string,
  values: InvoiceItemFormValues,
  sortOrder: number,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("invoice_items")
    .insert({
      invoice_id: invoiceId,
      ...itemPayload(values, sortOrder),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await recalculateInvoiceTotals(invoiceId);
  return data as InvoiceItem;
}

export async function updateInvoiceItem(
  invoiceId: string,
  itemId: string,
  values: InvoiceItemFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("invoice_items")
    .update(itemPayload(values))
    .eq("id", itemId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await recalculateInvoiceTotals(invoiceId);
  return data as InvoiceItem;
}

export async function deleteInvoiceItem(invoiceId: string, itemId: string) {
  const client = requireSupabase();
  const { error } = await client.from("invoice_items").delete().eq("id", itemId);

  if (error) {
    throw new Error(error.message);
  }

  await recalculateInvoiceTotals(invoiceId);
}

export async function recalculateInvoiceTotals(invoiceId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("recalculate_invoice_totals", {
    target_invoice_id: invoiceId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Invoice;
}

export async function markInvoiceSent(invoiceId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_invoice_sent", {
    target_invoice_id: invoiceId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Invoice;
}

export async function markInvoiceCancelled(invoiceId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_invoice_cancelled", {
    target_invoice_id: invoiceId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Invoice;
}

export async function fetchInvoiceLinkOptions(
  profile: UserProfile | null,
): Promise<InvoiceLinkOptions> {
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

  return {
    customers: (customersResult.data ?? []) as SurveyCustomerSummary[],
    projects: (projectsResult.data ?? []) as unknown as InvoiceProjectOption[],
    quotations: (quotationsResult.data ?? []) as InvoiceQuotationSummary[],
    inventoryItems: inventoryResult.error
      ? []
      : ((inventoryResult.data ?? []) as unknown as InvoiceInventoryItemOption[]),
  };
}

export async function fetchQuotationItemsForInvoice(
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

export async function fetchProjectInvoicePayments(
  profile: UserProfile | null,
  projectId: string | null,
) {
  if (!projectId) {
    return [] as PaymentWithRelations[];
  }

  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(paymentSelect)
    .eq("project_id", projectId)
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

export async function fetchInvoicePayments(
  profile: UserProfile | null,
  invoiceId: string | null,
) {
  if (!invoiceId) {
    return [] as PaymentWithRelations[];
  }

  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(paymentSelect)
    .eq("invoice_id", invoiceId)
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
