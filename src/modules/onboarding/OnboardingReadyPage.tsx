import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import { fetchProducts } from "../product-master/productMasterApi";
import {
  fetchOrganizationSettings,
  fetchSettingsStaff,
} from "../settings/settingsApi";
import {
  advanceCurrentCompanyOnboarding,
  completeCurrentCompanyOnboarding,
} from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";
import {
  loadReadySummary,
  productSummaryCopy,
  readyScreenContent,
  runReadyActionLock,
  runReadyBack,
  runReadyCompletion,
  teamSummaryCopy,
  teamSummaryDetail,
  type ReadyAction,
  type ReadySummary,
} from "./onboardingReady";

type PageAction = ReadyAction | "back" | null;

export function OnboardingReadyPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { setProgress } = useOnboarding();
  const actionLock = useRef(false);
  const [summary, setSummary] = useState<ReadySummary | null>(null);
  const [action, setAction] = useState<PageAction>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void loadReadySummary({
      currentProfileId: profile?.id ?? null,
      loadCompany: fetchOrganizationSettings,
      loadProducts: () => fetchProducts(profile, "all"),
      loadStaff: fetchSettingsStaff,
    }).then((nextSummary) => {
      if (active) setSummary(nextSummary);
    });

    return () => {
      active = false;
    };
  }, [profile]);

  async function completeAndContinue(nextAction: ReadyAction) {
    await runReadyActionLock(actionLock, async () => {
      try {
        setAction(nextAction);
        setError(null);
        await runReadyCompletion(nextAction, {
          complete: completeCurrentCompanyOnboarding,
          finish: (progress, route, options) => {
            if (nextAction === "enquiry") {
              window.location.replace(route);
              return;
            }

            flushSync(() => {
              setProgress(progress);
              navigate(route, options);
            });
          },
        });
      } catch {
        setError("We couldn't finish your setup. Please try again.");
        setAction(null);
      }
    });
  }

  async function goBack() {
    await runReadyActionLock(actionLock, async () => {
      try {
        setAction("back");
        setError(null);
        await runReadyBack({
          persist: () => advanceCurrentCompanyOnboarding("team"),
          commit: setProgress,
          navigate,
        });
      } catch {
        setError("We couldn't return to Team Setup. Please try again.");
        setAction(null);
      }
    });
  }

  return (
    <OnboardingReadyView
      action={action}
      error={error}
      onBack={() => void goBack()}
      onComplete={(nextAction) => void completeAndContinue(nextAction)}
      summary={summary}
    />
  );
}

export function OnboardingReadyView({
  action,
  error,
  onBack,
  onComplete,
  summary,
}: {
  action: PageAction;
  error: string | null;
  onBack: () => void;
  onComplete: (action: ReadyAction) => void;
  summary: ReadySummary | null;
}) {
  const busy = action !== null;

  return (
    <AuthThemeShell
      badge={readyScreenContent.badge}
      contentMaxWidthClass="max-w-xl"
      desktopDescription={readyScreenContent.description}
      mobileDescription={readyScreenContent.description}
      title={readyScreenContent.title}
    >
      <div className="[&>div]:!mt-4 [&>div]:!p-4 sm:[&>div]:!p-7 lg:[&>div]:!mt-0 lg:[&>div]:!p-8">
      <AuthThemeCard>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-orange-200">
            {readyScreenContent.badge}
          </p>
          <span className="text-xs font-medium text-slate-400">
            {readyScreenContent.context}
          </span>
        </div>

        <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <span className="h-1.5 flex-1 rounded-full bg-orange-400" key={index} />
          ))}
        </div>

        <div className="mt-6 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10 text-xl font-semibold text-emerald-200"
          >
            ✓
          </span>
          <div>
            <h2 className="text-xl font-semibold text-white">Setup summary</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Your workspace is usable now. Products and teammates can still be added later.
            </p>
          </div>
        </div>

        <div
          aria-busy={summary === null}
          aria-label="Workspace setup summary"
          className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#071a43]/65"
        >
          {summary ? (
            <>
              <SummaryRow
                available={summary.companyAvailable}
                copy={
                  summary.companyAvailable
                    ? "Company profile configured"
                    : "Company profile summary unavailable"
                }
                label="Company profile"
              />
              <SummaryRow
                available={summary.productCount !== null}
                copy={productSummaryCopy(summary.productCount)}
                label="Product Master"
              />
              <SummaryRow
                available={summary.team !== null}
                copy={teamSummaryCopy(summary.team)}
                detail={teamSummaryDetail(summary.team)}
                label="Team"
              />
            </>
          ) : (
            <SummaryLoading />
          )}
        </div>

        {error ? (
          <p
            className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 space-y-3">
          <div className="[&>button]:min-h-12 [&>button]:w-full [&>button]:rounded-xl [&>button]:text-base">
            <Button disabled={busy} onClick={() => onComplete("enquiry")}>
              {action === "enquiry" ? "Opening enquiry…" : "Create Your First Enquiry"}
            </Button>
          </div>
          <div className="[&>button]:min-h-11 [&>button]:w-full [&>button]:rounded-xl [&>button]:!border-white/20 [&>button]:!bg-white/10 [&>button]:!text-white [&>button:hover]:!bg-white/15">
            <Button
              disabled={busy}
              onClick={() => onComplete("dashboard")}
              variant="secondary"
            >
              {action === "dashboard" ? "Opening dashboard…" : "Go to Dashboard"}
            </Button>
          </div>
          <div className="pt-1 text-center [&>button]:min-h-11 [&>button]:!text-slate-300 [&>button:hover]:!bg-white/10">
            <Button disabled={busy} onClick={onBack} variant="ghost">
              {action === "back" ? "Going back…" : "Back"}
            </Button>
          </div>
        </div>

        {busy ? (
          <p className="sr-only" role="status">
            Finishing your setup. Please wait.
          </p>
        ) : null}
      </AuthThemeCard>
      </div>
    </AuthThemeShell>
  );
}

function SummaryRow({
  available,
  copy,
  detail,
  label,
}: {
  available: boolean;
  copy: string;
  detail?: string | null;
  label: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3.5 last:border-b-0 sm:px-5">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          available
            ? "bg-emerald-300/15 text-emerald-200"
            : "bg-white/10 text-slate-300"
        }`}
      >
        {available ? "✓" : "–"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium leading-5 text-white">{copy}</p>
        {detail ? <p className="mt-0.5 text-xs text-slate-400">{detail}</p> : null}
      </div>
    </div>
  );
}

function SummaryLoading() {
  return (
    <div aria-live="polite" role="status">
      <span className="sr-only">Loading setup summary</span>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          className="flex animate-pulse items-center gap-3 border-b border-white/10 px-4 py-4 last:border-b-0 sm:px-5"
          key={index}
        >
          <span className="h-6 w-6 rounded-full bg-white/10" />
          <span className="h-4 w-2/3 rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}
