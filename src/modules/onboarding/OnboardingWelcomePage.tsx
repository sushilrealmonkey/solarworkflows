import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import {
  deferCurrentCompanyOnboarding,
  startCurrentCompanyOnboarding,
} from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";

const setupAreas = [
  {
    title: "Company profile",
    description: "Your business details and branding.",
    icon: <CompanyIcon />,
  },
  {
    title: "Products",
    description: "Products used in quotations, BOMs, purchases and inventory.",
    icon: <ProductsIcon />,
  },
  {
    title: "Team",
    description: "Add people who will work with you in Bizlee.",
    icon: <TeamIcon />,
  },
];

export function OnboardingWelcomePage() {
  const navigate = useNavigate();
  const { setProgress } = useOnboarding();
  const [action, setAction] = useState<"start" | "defer" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startSetup() {
    try {
      setAction("start");
      setError(null);
      const nextProgress = await startCurrentCompanyOnboarding();
      setProgress(nextProgress);
      navigate("/onboarding/company", { replace: true });
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      setAction(null);
    }
  }

  async function deferSetup() {
    try {
      setAction("defer");
      setError(null);
      const nextProgress = await deferCurrentCompanyOnboarding();
      setProgress(nextProgress);
      navigate("/dashboard", { replace: true });
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      setAction(null);
    }
  }

  return (
    <OnboardingWelcomeView
      action={action}
      error={error}
      onDefer={() => void deferSetup()}
      onStart={() => void startSetup()}
    />
  );
}

type OnboardingWelcomeViewProps = {
  action: "start" | "defer" | null;
  error: string | null;
  onDefer: () => void;
  onStart: () => void;
};

export function OnboardingWelcomeView({
  action,
  error,
  onDefer,
  onStart,
}: OnboardingWelcomeViewProps) {
  const busy = action !== null;
  const supportingCopy =
    "Get your company, products and team ready so you can start managing work right away.";

  return (
    <AuthThemeShell
      badge="Getting started"
      desktopDescription={supportingCopy}
      mobileDescription={supportingCopy}
      title="Set up Bizlee for your solar business"
    >
      <AuthThemeCard>
        <h2 className="text-xl font-semibold text-white">Your setup</h2>

        <div className="mt-5 space-y-3">
          {setupAreas.map((area) => (
            <section
              className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.06] p-4"
              key={area.title}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-400/15 text-orange-300">
                {area.icon}
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white">{area.title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {area.description}
                </p>
              </div>
            </section>
          ))}
        </div>

        {error ? (
          <p className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 space-y-2 [&>button]:w-full [&>button:last-child]:!text-slate-200 [&>button:last-child:hover]:!bg-white/10">
          <Button disabled={busy} onClick={onStart}>
            {action === "start" ? "Starting setup..." : "Start Setup"}
          </Button>
          <Button
            disabled={busy}
            onClick={onDefer}
            variant="ghost"
          >
            {action === "defer" ? "Opening dashboard..." : "I'll do this later"}
          </Button>
        </div>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Onboarding progress could not be updated.";
}

function CompanyIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 20V8l8-4 8 4v12M8 20v-6h8v6M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ProductsIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15.5 10a3 3 0 1 0 0-6M3 20v-2a5.5 5.5 0 0 1 11 0v2M15 14.5a4.5 4.5 0 0 1 6 4.25V20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
