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
    return isAllowedPathForProgress(pathname, progress) ? null : expectedPath;
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
  if (step === "company") return "/onboarding/company";
  if (step === "products") return "/onboarding/products";
  if (step === "product_entry") return "/onboarding/products/add";
  if (step === "team") return "/onboarding/team";
  if (step === "ready") return "/onboarding/ready";
  return "/onboarding";
}

function isAllowedPathForProgress(
  pathname: string,
  progress: CompanyOnboardingProgress,
) {
  const expectedPath = onboardingPathForProgress(progress);
  if (pathname === expectedPath) return true;

  // Product import does not have its own database step. The existing
  // `products` phase plus this nested URL is sufficient to restore a refresh
  // without introducing a second persisted onboarding-state system.
  return (
    progress.current_step === "products" &&
    pathname === "/onboarding/products/import"
  );
}
