export type PlatformCompanyStatus = "active" | "inactive" | string;
export type PlatformAdminStatus = "invited" | "active" | "inactive" | string;

export type PlatformCompanyAdmin = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: PlatformAdminStatus | null;
  auth_user_id: string | null;
  invited_at: string | null;
  onboarded_at: string | null;
  last_login_at: string | null;
  created_at: string | null;
};

export type PlatformCompany = {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  custom_domain: string | null;
  status: PlatformCompanyStatus | null;
  created_at: string | null;
  updated_at: string | null;
  settings: PlatformCompanySettings | null;
  admin: PlatformCompanyAdmin | null;
  role_count: number;
  user_count: number;
};

export type PlatformCompanySettings = {
  contact_email: string | null;
  contact_phone: string | null;
  gst_number: string | null;
  address: string | null;
  company_logo_url: string | null;
};

export type CreatePlatformCompanyFormValues = {
  organization_name: string;
  organization_slug: string;
  admin_full_name: string;
  admin_email: string;
  admin_phone: string;
};

export type CreatePlatformCompanyResult = {
  organization_id: string;
  organization_slug: string;
  admin_role_id: string;
  admin_profile_id: string;
  admin_auth_user_id: string | null;
  admin_profile_status: string;
  invite_email_sent: boolean;
  invited_admin_email: string;
};

export type PlatformCompanyActionResult = {
  ok: boolean;
  message?: string;
};
