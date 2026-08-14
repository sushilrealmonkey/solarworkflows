import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";

export function OnboardingCompanyPlaceholderPage() {
  return (
    <AuthThemeShell
      badge="Step 2"
      mobileDescription="Company Setup will be implemented in the next onboarding task."
      title="Company Setup is next"
    >
      <AuthThemeCard>
        <p className="text-sm font-semibold text-orange-300">Setup started</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Your progress is saved
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          The Company Setup form is intentionally not implemented in this task.
          Your onboarding state is now saved at the company step.
        </p>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}
