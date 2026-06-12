import { requiredError } from "../crm/crmUtils";
import type { Vendor, VendorFormValues, VendorStatus, VendorType } from "./types";

export const vendorTypeOptions: VendorType[] = [
  "supplier",
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
    vendor_type: "supplier",
    status: "active",
    notes: "",
  };
}

export function vendorToForm(vendor: Vendor): VendorFormValues {
  return {
    vendor_name: vendor.vendor_name ?? "",
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
    vendor_type: vendor.vendor_type ?? "supplier",
    status: vendor.status ?? "active",
    notes: vendor.notes ?? "",
  };
}

export function validateVendorForm(values: VendorFormValues) {
  return {
    vendor_name: requiredError(values.vendor_name, "Vendor name"),
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
