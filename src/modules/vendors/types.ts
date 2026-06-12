export type VendorType =
  | "supplier"
  | "contractor"
  | "installer"
  | "transporter"
  | "service_provider"
  | "other";

export type VendorStatus = "active" | "inactive" | "blacklisted";

export type Vendor = {
  id: string;
  organization_id: string;
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
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VendorFormValues = {
  vendor_name: string;
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
  notes: string;
};
