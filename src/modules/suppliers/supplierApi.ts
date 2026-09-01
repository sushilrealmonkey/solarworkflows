import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { Supplier, SupplierFormValues } from "./types";

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
  const trimmed = value.trim();
  return trimmed || null;
}

function supplierPayload(values: SupplierFormValues) {
  return {
    supplier_name: values.supplier_name.trim(),
    contact_person: nullable(values.contact_person),
    phone: nullable(values.phone),
    alternate_phone: nullable(values.alternate_phone),
    email: nullable(values.email),
    gst_number: nullable(values.gst_number),
    pan_number: nullable(values.pan_number),
    address_line_1: nullable(values.address_line_1),
    address_line_2: nullable(values.address_line_2),
    city: nullable(values.city),
    district: nullable(values.district),
    state: nullable(values.state),
    pincode: nullable(values.pincode),
    status: values.status,
    preferred_payment_method: nullable(values.preferred_payment_method),
    payment_terms_days: values.payment_terms_days.trim()
      ? Number(values.payment_terms_days)
      : null,
    notes: nullable(values.notes),
  };
}

export async function fetchSuppliers(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("suppliers")
    .select("*")
    .is("archived_at", null)
    .order("supplier_name");

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  } else if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplier[];
}

export async function fetchSupplier(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("suppliers").select("*").eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as Supplier | null;
}

export async function createSupplier(
  profile: UserProfile | null,
  values: SupplierFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("suppliers")
    .insert({
      company_id: requireCompany(profile),
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      ...supplierPayload(values),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Supplier;
}

export async function updateSupplier(id: string, values: SupplierFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("suppliers")
    .update(supplierPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Supplier;
}
