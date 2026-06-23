export type OrganizationSettings = {
  id: string | null;
  organization_id: string | null;
  company_name: string | null;
  company_details: string | null;
  company_logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  font_family: string | null;
  address: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  gst_number: string | null;
  bank_account_holder_name: string | null;
  bank_name: string | null;
  bank_ifsc_code: string | null;
  bank_account_number: string | null;
  bank_account_type: string | null;
  invoice_prefix: string | null;
  quotation_prefix: string | null;
  customer_prefix: string | null;
  project_prefix: string | null;
  lead_prefix: string | null;
  timezone: string | null;
  currency: string | null;
  date_format: string | null;
};

export type OrganizationSettingsFormValues = {
  company_name: string;
  company_logo_url: string;
  address: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  gst_number: string;
  bank_account_holder_name: string;
  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;
  bank_account_type: string;
  timezone: string;
  currency: string;
  date_format: string;
};

export type StaffStatus = "invited" | "active" | "inactive";

export type SettingsStaff = {
  id: string;
  organization_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: StaffStatus | string | null;
  last_login_at: string | null;
  role_id: string | null;
  role_name: string | null;
};

export type StaffFormValues = {
  full_name: string;
  phone: string;
  email: string;
  role_id: string;
  status: StaffStatus;
};

export type SettingsRole = {
  id: string;
  organization_id: string | null;
  role_key: string | null;
  role_name: string;
  description: string | null;
  is_system_role: boolean;
  permission_count: number;
  permission_ids: string[];
};

export type PermissionAction = "view" | "create" | "update" | "delete";

export type PermissionOption = {
  id: string;
  module_id: string;
  module_key: string;
  module_name: string;
  action_key: PermissionAction;
  action_name: string;
};

export type RoleFormValues = {
  role_name: string;
  description: string;
  permission_ids: string[];
};
