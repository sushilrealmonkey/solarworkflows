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
  channel: "email" | "whatsapp" | "call" | "in_app" | "support";
  status: string;
  scheduled_at: string;
  trigger_key?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  reason?: string | null;
  claimed_at?: string | null;
  sent_at?: string | null;
  completed_at?: string | null;
  assigned_to_profile_id?: string | null;
  recipient_profile_id?: string | null;
  attempt_count?: number;
  provider_message_id?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown>;
};

export type PortalActivityEvent = {
  id: string;
  company_id: string;
  organization_id: string | null;
  user_profile_id: string | null;
  event_key: string;
  event_category: "session" | "navigation" | "workflow" | "onboarding" | "error" | "support" | "system";
  module: string | null;
  route: string | null;
  source: "portal" | "database" | "system";
  metadata: Record<string, unknown>;
  occurred_at: string;
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
  onboarding_status: string | null;
  onboarding_step: string | null;
  onboarding_completed_at: string | null;
  product_count: number | string | null;
  first_product_at: string | null;
  enquiry_without_followup_count: number | string | null;
  last_unfollowed_enquiry_at: string | null;
  login_event_count: number | string | null;
  team_invite_count: number | string | null;
  first_team_invite_at: string | null;
  feature_error_count_24h: number | string | null;
  latest_feature_error_at: string | null;
  latest_activity_event: string | null;
  intent_score: number | string | null;
  intent_tier: "low" | "warming" | "high" | "value_reached" | "adoption_signal" | null;
  is_high_intent: boolean;
  value_reached: boolean;
  adoption_signal: boolean;
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
    trigger_key?: string;
    channel: string;
    status: string;
    scheduled_at: string;
    priority?: string;
    reason?: string | null;
  } | null;
  due_task: {
    id: string;
    channel: "call" | "support";
    key: string;
    priority: string;
    reason: string | null;
    assigned_to_profile_id: string | null;
    assigned_to_name: string | null;
    outcome: string | null;
  } | null;
};

export type TrialOutreachCompanyDetail = {
  snapshot: TrialEngagementSnapshot;
  touchpoints: TrialOutreachTouchpoint[];
  interactions: TrialOutreachInteraction[];
  activities: PortalActivityEvent[];
};

export type TrialOutreachDashboard = {
  active_trial_count: number | string;
  interventions_due_count: number | string;
  no_login_24h_count: number | string;
  setup_stalled_count: number | string;
  no_enquiry_count: number | string;
  inactive_48h_count: number | string;
  high_intent_count: number | string;
  value_reached_count: number | string;
  adoption_signal_count: number | string;
  conversion_tasks_due_count: number | string;
  rescue_tasks_due_count: number | string;
  support_escalation_count: number | string;
};

export type TrialOutreachStaff = {
  id: string;
  full_name: string | null;
  email?: string | null;
  status?: string | null;
  platform_role?: string | null;
  is_super_admin?: boolean;
};
