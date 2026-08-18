import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";

type ConditionalStep = "team";

const stepContent: Record<
  ConditionalStep,
  { badge: string; title: string; description: string; heading: string }
> = {
  team: {
    badge: "Step 4 of 5",
    title: "Team Setup",
    description: "Team Setup has not been implemented yet.",
    heading: "Team Setup is next",
  },
};

export function OnboardingConditionalPlaceholderPage({
  step,
}: {
  step: ConditionalStep;
}) {
  const content = stepContent[step];

  return (
    <AuthThemeShell
      badge={content.badge}
      desktopDescription={content.description}
      mobileDescription={content.description}
      title={content.title}
    >
      <AuthThemeCard>
        <p className="text-sm font-semibold text-orange-200">{content.badge}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">{content.heading}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {content.description} No workspace, importer, upload action, or success state has been built here.
        </p>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}
