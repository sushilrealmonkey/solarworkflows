import type { Customer, Lead, StaffOption } from "../crm/types";

export type SiteSurveyStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "rescheduled";

export type SiteSurveyFile = {
  name: string;
  url: string;
  file_path?: string;
  size?: number;
  mime_type?: string;
  uploaded_at?: string;
};

export type SiteSurvey = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  customer_id: string | null;
  survey_code: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  completed_at: string | null;
  survey_status: SiteSurveyStatus | null;
  assigned_to: string | null;
  roof_type: string | null;
  roof_area_sqft: number | null;
  shadow_free_area_sqft: number | null;
  structure_type: string | null;
  electricity_bill_url: string | null;
  site_photos: SiteSurveyFile[] | null;
  latitude: number | null;
  longitude: number | null;
  address_notes: string | null;
  recommended_capacity_kw: number | null;
  existing_meter_type: string | null;
  sanctioned_load_kw: number | null;
  phase_type: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SurveyLeadSummary = Pick<
  Lead,
  | "id"
  | "lead_code"
  | "customer_id"
  | "converted_customer_id"
  | "full_name"
  | "phone"
  | "alternate_phone"
  | "email"
  | "address"
  | "city"
  | "district"
  | "state"
  | "pincode"
  | "lead_source"
  | "requirement_type"
  | "electricity_bill_amount"
  | "offered_price"
  | "property_type"
  | "roof_type"
  | "estimated_load_kw"
  | "priority"
  | "assigned_to"
  | "notes"
>;

export type SurveyCustomerSummary = Pick<
  Customer,
  | "id"
  | "customer_code"
  | "full_name"
  | "phone"
  | "alternate_phone"
  | "email"
  | "address_line_1"
  | "address_line_2"
  | "city"
  | "district"
  | "state"
  | "pincode"
  | "customer_type"
  | "assigned_to"
>;

export type SiteSurveyWithRelations = SiteSurvey & {
  lead?: SurveyLeadSummary | null;
  customer?: SurveyCustomerSummary | null;
};

export type SiteSurveyFormValues = {
  lead_id: string;
  customer_id: string;
  scheduled_date: string;
  scheduled_time: string;
  assigned_to: string;
  roof_type: string;
  roof_area_sqft: string;
  shadow_free_area_sqft: string;
  structure_type: string;
  latitude: string;
  longitude: string;
  address_notes: string;
  recommended_capacity_kw: string;
  existing_meter_type: string;
  sanctioned_load_kw: string;
  phase_type: string;
  remarks: string;
};

export type SurveyFormLookups = {
  leads: SurveyLeadSummary[];
  customers: SurveyCustomerSummary[];
  staff: StaffOption[];
};
