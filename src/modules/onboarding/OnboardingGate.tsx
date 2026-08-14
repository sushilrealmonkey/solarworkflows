/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { authenticatedHomePath } from "../../app/redirects";
import { PortalLogo } from "../../components/PortalBrand";
import { Button } from "../crm/CrmComponents";
import { fetchCurrentCompanyOnboardingProgress } from "./onboardingApi";
import { resolveTenantOnboardingDestination } from "./onboardingRouting";
import type { CompanyOnboardingProgress } from "./types";

type OnboardingContextValue = {
  progress: CompanyOnboardingProgress;
  setProgress: (progress: CompanyOnboardingProgress) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingGate() {
  const { status, errorMessage, profile } = useAuth();
  const location = useLocation();
  const [progress, setProgress] = useState<CompanyOnboardingProgress | null>(null);
  const [resolvedCompanyId, setResolvedCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const workspaceSetupPath = location.pathname === "/workspace-setup";
  const bypassOnboarding = Boolean(
    profile?.is_super_admin ||
      profile?.platform_role === "backend_staff" ||
      !profile?.company_id ||
      !profile.organization_id,
  );

  useEffect(() => {
    let active = true;
    const companyId = profile?.company_id ?? null;

    if (status !== "ready") {
      setProgress(null);
      setResolvedCompanyId(null);
      setError(null);
      setLoading(true);
      return () => {
        active = false;
      };
    }

    if (bypassOnboarding) {
      setProgress(null);
      setResolvedCompanyId(null);
      setError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    void fetchCurrentCompanyOnboardingProgress()
      .then((nextProgress) => {
        if (active) setProgress(nextProgress);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Onboarding status could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setResolvedCompanyId(companyId);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [bypassOnboarding, loadVersion, profile?.company_id, profile?.id, status]);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);
  const companyResolutionPending = Boolean(
    status === "ready" &&
      !bypassOnboarding &&
      profile?.company_id &&
      resolvedCompanyId !== profile.company_id,
  );

  if (status === "loading") {
    return <OnboardingResolutionScreen />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (status === "unassigned") {
    return workspaceSetupPath ? (
      <Outlet />
    ) : (
      <Navigate to="/workspace-setup" replace />
    );
  }

  if (status === "inactive") {
    return (
      <OnboardingErrorScreen message="This account is not active for the organization workspace." />
    );
  }

  if (status === "error") {
    return (
      <OnboardingErrorScreen
        message={errorMessage ?? "Your workspace access could not be loaded."}
      />
    );
  }

  if (loading || companyResolutionPending) {
    return <OnboardingResolutionScreen />;
  }

  if (error) {
    return <OnboardingErrorScreen message={error} onRetry={retry} />;
  }

  const isSetupOwner = Boolean(
    progress?.setup_owner_profile_id &&
      progress.setup_owner_profile_id === profile?.id,
  );
  const destination = resolveTenantOnboardingDestination({
    bypassOnboarding,
    homePath: authenticatedHomePath(profile),
    isSetupOwner,
    pathname: location.pathname,
    progress,
  });

  if (destination) return <Navigate to={destination} replace />;

  if (bypassOnboarding || !progress || !isSetupOwner || progress.status === "completed") {
    return <Outlet />;
  }

  return (
    <OnboardingContext.Provider value={{ progress, setProgress }}>
      <Outlet />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error("useOnboarding must be used inside OnboardingGate");
  }

  return context;
}

function OnboardingResolutionScreen() {
  return (
    <StatusShell>
      <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" />
      <h1 className="mt-5 text-center text-xl font-semibold text-[#06173f]">
        Preparing your workspace
      </h1>
      <p className="mt-2 text-center text-sm leading-6 text-slate-600">
        We are checking where to continue your Bizlee setup.
      </p>
    </StatusShell>
  );
}

function OnboardingErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <StatusShell>
      <p className="text-sm font-semibold text-orange-700">Setup unavailable</p>
      <h1 className="mt-2 text-2xl font-semibold text-[#06173f]">
        We could not check onboarding status
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      {onRetry ? (
        <div className="mt-5 [&>button]:w-full">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </StatusShell>
  );
}

function StatusShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff8f1] px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-6 shadow-xl shadow-orange-950/10">
        <PortalLogo className="mx-auto mb-6 h-12 w-full max-w-36 object-contain" />
        {children}
      </section>
    </main>
  );
}
