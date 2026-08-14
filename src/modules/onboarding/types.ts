export type OnboardingStatus =
  | "pending"
  | "in_progress"
  | "deferred"
  | "completed";

export type OnboardingStep =
  | "welcome"
  | "company"
  | "products"
  | "product_entry"
  | "team"
  | "ready";

export type CompanyOnboardingProgress = {
  company_id: string;
  organization_id: string | null;
  setup_owner_profile_id: string | null;
  setup_owner_assigned_at: string | null;
  onboarding_version: number;
  status: OnboardingStatus;
  current_step: OnboardingStep;
  started_at: string | null;
  deferred_at: string | null;
  completed_at: string | null;
  completed_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};
