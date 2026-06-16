export type PlatformCompanyStatus = "active" | "inactive" | string;

export type PlatformCompanyAdmin = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  auth_user_id: string | null;
};

export type PlatformCompany = {
  id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  status: PlatformCompanyStatus | null;
  created_at: string | null;
  admin: PlatformCompanyAdmin | null;
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
