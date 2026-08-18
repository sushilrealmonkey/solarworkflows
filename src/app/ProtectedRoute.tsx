import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { moduleKeyForPath } from "./routes";
import { PageLoader } from "../components/PageLoader";

export function ProtectedRoute() {
  const { permissions, profile, refresh, session, status } = useAuth();
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
    if (canViewModule || !moduleKey) return;

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
  ]);

  if (status === "loading" || isRefreshingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
        <PageLoader
          className="w-full max-w-lg"
          label="Preparing your workspace…"
        />
      </main>
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
