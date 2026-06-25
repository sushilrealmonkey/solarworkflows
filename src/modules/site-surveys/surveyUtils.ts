import type { Lead } from "../crm/types";
import type {
  SiteSurvey,
  SiteSurveyFormValues,
  SiteSurveyStatus,
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "./types";

export const surveyStatusOptions: SiteSurveyStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "rescheduled",
];

export function emptySurveyForm(): SiteSurveyFormValues {
  return {
    lead_id: "",
    customer_id: "",
    scheduled_date: "",
    scheduled_time: "",
    assigned_to: "",
    roof_type: "",
    roof_area_sqft: "",
    shadow_free_area_sqft: "",
    structure_type: "",
    latitude: "",
    longitude: "",
    address_notes: "",
    recommended_capacity_kw: "",
    existing_meter_type: "",
    sanctioned_load_kw: "",
    phase_type: "",
    remarks: "",
  };
}

export function surveyToForm(survey: SiteSurvey): SiteSurveyFormValues {
  return {
    lead_id: survey.lead_id ?? "",
    customer_id: survey.customer_id ?? "",
    scheduled_date: survey.scheduled_date ?? "",
    scheduled_time: normalizeTimeInput(survey.scheduled_time),
    assigned_to: survey.assigned_to ?? "",
    roof_type: survey.roof_type ?? "",
    roof_area_sqft: numberToInput(survey.roof_area_sqft),
    shadow_free_area_sqft: numberToInput(survey.shadow_free_area_sqft),
    structure_type: survey.structure_type ?? "",
    latitude: numberToInput(survey.latitude),
    longitude: numberToInput(survey.longitude),
    address_notes: survey.address_notes ?? "",
    recommended_capacity_kw: numberToInput(survey.recommended_capacity_kw),
    existing_meter_type: survey.existing_meter_type ?? "",
    sanctioned_load_kw: numberToInput(survey.sanctioned_load_kw),
    phase_type: survey.phase_type ?? "",
    remarks: survey.remarks ?? "",
  };
}

export function leadToSurveyForm(lead: Lead): SiteSurveyFormValues {
  const values = emptySurveyForm();
  values.lead_id = lead.id;
  values.customer_id = lead.converted_customer_id ?? lead.customer_id ?? "";
  values.assigned_to = lead.assigned_to ?? "";
  values.roof_type = lead.roof_type ?? "";
  values.recommended_capacity_kw =
    lead.estimated_load_kw === null || lead.estimated_load_kw === undefined
      ? ""
      : String(lead.estimated_load_kw);
  values.address_notes = formatLeadAddress(lead);
  values.remarks = formatLeadSurveyRemarks(lead);
  return values;
}

export function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

export function normalizeTimeInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.slice(0, 5);
}

export function formatSurveyTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return normalizeTimeInput(value);
}

export function getSurveyContact(survey: SiteSurveyWithRelations) {
  const primary = survey.customer ?? survey.lead ?? null;

  return {
    name: primary?.full_name ?? "-",
    phone: primary?.phone ?? "-",
    sourceLabel: survey.customer ? "Customer" : survey.lead ? "Lead" : "Unlinked",
  };
}

export function formatLeadAddress(lead: Pick<
  Lead,
  "address" | "city" | "district" | "state" | "pincode"
>) {
  return [lead.address, lead.city, lead.district, lead.state, lead.pincode]
    .filter(Boolean)
    .join(", ");
}

export function formatLeadSurveyRemarks(
  lead: Pick<
    Lead,
    | "full_name"
    | "phone"
    | "alternate_phone"
    | "email"
    | "lead_source"
    | "requirement_type"
    | "electricity_bill_amount"
    | "property_type"
    | "priority"
    | "notes"
  >,
) {
  return [
    lead.full_name ? `Lead name: ${lead.full_name}` : "",
    lead.phone ? `Phone: ${lead.phone}` : "",
    lead.alternate_phone ? `Alternate phone: ${lead.alternate_phone}` : "",
    lead.email ? `Email: ${lead.email}` : "",
    lead.lead_source ? `Lead source: ${lead.lead_source}` : "",
    lead.priority ? `Priority: ${lead.priority}` : "",
    lead.requirement_type ? `Requirement: ${lead.requirement_type}` : "",
    lead.property_type ? `Property type: ${lead.property_type}` : "",
    lead.electricity_bill_amount === null ||
    lead.electricity_bill_amount === undefined
      ? ""
      : `Electricity bill amount: ${lead.electricity_bill_amount}`,
  ]
    .filter(Boolean)
    .join("\n");
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

export function leadOptionLabel(lead: SurveyLeadSummary) {
  return `${lead.lead_code ?? "Lead"} - ${lead.full_name} (${lead.phone})`;
}

export function customerOptionLabel(customer: SurveyCustomerSummary) {
  return `${customer.customer_code ?? "Customer"} - ${customer.full_name} (${customer.phone})`;
}

export function surveyStatusTone(value: string | null | undefined) {
  if (value === "completed") {
    return "green" as const;
  }

  if (value === "cancelled") {
    return "red" as const;
  }

  if (value === "in_progress" || value === "rescheduled") {
    return "amber" as const;
  }

  return "blue" as const;
}
