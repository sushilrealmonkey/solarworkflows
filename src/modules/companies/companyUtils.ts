import type {
  PlatformCompany,
  UpdatePlatformCompanyFormValues,
} from "./types";
import { formatDisplayDate, formatDisplayDateTime } from "../../utils/dateFormat";

export function isAdminSetupPending(company: PlatformCompany) {
  if (!company.admin) {
    return true;
  }

  if (company.admin.status === "inactive") {
    return false;
  }

  return (
    company.admin.status === "invited" ||
    !company.admin.auth_user_id ||
    !company.admin.onboarded_at
  );
}

export function adminSetupLabel(company: PlatformCompany) {
  if (!company.admin) {
    return "No admin";
  }

  if (company.admin.status === "inactive") {
    return "Admin inactive";
  }

  if (isAdminSetupPending(company)) {
    return company.admin.auth_user_id ? "Pending password" : "Pending invite";
  }

  return "Admin active";
}

export function companyToUpdateForm(
  company: PlatformCompany,
): UpdatePlatformCompanyFormValues {
  return {
    organization_name: company.name ?? "",
    organization_slug: company.slug ?? "",
    subdomain: company.subdomain ?? "",
    custom_domain: company.custom_domain ?? "",
    company_logo_url: company.settings?.company_logo_url ?? "",
    address: company.settings?.address ?? "",
    contact_person: company.settings?.contact_person ?? "",
    contact_email: company.settings?.contact_email ?? "",
    contact_phone: company.settings?.contact_phone ?? "",
    gst_number: company.settings?.gst_number ?? "",
    timezone: company.settings?.timezone ?? "",
    currency: company.settings?.currency ?? "",
    admin_full_name: company.admin?.full_name ?? "",
    admin_email: company.admin?.email ?? "",
    admin_phone: company.admin?.phone ?? "",
  };
}

export function validateUpdateCompanyForm(
  values: UpdatePlatformCompanyFormValues,
) {
  if (!values.organization_name.trim()) {
    return "Company name is required.";
  }

  if (!values.organization_slug.trim()) {
    return "Workspace slug is required.";
  }

  if (!values.admin_full_name.trim()) {
    return "Primary admin name is required.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.admin_email.trim())) {
    return "Enter a valid primary admin email.";
  }

  return null;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function formatDate(value: string | null) {
  return formatDisplayDate(value);
}

export function formatDateTime(value: string | null) {
  return formatDisplayDateTime(value);
}
