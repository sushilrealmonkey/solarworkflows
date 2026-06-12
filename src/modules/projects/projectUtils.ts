import type { SurveyCustomerSummary } from "../site-surveys/types";
import type { Vendor } from "../vendors/types";
import type {
  Project,
  ProjectFormValues,
  ProjectPriority,
  ProjectStatus,
  ProjectWithRelations,
} from "./types";

export const projectStatusOptions: ProjectStatus[] = [
  "created",
  "material_pending",
  "material_dispatched",
  "installation_scheduled",
  "installation_in_progress",
  "installation_completed",
  "inspection_pending",
  "inspection_completed",
  "net_metering_pending",
  "commissioned",
  "cancelled",
  "on_hold",
];

export const projectPriorityOptions: ProjectPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const projectTypeOptions = [
  "residential",
  "commercial",
  "industrial",
  "government",
  "other",
];

export function emptyProjectForm(): ProjectFormValues {
  return {
    customer_id: "",
    lead_id: "",
    quotation_id: "",
    site_survey_id: "",
    project_name: "",
    system_capacity_kw: "",
    project_type: "residential",
    installation_address: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    project_status: "created",
    priority: "medium",
    start_date: "",
    expected_completion_date: "",
    assigned_project_manager: "",
    assigned_installation_team: "",
    notes: "",
  };
}

export function projectToForm(project: Project): ProjectFormValues {
  return {
    customer_id: project.customer_id ?? "",
    lead_id: project.lead_id ?? "",
    quotation_id: project.quotation_id ?? "",
    site_survey_id: project.site_survey_id ?? "",
    project_name: project.project_name ?? "",
    system_capacity_kw: numberToInput(project.system_capacity_kw),
    project_type: project.project_type ?? "residential",
    installation_address: project.installation_address ?? "",
    city: project.city ?? "",
    district: project.district ?? "",
    state: project.state ?? "",
    pincode: project.pincode ?? "",
    project_status: project.project_status ?? "created",
    priority: project.priority ?? "medium",
    start_date: project.start_date ?? "",
    expected_completion_date: project.expected_completion_date ?? "",
    assigned_project_manager: project.assigned_project_manager ?? "",
    assigned_installation_team: formatTeamInput(project.assigned_installation_team),
    notes: project.notes ?? "",
  };
}

export function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

export function formatKw(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value} kW`;
}

export function formatTeamInput(value: unknown[] | null | undefined) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (isTeamVendorAssignment(item)) {
        return teamVendorAssignmentInput(item);
      }

      return JSON.stringify(item);
    })
    .join(", ");
}

export function parseTeamInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return [JSON.parse(trimmed) as unknown];
    } catch {
      return [trimmed];
    }
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatTeamDisplay(value: unknown[] | null | undefined) {
  if (Array.isArray(value)) {
    const formatted = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (isTeamVendorAssignment(item)) {
          return item.vendor_code
            ? `${item.vendor_code} - ${item.vendor_name}`
            : item.vendor_name;
        }

        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join(", ");

    return formatted || "Unassigned";
  }

  const formatted = formatTeamInput(value);
  return formatted || "Unassigned";
}

export type TeamVendorAssignment = {
  vendor_id: string;
  vendor_code: string | null;
  vendor_name: string;
  vendor_type: string | null;
  phone: string | null;
};

export function teamVendorAssignmentInput(assignment: TeamVendorAssignment) {
  return JSON.stringify({
    vendor_id: assignment.vendor_id,
    vendor_code: assignment.vendor_code,
    vendor_name: assignment.vendor_name,
    vendor_type: assignment.vendor_type,
    phone: assignment.phone,
  });
}

export function filterInstallationVendors(vendors: Vendor[]) {
  return vendors.filter(
    (vendor) =>
      vendor.status === "active" &&
      (vendor.vendor_type === "installer" ||
        vendor.vendor_type === "service_provider"),
  );
}

function isTeamVendorAssignment(value: unknown): value is TeamVendorAssignment {
  return (
    typeof value === "object" &&
    value !== null &&
    "vendor_id" in value &&
    "vendor_name" in value &&
    typeof (value as { vendor_id?: unknown }).vendor_id === "string" &&
    typeof (value as { vendor_name?: unknown }).vendor_name === "string"
  );
}

export function formatCustomerAddress(customer: SurveyCustomerSummary) {
  return [
    customer.address_line_1,
    customer.address_line_2,
    customer.city,
    customer.district,
    customer.state,
    customer.pincode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function getProjectContact(project: ProjectWithRelations) {
  return {
    customerName: project.customer?.full_name ?? "-",
    phone: project.customer?.phone ?? project.lead?.phone ?? "-",
    address: project.customer ? formatCustomerAddress(project.customer) : "",
  };
}

export function projectStatusTone(value: string | null | undefined) {
  if (value === "commissioned" || value === "inspection_completed") {
    return "green" as const;
  }

  if (value === "cancelled") {
    return "red" as const;
  }

  if (
    value === "material_pending" ||
    value === "material_dispatched" ||
    value === "inspection_pending" ||
    value === "net_metering_pending" ||
    value === "on_hold"
  ) {
    return "amber" as const;
  }

  if (
    value === "installation_scheduled" ||
    value === "installation_in_progress" ||
    value === "installation_completed"
  ) {
    return "blue" as const;
  }

  return "neutral" as const;
}

export function priorityTone(value: string | null | undefined) {
  if (value === "urgent" || value === "high") {
    return "amber" as const;
  }

  if (value === "low") {
    return "neutral" as const;
  }

  return "blue" as const;
}
