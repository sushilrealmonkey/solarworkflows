import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import { advanceCurrentCompanyOnboarding } from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";
import {
  productSetupOptions,
  runProductSetupTransition,
  type ProductSetupAction,
  type ProductSetupChoice,
} from "./productSetup";

export function OnboardingProductsPage() {
  const navigate = useNavigate();
  const { setProgress } = useOnboarding();
  const [action, setAction] = useState<ProductSetupAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function continueWith(nextAction: ProductSetupAction) {
    if (action) return;

    try {
      setAction(nextAction);
      setError(null);
      await runProductSetupTransition(nextAction, {
        persist: advanceCurrentCompanyOnboarding,
        commit: setProgress,
        navigate: (route) => navigate(route, { replace: true }),
      });
    } catch (nextError) {
      setError(errorMessage(nextError));
      setAction(null);
    }
  }

  return (
    <OnboardingProductsView
      action={action}
      error={error}
      onBack={() => void continueWith("back")}
      onChoose={(choice) => void continueWith(choice)}
    />
  );
}

type OnboardingProductsViewProps = {
  action: ProductSetupAction | null;
  error: string | null;
  onBack: () => void;
  onChoose: (choice: ProductSetupChoice) => void;
};

export function OnboardingProductsView({
  action,
  error,
  onBack,
  onChoose,
}: OnboardingProductsViewProps) {
  const busy = action !== null;
  const supportingCopy =
    "Products are used in quotations, BOMs, purchases and inventory. Set them up now or add them while you work.";

  return (
    <AuthThemeShell
      badge="Step 3 of 5"
      contentMaxWidthClass="max-w-2xl"
      desktopDescription={supportingCopy}
      mobileDescription={supportingCopy}
      title="Set up your products"
    >
      <AuthThemeCard>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-orange-200">Step 3 of 5</p>
          <span className="text-xs font-medium text-slate-400">Product Setup</span>
        </div>
        <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <span
              className={`h-1.5 flex-1 rounded-full ${index < 3 ? "bg-orange-400" : "bg-white/15"}`}
              key={index}
            />
          ))}
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold text-white">Choose how to begin</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Pick a setup path. You can always manage products later from Product Master.
          </p>
        </div>

        <div className="mt-5 grid gap-4">
          {productSetupOptions.map((option) => (
            <ProductSetupOptionCard
              action={action}
              disabled={busy}
              key={option.choice}
              onChoose={onChoose}
              option={option}
            />
          ))}
        </div>

        {error ? (
          <p
            className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100"
            role="alert"
          >
            {error} Please try again.
          </p>
        ) : null}

        <div className="mt-6 [&>button]:!text-slate-200 [&>button:hover]:!bg-white/10">
          <Button disabled={busy} onClick={onBack} variant="ghost">
            {action === "back" ? "Going back..." : "Back"}
          </Button>
        </div>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function ProductSetupOptionCard({
  action,
  disabled,
  onChoose,
  option,
}: {
  action: ProductSetupAction | null;
  disabled: boolean;
  onChoose: (choice: ProductSetupChoice) => void;
  option: (typeof productSetupOptions)[number];
}) {
  const loading = action === option.choice;

  return (
    <button
      aria-busy={loading || undefined}
      className={`group relative w-full rounded-2xl border p-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d2149] sm:p-5 ${
        option.recommended
          ? "border-orange-300/55 bg-orange-300/[0.10] hover:border-orange-300/80 hover:bg-orange-300/[0.14]"
          : "border-white/15 bg-white/[0.05] hover:border-white/30 hover:bg-white/[0.09]"
      } disabled:cursor-wait disabled:opacity-65`}
      disabled={disabled}
      onClick={() => onChoose(option.choice)}
      type="button"
    >
      <span className="flex items-start gap-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            option.recommended
              ? "bg-orange-400 text-[#06173f]"
              : "bg-white/10 text-orange-200"
          }`}
        >
          <ChoiceIcon choice={option.choice} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-white">{option.title}</span>
            {option.recommended ? (
              <span className="rounded-full bg-orange-300/15 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-orange-200">
                Recommended
              </span>
            ) : null}
          </span>
          <span className="mt-1.5 block text-sm leading-6 text-slate-300">
            {option.description}
          </span>
          <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-orange-200">
            {loading ? "Saving choice..." : option.cta}
            {loading ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-orange-200/35 border-t-orange-200"
              />
            ) : (
              <ArrowIcon />
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

function ChoiceIcon({ choice }: { choice: ProductSetupChoice }) {
  if (choice === "add") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
        <path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (choice === "import") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
        <path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M12 17V10m0 0-3 3m3-3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h14m-5-5 5 5-5 5M12 4a8 8 0 1 0 0 16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Your product setup choice could not be saved.";
}
