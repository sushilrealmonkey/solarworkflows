import type {
  OrganizationSettings,
  OrganizationSettingsFormValues,
  RoleFormValues,
  SettingsRole,
  SettingsStaff,
  StaffFormValues,
} from "./types";

export const staffStatusOptions = ["invited", "active", "inactive"] as const;

export function emptyOrganizationSettingsForm(): OrganizationSettingsFormValues {
  return {
    company_name: "",
    company_details: "",
    company_logo_url: "",
    favicon_url: "",
    primary_color: "#166534",
    secondary_color: "#0f766e",
    accent_color: "#d6a31a",
    font_family: "Inter, ui-sans-serif, system-ui, sans-serif",
    address: "",
    contact_person: "",
    contact_email: "",
    contact_phone: "",
    gst_number: "",
    bank_account_holder_name: "",
    bank_name: "",
    bank_ifsc_code: "",
    bank_account_number: "",
    bank_account_type: "",
    invoice_prefix: "INV",
    quotation_prefix: "QUO",
    customer_prefix: "CUS",
    project_prefix: "PROJ",
    lead_prefix: "LEAD",
    timezone: "Asia/Kolkata",
    currency: "INR",
    date_format: "DD/MM/YYYY",
  };
}

export function organizationSettingsToForm(
  settings: OrganizationSettings | null,
): OrganizationSettingsFormValues {
  const fallback = emptyOrganizationSettingsForm();

  if (!settings) {
    return fallback;
  }

  return {
    company_name: settings.company_name ?? "",
    company_details: settings.company_details ?? "",
    company_logo_url: settings.company_logo_url ?? "",
    favicon_url: settings.favicon_url ?? "",
    primary_color: settings.primary_color ?? fallback.primary_color,
    secondary_color: settings.secondary_color ?? fallback.secondary_color,
    accent_color: settings.accent_color ?? fallback.accent_color,
    font_family: settings.font_family ?? fallback.font_family,
    address: settings.address ?? "",
    contact_person: settings.contact_person ?? "",
    contact_email: settings.contact_email ?? "",
    contact_phone: settings.contact_phone ?? "",
    gst_number: settings.gst_number ?? "",
    bank_account_holder_name: settings.bank_account_holder_name ?? "",
    bank_name: settings.bank_name ?? "",
    bank_ifsc_code: settings.bank_ifsc_code ?? "",
    bank_account_number: settings.bank_account_number ?? "",
    bank_account_type: settings.bank_account_type ?? "",
    invoice_prefix: settings.invoice_prefix ?? fallback.invoice_prefix,
    quotation_prefix: settings.quotation_prefix ?? fallback.quotation_prefix,
    customer_prefix: settings.customer_prefix ?? fallback.customer_prefix,
    project_prefix: settings.project_prefix ?? fallback.project_prefix,
    lead_prefix: settings.lead_prefix ?? fallback.lead_prefix,
    timezone: settings.timezone ?? fallback.timezone,
    currency: settings.currency ?? fallback.currency,
    date_format: settings.date_format ?? fallback.date_format,
  };
}

export function emptyStaffForm(roleId = ""): StaffFormValues {
  return {
    full_name: "",
    phone: "",
    email: "",
    role_id: roleId,
    status: "invited",
  };
}

export function staffToForm(staff: SettingsStaff): StaffFormValues {
  return {
    full_name: staff.full_name ?? "",
    phone: staff.phone ?? "",
    email: staff.email ?? "",
    role_id: staff.role_id ?? "",
    status:
      staff.status === "active" || staff.status === "inactive"
        ? staff.status
        : "invited",
  };
}

export function emptyRoleForm(): RoleFormValues {
  return {
    role_name: "",
    description: "",
    permission_ids: [],
  };
}

export function roleToForm(role: SettingsRole): RoleFormValues {
  return {
    role_name: role.role_name,
    description: role.description ?? "",
    permission_ids: role.permission_ids ?? [],
  };
}

export function validateStaffForm(values: StaffFormValues) {
  const errors: Record<string, string> = {};

  if (!values.full_name.trim()) {
    errors.full_name = "Full name is required.";
  }

  if (!values.phone.trim() && !values.email.trim()) {
    errors.phone = "Phone or email is required.";
    errors.email = "Phone or email is required.";
  }

  return errors;
}

export function validateRoleForm(values: RoleFormValues) {
  const errors: Record<string, string> = {};

  if (!values.role_name.trim()) {
    errors.role_name = "Role name is required.";
  }

  return errors;
}
