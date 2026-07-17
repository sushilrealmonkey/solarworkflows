import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  Payment,
  PaymentFormValues,
  PaymentProjectOption,
  PaymentProjectSummary,
  PaymentWithRelations,
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

function paymentPayload(values: PaymentFormValues) {
  return {
    project_id: nullable(values.project_id),
    customer_id: values.customer_id,
    quotation_id: nullable(values.quotation_id),
    proforma_invoice_id: nullable(values.proforma_invoice_id),
    invoice_id: nullable(values.invoice_id),
    b2b_sale_id: nullable(values.b2b_sale_id),
    payment_source: values.payment_source,
    payment_mode: nullable(values.payment_mode),
    amount: nullableNumber(values.amount) ?? 0,
    payment_date: nullable(values.payment_date),
    reference_number: nullable(values.reference_number),
    bank_name: nullable(values.bank_name),
    loan_account_number: nullable(values.loan_account_number),
    receipt_url: nullable(values.receipt_url),
    notes: nullable(values.notes),
    status: values.status,
  };
}

const customerSelect =
  "id, customer_code, full_name, business_name, gst_number, contact_person_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, customer_type, assigned_to";

const quotationSummarySelect =
  "id, quotation_code, total_amount, subsidy_amount, net_payable_amount";

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

const paymentSelect = `
  *,
  customer:customers(${customerSelect}),
  project:projects(${projectOptionSelect}),
  quotation:quotations(${quotationSummarySelect}),
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

export async function fetchPayments(profile: UserProfile | null, archiveScope: "active" | "archived" | "all" = "active") {
  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(paymentSelect)
    .order("payment_date", { ascending: false })
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

  return (data ?? []) as unknown as PaymentWithRelations[];
}

export async function fetchPayment(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("payments").select(paymentSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as PaymentWithRelations | null;
}

export async function createPayment(
  profile: UserProfile | null,
  values: PaymentFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("payments")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      ...paymentPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Payment;
}

export async function updatePayment(id: string, values: PaymentFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("payments")
    .update(paymentPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Payment;
}

export async function deletePayment(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("payments").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchPaymentProjects(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select(projectOptionSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as PaymentProjectOption[];
  }

  return (data ?? []) as unknown as PaymentProjectOption[];
}

export async function fetchProjectPaymentSummary(
  profile: UserProfile | null,
  projectId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("project_payment_summary")
    .select("*")
    .eq("project_id", projectId);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as PaymentProjectSummary | null;
}
