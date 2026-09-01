import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import { fetchVendors } from "../vendors/vendorApi";
import type { ExpenseFormValues, ExpenseProjectOption, VendorExpenseWithRelations } from "./types";

const expenseReceiptBucket = "expense-receipts";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }
  return supabase;
}

function requireCompany(profile: UserProfile | null) {
  if (!profile?.company_id) throw new Error("No company is assigned to this user.");
  return profile.company_id;
}

function requireOrganization(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }
  return profile.organization_id;
}

function nullable(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function expensePayload(values: ExpenseFormValues) {
  return {
    vendor_id: values.vendor_id,
    category_id: nullable(values.category_id),
    project_id: nullable(values.project_id),
    amount: Number(values.amount),
    expense_date: values.expense_date,
    payment_status: values.payment_status,
    due_date: nullable(values.due_date),
    paid_date: values.payment_status === "paid" ? nullable(values.paid_date) : null,
    payment_method:
      values.payment_status === "paid" ? nullable(values.payment_method) : null,
    invoice_number: nullable(values.invoice_number),
    description: values.description.trim(),
  };
}

const expenseSelect = `
  *,
  vendor:vendors(id, vendor_code, vendor_name, phone, category_id, preferred_payment_method, payment_terms_days, status),
  category:vendor_categories(id, name, is_active),
  project:projects(id, project_code, project_name)
`;

export async function fetchExpenses(
  profile: UserProfile | null,
  options: { vendorId?: string } = {},
) {
  const client = requireSupabase();
  let query = client
    .from("vendor_expenses")
    .select(expenseSelect)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  } else if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }
  if (options.vendorId) query = query.eq("vendor_id", options.vendorId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VendorExpenseWithRelations[];
}

export async function fetchExpenseProjects(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select("id, project_code, project_name")
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  } else if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data, error } = await query;
  if (error) return [] as ExpenseProjectOption[];
  return (data ?? []) as ExpenseProjectOption[];
}

export async function fetchExpenseVendors(profile: UserProfile | null) {
  const vendors = await fetchVendors(profile, "active");
  return vendors.filter((vendor) => vendor.status === "active");
}

export async function createExpense(
  profile: UserProfile | null,
  values: ExpenseFormValues,
  receipt: File | null,
) {
  const client = requireSupabase();
  const id = globalThis.crypto.randomUUID();
  const companyId = requireCompany(profile);
  const receiptMetadata = receipt
    ? await uploadReceipt(companyId, id, receipt)
    : null;

  const { data, error } = await client
    .from("vendor_expenses")
    .insert({
      id,
      company_id: companyId,
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      updated_by: profile?.id ?? null,
      ...expensePayload(values),
      ...(receiptMetadata ?? {}),
    })
    .select(expenseSelect)
    .single();

  if (error) {
    if (receiptMetadata?.receipt_file_path) {
      await client.storage
        .from(expenseReceiptBucket)
        .remove([receiptMetadata.receipt_file_path]);
    }
    throw new Error(error.message);
  }
  return data as unknown as VendorExpenseWithRelations;
}

export async function updateExpense(
  profile: UserProfile | null,
  expense: VendorExpenseWithRelations,
  values: ExpenseFormValues,
  receipt: File | null,
) {
  const client = requireSupabase();
  const receiptMetadata = receipt
    ? await uploadReceipt(requireCompany(profile), expense.id, receipt)
    : null;

  const { data, error } = await client
    .from("vendor_expenses")
    .update({
      updated_by: profile?.id ?? null,
      ...expensePayload(values),
      ...(receiptMetadata ?? {}),
    })
    .eq("id", expense.id)
    .eq("company_id", requireCompany(profile))
    .select(expenseSelect)
    .single();

  if (error) {
    if (receiptMetadata?.receipt_file_path) {
      await client.storage
        .from(expenseReceiptBucket)
        .remove([receiptMetadata.receipt_file_path]);
    }
    throw new Error(error.message);
  }

  if (
    receiptMetadata?.receipt_file_path &&
    expense.receipt_file_path &&
    expense.receipt_file_path !== receiptMetadata.receipt_file_path
  ) {
    await client.storage
      .from(expenseReceiptBucket)
      .remove([expense.receipt_file_path]);
  }

  return data as unknown as VendorExpenseWithRelations;
}

export async function createExpenseReceiptUrl(filePath: string) {
  const { data, error } = await requireSupabase().storage
    .from(expenseReceiptBucket)
    .createSignedUrl(filePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function uploadReceipt(companyId: string, expenseId: string, file: File) {
  const client = requireSupabase();
  const safeName = file.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "receipt";
  const filePath = `${companyId}/${expenseId}/${globalThis.crypto.randomUUID()}-${safeName}`;
  const { error } = await client.storage
    .from(expenseReceiptBucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) throw new Error(`Receipt upload failed: ${error.message}`);
  return {
    receipt_file_path: filePath,
    receipt_file_name: file.name,
    receipt_mime_type: file.type,
    receipt_file_size: file.size,
  };
}
