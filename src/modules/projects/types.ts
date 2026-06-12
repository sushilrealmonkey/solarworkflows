import type { StaffOption } from "../crm/types";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "../site-surveys/types";
import type { QuotationWithRelations } from "../quotations/types";

export type ProjectStatus =
  | "created"
  | "material_pending"
  | "material_dispatched"
  | "installation_scheduled"
  | "installation_in_progress"
  | "installation_completed"
  | "inspection_pending"
  | "inspection_completed"
  | "net_metering_pending"
  | "commissioned"
  | "cancelled"
  | "on_hold";

export type ProjectPriority = "low" | "medium" | "high" | "urgent";

export type Project = {
  id: string;
  organization_id: string;
  project_code: string | null;
  customer_id: string;
  lead_id: string | null;
  quotation_id: string | null;
  site_survey_id: string | null;
  project_name: string | null;
  system_capacity_kw: number | null;
  project_type: string | null;
  installation_address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  project_status: ProjectStatus | null;
  priority: ProjectPriority | null;
  start_date: string | null;
  expected_completion_date: string | null;
  completed_at: string | null;
  assigned_project_manager: string | null;
  assigned_installation_team: unknown[] | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProjectWithRelations = Project & {
  customer?: SurveyCustomerSummary | null;
  lead?: SurveyLeadSummary | null;
  quotation?: QuotationWithRelations | null;
  site_survey?: SiteSurveyWithRelations | null;
  project_manager?: StaffOption | null;
};

export type ProjectFormValues = {
  customer_id: string;
  lead_id: string;
  quotation_id: string;
  site_survey_id: string;
  project_name: string;
  system_capacity_kw: string;
  project_type: string;
  installation_address: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  project_status: ProjectStatus;
  priority: ProjectPriority;
  start_date: string;
  expected_completion_date: string;
  assigned_project_manager: string;
  assigned_installation_team: string;
  notes: string;
};
