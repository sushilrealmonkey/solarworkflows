import { emailError, requiredError } from "../crm/crmUtils";
import type { Supplier, SupplierFormValues, SupplierStatus } from "./types";

export const supplierStatusOptions: SupplierStatus[] = [
  "active",
  "inactive",
  "blacklisted",
];

export function emptySupplierForm(): SupplierFormValues {
  return {
    supplier_name: "",
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
    status: "active",
    preferred_payment_method: "",
    payment_terms_days: "",
    notes: "",
  };
}

export function supplierToForm(supplier: Supplier): SupplierFormValues {
  return {
    supplier_name: supplier.supplier_name,
    contact_person: supplier.contact_person ?? "",
    phone: supplier.phone ?? "",
    alternate_phone: supplier.alternate_phone ?? "",
    email: supplier.email ?? "",
    gst_number: supplier.gst_number ?? "",
    pan_number: supplier.pan_number ?? "",
    address_line_1: supplier.address_line_1 ?? "",
    address_line_2: supplier.address_line_2 ?? "",
    city: supplier.city ?? "",
    district: supplier.district ?? "",
    state: supplier.state ?? "",
    pincode: supplier.pincode ?? "",
    status: supplier.status,
    preferred_payment_method: supplier.preferred_payment_method ?? "",
    payment_terms_days:
      supplier.payment_terms_days == null
        ? ""
        : String(supplier.payment_terms_days),
    notes: supplier.notes ?? "",
  };
}

export function validateSupplierForm(values: SupplierFormValues) {
  return {
    supplier_name: requiredError(values.supplier_name, "Supplier name"),
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

export function formatSupplierAddress(supplier: Supplier) {
  return [
    supplier.address_line_1,
    supplier.address_line_2,
    supplier.city,
    supplier.district,
    supplier.state,
    supplier.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}
