import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";

export function SubscriptionRoute({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: ReactNode;
}) {
  const { subscription } = useAuth();

  if (!subscription || subscription.enabled_modules.includes(moduleKey)) {
    return children;
  }

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-orange-200 bg-white p-6 text-center shadow-sm">
      <p className="text-sm font-semibold text-orange-700">Premium feature</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950">
        This module is not included in Bizlee Starter
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {subscription.is_admin
          ? "Upgrade to Bizlee Premium to use this module and the complete business workspace."
          : "Ask your company administrator to upgrade the workspace to Bizlee Premium."}
      </p>
      {subscription.is_admin ? (
        <Link
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#06173f] px-5 py-2 text-sm font-semibold text-white"
          to="/billing/plans"
        >
          View Premium Plan
        </Link>
      ) : null}
    </section>
  );
}
