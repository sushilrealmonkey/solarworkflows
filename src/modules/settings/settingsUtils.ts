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
    company_logo_url: "",
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
    company_logo_url: settings.company_logo_url ?? "",
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
    timezone: settings.timezone ?? fallback.timezone,
    currency: settings.currency ?? fallback.currency,
    date_format: fallback.date_format,
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

  if (!values.email.trim()) {
    errors.email = "Email is required to send the invite.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter a valid staff email.";
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
