import { emailError, requiredError } from "../crm/crmUtils";
import type { Vendor, VendorFormValues, VendorStatus, VendorType } from "./types";

export const vendorTypeOptions: VendorType[] = [
  "contractor",
  "installer",
  "transporter",
  "service_provider",
  "other",
];

export const vendorStatusOptions: VendorStatus[] = [
  "active",
  "inactive",
  "blacklisted",
];

export function emptyVendorForm(): VendorFormValues {
  return {
    vendor_name: "",
    category_id: "",
    contact_person: "",
    phone: "",
    alternate_phone: "",
    email: "",
    gst_number: "",
    pan_number: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    vendor_type: "service_provider",
    status: "active",
    preferred_payment_method: "",
    payment_terms_days: "",
    notes: "",
  };
}

export function vendorToForm(vendor: Vendor): VendorFormValues {
  return {
    vendor_name: vendor.vendor_name ?? "",
    category_id: vendor.category_id ?? "",
    contact_person: vendor.contact_person ?? "",
    phone: vendor.phone ?? "",
    alternate_phone: vendor.alternate_phone ?? "",
    email: vendor.email ?? "",
    gst_number: vendor.gst_number ?? "",
    pan_number: vendor.pan_number ?? "",
    address_line_1: vendor.address_line_1 ?? "",
    address_line_2: vendor.address_line_2 ?? "",
    city: vendor.city ?? "",
    district: vendor.district ?? "",
    state: vendor.state ?? "",
    pincode: vendor.pincode ?? "",
    vendor_type: vendor.vendor_type ?? "service_provider",
    status: vendor.status ?? "active",
    preferred_payment_method: vendor.preferred_payment_method ?? "",
    payment_terms_days:
      vendor.payment_terms_days == null ? "" : String(vendor.payment_terms_days),
    notes: vendor.notes ?? "",
  };
}

export function validateVendorForm(values: VendorFormValues) {
  return {
    vendor_name: requiredError(values.vendor_name, "Vendor name"),
    category_id: requiredError(values.category_id, "Vendor category"),
    email: emailError(values.email),
    payment_terms_days:
      values.payment_terms_days.trim() &&
      (!Number.isInteger(Number(values.payment_terms_days)) ||
        Number(values.payment_terms_days) < 0 ||
        Number(values.payment_terms_days) > 365)
        ? "Payment terms must be a whole number from 0 to 365."
        : "",
  };
}

export function formatVendorAddress(vendor: Vendor) {
  return [
    vendor.address_line_1,
    vendor.address_line_2,
    vendor.city,
    vendor.district,
    vendor.state,
    vendor.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}
