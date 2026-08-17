import { supabase } from "../../services/supabaseClient";
import type { UserProfile } from "../../app/AuthProvider";
import type { CompanyOnboardingProgress, OnboardingStep } from "./types";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

export async function fetchCurrentCompanyOnboardingProgress() {
  const { data, error } = await requireSupabase().rpc(
    "get_current_company_onboarding_progress",
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as CompanyOnboardingProgress | null;
}

export async function startCurrentCompanyOnboarding() {
  return runProgressRpc("start_current_company_onboarding");
}

export async function advanceCurrentCompanyOnboarding(nextStep: OnboardingStep) {
  return runProgressRpc("advance_current_company_onboarding", {
    next_step: nextStep,
  });
}

export async function deferCurrentCompanyOnboarding() {
  return runProgressRpc("defer_current_company_onboarding");
}

export async function completeCurrentCompanyOnboarding() {
  return runProgressRpc("complete_current_company_onboarding");
}

export async function fetchCurrentCompanyState(profile: UserProfile | null) {
  requireCompanyId(profile);
  const { data, error } = await requireSupabase().rpc(
    "get_current_onboarding_company_state",
  );

  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : "";
}

export async function updateCurrentCompanyState(
  profile: UserProfile | null,
  state: string,
) {
  requireCompanyId(profile);
  const { data, error } = await requireSupabase().rpc(
    "update_current_onboarding_company_state",
    { new_state: state },
  );

  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : "";
}

function requireCompanyId(profile: UserProfile | null) {
  if (!profile?.company_id) {
    throw new Error("No company is assigned to this user.");
  }

  return profile.company_id;
}

async function runProgressRpc(
  functionName:
    | "start_current_company_onboarding"
    | "advance_current_company_onboarding"
    | "defer_current_company_onboarding"
    | "complete_current_company_onboarding",
  args?: { next_step: OnboardingStep },
) {
  const client = requireSupabase();
  const result = args
    ? await client.rpc(functionName, args)
    : await client.rpc(functionName);

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    throw new Error("Onboarding progress could not be updated.");
  }

  return result.data as CompanyOnboardingProgress;
}
