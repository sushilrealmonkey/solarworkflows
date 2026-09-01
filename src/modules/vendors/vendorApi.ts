import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import { filterByArchiveScope } from "../lifecycle/archiveScope";
import type { Vendor, VendorCategory, VendorFormValues } from "./types";

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

function requireCompany(profile: UserProfile | null) {
  if (!profile?.company_id) {
    throw new Error("No company is assigned to this user.");
  }

  return profile.company_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function vendorPayload(values: VendorFormValues) {
  return {
    vendor_name: values.vendor_name.trim(),
    category_id: nullable(values.category_id),
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
    vendor_type: values.vendor_type,
    status: values.status,
    preferred_payment_method: nullable(values.preferred_payment_method),
    payment_terms_days: values.payment_terms_days.trim()
      ? Number(values.payment_terms_days)
      : null,
    notes: nullable(values.notes),
  };
}

const vendorSelect = `
  *,
  category:vendor_categories(id, company_id, organization_id, name, is_active, created_by, created_at, updated_at)
`;

export async function fetchVendors(profile: UserProfile | null, archiveScope: "active" | "archived" | "all" = "active") {
  const client = requireSupabase();
  let query = client
    .from("vendors")
    .select(vendorSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  } else if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return filterByArchiveScope(
    (data ?? []) as unknown as Vendor[],
    archiveScope,
  );
}

export async function fetchVendor(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("vendors").select(vendorSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as Vendor | null;
}

export async function fetchVendorCategories(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("vendor_categories")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name");

  if (!profile?.is_super_admin) {
    query = query.eq("company_id", requireCompany(profile));
  } else if (profile.company_id) {
    query = query.eq("company_id", profile.company_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as VendorCategory[];
}

export async function createVendorCategory(
  profile: UserProfile | null,
  name: string,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("vendor_categories")
    .insert({
      company_id: requireCompany(profile),
      organization_id: requireOrganization(profile),
      name: name.trim(),
      created_by: profile?.id ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as VendorCategory;
}

export async function updateVendorCategory(
  id: string,
  values: { name: string; is_active: boolean },
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("vendor_categories")
    .update({ name: values.name.trim(), is_active: values.is_active })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as VendorCategory;
}

export async function createVendor(
  profile: UserProfile | null,
  values: VendorFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("vendors")
    .insert({
      company_id: requireCompany(profile),
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      ...vendorPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Vendor;
}

export async function updateVendor(id: string, values: VendorFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("vendors")
    .update(vendorPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Vendor;
}

export async function deleteVendor(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("vendors").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}
