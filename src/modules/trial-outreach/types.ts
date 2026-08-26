export type TrialEngagementState =
  | "never_started"
  | "started_stalled"
  | "activated_inactive"
  | "engaged"
  | "converted"
  | "paused"
  | "opted_out"
  | "expired";

export type TrialEnrollmentStatus =
  | "active"
  | "paused"
  | "converted"
  | "expired"
  | "opted_out"
  | "completed";

export type TrialOutreachTouchpoint = {
  id: string;
  company_id: string;
  enrollment_id: string;
  sequence_day: number;
  touchpoint_key: string;
  channel: "email" | "whatsapp" | "call";
  status: string;
  scheduled_at: string;
  claimed_at?: string | null;
  sent_at?: string | null;
  completed_at?: string | null;
  assigned_to_profile_id?: string | null;
  attempt_count?: number;
  provider_message_id?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown>;
};

export type TrialOutreachInteraction = {
  id: string;
  company_id: string;
  enrollment_id: string;
  touchpoint_id: string | null;
  channel: string;
  interaction_type: string;
  outcome: string | null;
  blocker: string | null;
  notes: string | null;
  recorded_by_profile_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

export type TrialEngagementSnapshot = {
  company_id: string;
  organization_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  admin_profile_id: string | null;
  admin_last_login_at: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  subscription_status: string;
  enrollment_id: string | null;
  enrollment_status: TrialEnrollmentStatus | null;
  engagement_state: TrialEngagementState | null;
  first_login_at: string | null;
  last_login_at: string | null;
  last_activity_at: string | null;
  first_customer_at: string | null;
  first_lead_at: string | null;
  first_quotation_at: string | null;
  first_site_survey_at: string | null;
  first_project_at: string | null;
  customer_count: number | string | null;
  lead_count: number | string | null;
  quotation_count: number | string | null;
  site_survey_count: number | string | null;
  project_count: number | string | null;
  first_value_at: string | null;
  first_value_kind: string | null;
  timezone: string;
  preferred_language: string;
  whatsapp_recipient_id: string | null;
  whatsapp_opted_in: boolean;
  email_opted_in: boolean;
  trial_day: number;
  days_remaining: number;
  first_value_reached: boolean;
  first_value_progress: {
    input_count: number;
    workflow_count: number;
  };
  next_touchpoint: {
    id: string;
    key: string;
    channel: string;
    status: string;
    scheduled_at: string;
  } | null;
  due_call: {
    id: string;
    assigned_to_profile_id: string | null;
    assigned_to_name: string | null;
    outcome: string | null;
  } | null;
};

export type TrialOutreachCompanyDetail = {
  snapshot: TrialEngagementSnapshot;
  touchpoints: TrialOutreachTouchpoint[];
  interactions: TrialOutreachInteraction[];
};

export type TrialOutreachDashboard = {
  enrolled_count: number | string;
  no_login_count: number | string;
  no_first_value_count: number | string;
  calls_due_today_count: number | string;
  first_value_day_1_count: number | string;
  first_value_day_3_count: number | string;
  first_value_day_7_count: number | string;
  first_value_day_14_count: number | string;
  converted_count: number | string;
  replies_count: number | string;
  connected_calls_count: number | string;
  opt_out_count: number | string;
  failed_delivery_count: number | string;
};

export type TrialOutreachStaff = {
  id: string;
  full_name: string | null;
  email?: string | null;
  status?: string | null;
  platform_role?: string | null;
  is_super_admin?: boolean;
};
