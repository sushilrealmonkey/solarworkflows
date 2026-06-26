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

export type PlatformCompanyActivitySummary = {
  total_customers: number;
  total_leads: number;
  active_projects: number;
  completed_projects: number;
  pending_site_surveys: number;
  quotations_sent: number;
  quotations_accepted: number;
  total_project_value: number;
  total_received_amount: number;
  total_balance_due: number;
  low_stock_items: number;
  pending_documents: number;
};

export type PlatformActivityLog = {
  id: string;
  module: string | null;
  action: string | null;
  description: string | null;
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
  activity_summary?: PlatformCompanyActivitySummary;
  recent_activity?: PlatformActivityLog[];
};

export type PlatformCompanySettings = {
  company_name: string | null;
  company_details: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_person: string | null;
  gst_number: string | null;
  address: string | null;
  company_logo_url: string | null;
  timezone: string | null;
  currency: string | null;
};

export type CreatePlatformCompanyFormValues = {
  organization_name: string;
  admin_full_name: string;
  admin_email: string;
  admin_phone: string;
};

export type UpdatePlatformCompanyFormValues = {
  organization_name: string;
  organization_slug: string;
  subdomain: string;
  custom_domain: string;
  company_logo_url: string;
  address: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  gst_number: string;
  timezone: string;
  currency: string;
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
  email_sent?: boolean;
  message?: string;
  setup_link?: string | null;
};

export type PlatformDashboardSnapshot = {
  totalCompanies: number;
  activeCompanies: number;
  inactiveCompanies: number;
  pendingAdminSetup: number;
  activeAdmins: number;
  totalUsers: number;
  totalCustomers: number;
  totalLeads: number;
  activeProjects: number;
  completedProjects: number;
  pendingSiteSurveys: number;
  quotationsSent: number;
  quotationsAccepted: number;
  lowStockItems: number;
  pendingDocuments: number;
  recentActivity: PlatformActivityLog[];
  companies: PlatformCompany[];
};
