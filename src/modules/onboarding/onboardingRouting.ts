import type { CompanyOnboardingProgress, OnboardingStep } from "./types";

type TenantOnboardingDestinationInput = {
  bypassOnboarding: boolean;
  homePath: string;
  isSetupOwner: boolean;
  pathname: string;
  progress: CompanyOnboardingProgress | null;
};

export function resolveTenantOnboardingDestination({
  bypassOnboarding,
  homePath,
  isSetupOwner,
  pathname,
  progress,
}: TenantOnboardingDestinationInput) {
  const onboardingPath = isOnboardingPath(pathname);
  const workspaceSetupPath = pathname === "/workspace-setup";

  if (bypassOnboarding || !progress || !isSetupOwner || progress.status === "completed") {
    return onboardingPath || workspaceSetupPath ? homePath : null;
  }

  const expectedPath = onboardingPathForProgress(progress);

  if (progress.status !== "deferred") {
    return pathname === expectedPath ? null : expectedPath;
  }

  if ((onboardingPath || workspaceSetupPath) && pathname !== expectedPath) {
    return expectedPath;
  }

  return null;
}

export function isOnboardingPath(pathname: string) {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

function onboardingPathForProgress(progress: CompanyOnboardingProgress) {
  if (progress.status === "pending") return "/onboarding";
  return onboardingPathForStep(progress.current_step);
}

function onboardingPathForStep(step: OnboardingStep) {
  return step === "company" ? "/onboarding/company" : "/onboarding";
}
