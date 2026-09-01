export type VendorType =
  | "contractor"
  | "installer"
  | "transporter"
  | "service_provider"
  | "other";

export type VendorStatus = "active" | "inactive" | "blacklisted";

export type VendorCategory = {
  id: string;
  company_id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Vendor = {
  id: string;
  company_id: string;
  organization_id: string;
  category_id: string | null;
  vendor_code: string | null;
  vendor_name: string;
  contact_person: string | null;
  phone: string | null;
  alternate_phone: string | null;
  email: string | null;
  gst_number: string | null;
  pan_number: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  vendor_type: VendorType | null;
  status: VendorStatus | null;
  preferred_payment_method: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  category?: VendorCategory | null;
};

export type VendorFormValues = {
  vendor_name: string;
  category_id: string;
  contact_person: string;
  phone: string;
  alternate_phone: string;
  email: string;
  gst_number: string;
  pan_number: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  vendor_type: VendorType;
  status: VendorStatus;
  preferred_payment_method: string;
  payment_terms_days: string;
  notes: string;
};
