import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { moduleKeyForPath } from "./routes";

export function ProtectedRoute() {
  const { status, errorMessage, permissions, profile, refresh, session } =
    useAuth();
  const location = useLocation();
  const [isRefreshingAccess, setIsRefreshingAccess] = useState(false);
  const lastAccessRefreshRef = useRef<string | null>(null);
  const moduleKey = moduleKeyForPath(location.pathname);
  const canViewModule =
    !moduleKey ||
    Boolean(profile?.is_super_admin) ||
    permissions.some(
      (permission) =>
        permission.moduleKey === moduleKey && permission.actionKey === "view",
    );

  useEffect(() => {
    if (status !== "ready" || canViewModule || !moduleKey) return;

    const refreshKey = `${session?.user.id ?? "unknown"}:${location.pathname}`;
    if (lastAccessRefreshRef.current === refreshKey) return;

    lastAccessRefreshRef.current = refreshKey;
    setIsRefreshingAccess(true);
    void refresh().finally(() => setIsRefreshingAccess(false));
  }, [
    canViewModule,
    location.pathname,
    moduleKey,
    refresh,
    session?.user.id,
    status,
  ]);

  if (status === "loading" || isRefreshingAccess) {
    return (
      <AccessStateScreen
        eyebrow="Loading workspace"
        title="Preparing your dashboard"
        description="We are checking your account, organization, and permissions."
      />
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (status === "unassigned") {
    return <Navigate to="/onboarding" replace />;
  }

  if (status === "inactive") {
    return (
      <AccessStateScreen
        eyebrow="Account inactive"
        title="Account inactive"
        description="This account is not active for the organization workspace."
      />
    );
  }

  if (status === "error") {
    return (
      <AccessStateScreen
        eyebrow="Unable to load access"
        title="Something blocked the workspace"
        description={errorMessage ?? "Please try again after a moment."}
      />
    );
  }

  if (!canViewModule) {
    return (
      <AccessStateScreen
        eyebrow="Access denied"
        title="This module is not available"
        description="Your role, record scope, or subscription does not allow this route."
      />
    );
  }

  return <Outlet />;
}

function AccessStateScreen({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-[#06173f]">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      </section>
    </main>
  );
}
