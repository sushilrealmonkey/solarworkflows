import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { Vendor, VendorFormValues } from "./types";

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

function vendorPayload(values: VendorFormValues) {
  return {
    vendor_name: values.vendor_name.trim(),
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
    notes: nullable(values.notes),
  };
}

export async function fetchVendors(profile: UserProfile | null, archiveScope: "active" | "archived" | "all" = "active") {
  const client = requireSupabase();
  let query = client
    .from("vendors")
    .select("*")
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

  return (data ?? []) as Vendor[];
}

export async function fetchVendor(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("vendors").select("*").eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Vendor | null;
}

export async function createVendor(
  profile: UserProfile | null,
  values: VendorFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("vendors")
    .insert({
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
