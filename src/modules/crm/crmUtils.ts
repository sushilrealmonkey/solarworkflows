import type { UserPermission, UserProfile } from "../../app/AuthProvider";
import type {
  Customer,
  CustomerSegment,
  CustomerFormValues,
  Lead,
  LeadFollowup,
  LeadFollowupFormValues,
  LeadFormValues,
  StaffOption,
} from "./types";

export const customerStatusOptions = ["active", "inactive", "converted", "lost"];
export const projectCustomerTypeOptions = [
  "residential",
  "commercial",
  "industrial",
  "government",
  "other",
];
export const directCustomerTypeOptions = [
  "b2b_installer",
  "retailer",
  "distributor",
  "other",
];
export const customerTypeOptions = Array.from(
  new Set([...projectCustomerTypeOptions, ...directCustomerTypeOptions]),
);

export const leadStatusOptions = [
  "new",
  "contacted",
  "site_visit_scheduled",
  "qualified",
  "quotation_sent",
  "converted",
  "lost",
];

export const leadPriorityOptions = ["low", "medium", "high", "urgent"];
export const leadRequirementTypeOptions = [
  "Residential Solar",
  "Commercial Solar",
  "Hybrid System",
  "On-grid",
  "Off-grid",
  "Solar Water Pump",
  "EV Charger",
  "Maintenance",
  "AMC",
  "Battery Upgrade",
];
export const leadPropertyTypeOptions = [
  "Independent House",
  "Apartment",
  "Factory",
  "Warehouse",
  "Shop",
  "School",
  "Hospital",
  "Farm",
  "Office Building",
];
export const leadRoofTypeOptions = [
  "RCC Roof",
  "Tin Shed",
  "Metal Roof",
  "Ground Mount",
  "Asbestos",
  "Tile Roof",
];
export const followupTypeOptions = [
  "call",
  "whatsapp",
  "site_visit",
  "meeting",
  "email",
  "other",
];
export const followupStatusOptions = [
  "pending",
  "completed",
  "missed",
  "cancelled",
];

export function hasPermission(
  profile: UserProfile | null,
  permissions: UserPermission[],
  moduleKey: string,
  actionKey: string,
) {
  return (
    Boolean(profile?.is_super_admin) ||
    permissions.some(
      (permission) =>
        permission.moduleKey === moduleKey && permission.actionKey === actionKey,
    )
  );
}

export function hasAdminPricingAccess(
  profile: UserProfile | null,
  permissions: UserPermission[],
  roleNames: string[],
  actionKey: "view" | "create" | "update" | "delete" = "view",
) {
  return (
    hasPermission(profile, permissions, "product_pricing", actionKey) ||
    roleNames.some((roleName) => {
      const normalizedRole = roleName.trim().toLowerCase();

      return normalizedRole === "admin" || normalizedRole === "administrator";
    })
  );
}

export function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function toDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

export function toDateInputValue(value: string | null) {
  return toDateTimeInputValue(value).slice(0, 10);
}

export function toTimeInputValue(value: string | null) {
  return toDateTimeInputValue(value).slice(11, 16);
}

export function combineDateAndTime(date: string, time: string) {
  if (!date) {
    return "";
  }

  return `${date}T${time || "00:00"}`;
}

export function labelize(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function staffName(staff: StaffOption[], staffId: string | null) {
  if (!staffId) {
    return "Unassigned";
  }

  const match = staff.find((option) => option.id === staffId);
  return match?.full_name || match?.email || match?.phone || "Assigned user";
}

export function emptyCustomerForm(): CustomerFormValues {
  return {
    full_name: "",
    customer_segment: "project_based",
    business_name: "",
    gst_number: "",
    contact_person_name: "",
    phone: "",
    alternate_phone: "",
    email: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    customer_type: "residential",
    lead_source: "",
    status: "active",
    assigned_to: "",
    notes: "",
  };
}

export function emptyCustomerFormForSegment(
  segment: CustomerSegment = "project_based",
): CustomerFormValues {
  const values = emptyCustomerForm();

  return {
    ...values,
    customer_segment: segment,
    customer_type: segment === "b2b_direct" ? "b2b_installer" : "residential",
  };
}

export function customerToForm(customer: Customer): CustomerFormValues {
  return {
    full_name: customer.full_name ?? "",
    customer_segment: customer.customer_segment ?? "project_based",
    business_name: customer.business_name ?? "",
    gst_number: customer.gst_number ?? "",
    contact_person_name: customer.contact_person_name ?? "",
    phone: customer.phone ?? "",
    alternate_phone: customer.alternate_phone ?? "",
    email: customer.email ?? "",
    address_line_1: customer.address_line_1 ?? "",
    address_line_2: customer.address_line_2 ?? "",
    city: customer.city ?? "",
    district: customer.district ?? "",
    state: customer.state ?? "",
    pincode: customer.pincode ?? "",
    customer_type: customer.customer_type ?? "residential",
    lead_source: customer.lead_source ?? "",
    status: customer.status ?? "active",
    assigned_to: customer.assigned_to ?? "",
    notes: customer.notes ?? "",
  };
}

export function customerTypeOptionsForSegment(segment: CustomerSegment) {
  return segment === "b2b_direct"
    ? directCustomerTypeOptions
    : projectCustomerTypeOptions;
}

export function customerSegmentLabel(segment: CustomerSegment | null | undefined) {
  if (segment === "b2b_direct") {
    return "B2B/Direct";
  }

  return "Project Based";
}

export function emptyLeadForm(): LeadFormValues {
  return {
    full_name: "",
    phone: "",
    alternate_phone: "",
    email: "",
    address: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    lead_source: "",
    requirement_type: "",
    estimated_load_kw: "",
    electricity_bill_amount: "",
    offered_price: "",
    property_type: "",
    roof_type: "",
    status: "new",
    priority: "medium",
    assigned_to: "",
    notes: "",
  };
}

export function emptyFollowupForm(assignedTo = ""): LeadFollowupFormValues {
  const now = new Date().toISOString();

  return {
    followup_type: "call",
    followup_date: toDateInputValue(now),
    followup_time: toTimeInputValue(now),
    next_followup_date: "",
    next_followup_time: "",
    status: "pending",
    assigned_to: assignedTo,
    notes: "",
  };
}

export function followupToForm(
  followup: LeadFollowup,
): LeadFollowupFormValues {
  return {
    followup_type: followup.followup_type,
    followup_date: toDateInputValue(followup.followup_date),
    followup_time: toTimeInputValue(followup.followup_date),
    next_followup_date: toDateInputValue(followup.next_followup_date),
    next_followup_time: toTimeInputValue(followup.next_followup_date),
    status: followup.status ?? "pending",
    assigned_to: followup.assigned_to ?? "",
    notes: followup.notes ?? "",
  };
}

export function getFollowupDueDate(followup: LeadFollowup) {
  return followup.next_followup_date ?? followup.followup_date;
}

export function isActiveFollowup(followup: LeadFollowup) {
  return followup.status === "pending" || followup.status === "missed";
}

export function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function startOfTomorrow() {
  const tomorrow = startOfToday();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

export function classifyFollowupDueDate(followup: LeadFollowup) {
  if (!isActiveFollowup(followup)) {
    return "none";
  }

  const dueDate = new Date(getFollowupDueDate(followup));
  const today = startOfToday();
  const tomorrow = startOfTomorrow();

  if (dueDate < today) {
    return "overdue";
  }

  if (dueDate >= today && dueDate < tomorrow) {
    return "today";
  }

  return "upcoming";
}

export function getLeadFollowupState(
  leadId: string,
  followups: LeadFollowup[],
) {
  const activeFollowups = followups.filter(
    (followup) => followup.lead_id === leadId && isActiveFollowup(followup),
  );

  if (activeFollowups.length === 0) {
    return "none";
  }

  if (activeFollowups.some((followup) => classifyFollowupDueDate(followup) === "overdue")) {
    return "overdue";
  }

  if (activeFollowups.some((followup) => classifyFollowupDueDate(followup) === "today")) {
    return "today";
  }

  return "upcoming";
}

export function leadToForm(lead: Lead): LeadFormValues {
  return {
    full_name: lead.full_name ?? "",
    phone: lead.phone ?? "",
    alternate_phone: lead.alternate_phone ?? "",
    email: lead.email ?? "",
    address: lead.address ?? "",
    city: lead.city ?? "",
    district: lead.district ?? "",
    state: lead.state ?? "",
    pincode: lead.pincode ?? "",
    lead_source: lead.lead_source ?? "",
    requirement_type: lead.requirement_type ?? "",
    estimated_load_kw:
      lead.estimated_load_kw === null || lead.estimated_load_kw === undefined
        ? ""
        : String(lead.estimated_load_kw),
    electricity_bill_amount:
      lead.electricity_bill_amount === null ||
      lead.electricity_bill_amount === undefined
        ? ""
        : String(lead.electricity_bill_amount),
    offered_price:
      lead.offered_price === null || lead.offered_price === undefined
        ? ""
        : String(lead.offered_price),
    property_type: lead.property_type ?? "",
    roof_type: lead.roof_type ?? "",
    status: lead.status ?? "new",
    priority: lead.priority ?? "medium",
    assigned_to: lead.assigned_to ?? "",
    notes: lead.notes ?? "",
  };
}

export function requiredError(value: string, label: string) {
  return value.trim() ? "" : `${label} is required.`;
}
