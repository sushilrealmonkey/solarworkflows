import type { OrganizationSettings } from "../settings/types";

export type CompanySetupFormValues = {
  company_name: string;
  gst_number: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  state: string;
  company_logo_url: string;
};

export type CompanySetupFormErrors = Partial<
  Record<keyof CompanySetupFormValues, string>
>;

export const indiaStateOptions = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export function companySetupFromSettings(
  settings: OrganizationSettings,
  fallbacks: {
    companyName: string;
    phone: string;
    email: string;
    state: string;
  },
): CompanySetupFormValues {
  return {
    company_name: settings.company_name?.trim() || fallbacks.companyName,
    gst_number: settings.gst_number ?? "",
    contact_phone: settings.contact_phone?.trim() || fallbacks.phone,
    contact_email: settings.contact_email?.trim() || fallbacks.email,
    address: settings.address ?? "",
    state: fallbacks.state,
    company_logo_url: settings.company_logo_url ?? "",
  };
}

export function isValidGstin(value: string) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(
    value.trim().toUpperCase(),
  );
}

export function isValidBusinessEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
