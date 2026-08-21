import type {
  PlatformCompanyBillingStatus,
  PlatformCompany,
  PlatformCompanySubscription,
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

export function deriveCompanyBillingStatus(
  subscription: PlatformCompanySubscription | null | undefined,
  now = new Date(),
): PlatformCompanyBillingStatus {
  if (!subscription) {
    return "free_trial_ended";
  }

  if (subscription.status === "trialing") {
    const trialEndsAt = subscription.trial_ends_at
      ? new Date(subscription.trial_ends_at).getTime()
      : Number.NaN;

    return Number.isFinite(trialEndsAt) && trialEndsAt > now.getTime()
      ? "free_trial_active"
      : "free_trial_ended";
  }

  if (
    subscription.status === "active" ||
    subscription.status === "past_due" ||
    subscription.status === "cancelled" ||
    subscription.status === "grandfathered"
  ) {
    return "subscribed";
  }

  return "free_trial_ended";
}

export function billingStatusLabel(status: PlatformCompanyBillingStatus) {
  if (status === "free_trial_active") return "Free Trial Active";
  if (status === "free_trial_ended") return "Free Trial Ended";
  return "Subscribed";
}

export function billingStatusTone(
  status: PlatformCompanyBillingStatus,
): "green" | "amber" | "neutral" {
  if (status === "free_trial_active") return "green";
  if (status === "subscribed") return "green";
  return "amber";
}

export function companyContactName(company: PlatformCompany) {
  return (
    company.settings?.contact_person?.trim() ||
    company.admin?.full_name?.trim() ||
    "—"
  );
}

export function companyContactPhone(company: PlatformCompany) {
  return company.settings?.contact_phone?.trim() || company.admin?.phone?.trim() || "—";
}

export function companyPlanLabel(company: PlatformCompany) {
  return (
    company.subscription?.plan_name?.trim() ||
    company.subscription?.plan_key?.trim() ||
    "—"
  );
}
