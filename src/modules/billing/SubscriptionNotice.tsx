import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import {
  dismissSubscriptionMilestone,
  fetchDismissedSubscriptionMilestones,
} from "./billingApi";

export function SubscriptionNotice() {
  const { subscription } = useAuth();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [continuedReadOnly, setContinuedReadOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchDismissedSubscriptionMilestones()
      .then((next) => mounted && setDismissed(next))
      .catch(() => undefined)
      .finally(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, [subscription?.company_id]);

  const milestone = useMemo(() => {
    if (!subscription) return null;
    if (!subscription.write_allowed) return "expired";
    if (subscription.status !== "trialing") return null;
    if (subscription.days_remaining <= 1) return "day_1";
    if (subscription.days_remaining <= 3) return "day_3";
    if (subscription.days_remaining <= 7) return "day_7";
    return null;
  }, [subscription]);

  if (
    !loaded ||
    !milestone ||
    (milestone === "expired" && continuedReadOnly) ||
    (milestone !== "expired" && dismissed.has(milestone))
  ) {
    return null;
  }

  const expired = milestone === "expired";

  async function dismiss() {
    if (expired) return;
    setDismissed((current) => new Set(current).add(milestone!));
    await dismissSubscriptionMilestone(milestone!);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center">
      <section
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-5 shadow-2xl"
        role="dialog"
      >
        <p className="text-sm font-semibold text-orange-700">
          {expired ? "Subscription required" : "Your Bizlee trial is ending soon"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">
          {expired
            ? "Your workspace is now read-only"
            : `${subscription?.days_remaining} ${
                subscription?.days_remaining === 1 ? "day" : "days"
              } remaining`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {subscription?.is_admin
            ? "Choose Core or Pro to continue creating and updating business records."
            : "Your existing records are safe. Ask your company administrator to activate a monthly plan."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {subscription?.is_admin ? (
            <Link
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-[#06173f] px-4 py-2 text-sm font-semibold text-white"
              to="/billing/plans"
            >
              Activate Paid Plan
            </Link>
          ) : null}
          {!expired ? (
            <button
              className="min-h-11 rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-slate-700"
              onClick={() => void dismiss()}
              type="button"
            >
              Remind me later
            </button>
          ) : (
            <button
              className="min-h-11 rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-slate-700"
              onClick={() => setContinuedReadOnly(true)}
              type="button"
            >
              Continue read-only
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
