import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";

export function TrialBanner() {
  const { subscription } = useAuth();

  if (!subscription || subscription.status !== "trialing") return null;

  const urgent = subscription.days_remaining <= 3;
  const expiry = subscription.trial_ends_at
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(subscription.trial_ends_at))
    : null;

  return (
    <section
      className={`rounded-xl border p-4 shadow-sm ${
        urgent
          ? "border-rose-200 bg-rose-50 text-rose-950"
          : "border-orange-200 bg-orange-50 text-slate-950"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">
            {subscription.days_remaining}{" "}
            {subscription.days_remaining === 1 ? "day" : "days"} left in your
            Bizlee Pro trial
          </p>
          <p className="mt-1 text-xs opacity-75">
            {expiry
              ? `Every feature is unlocked until ${expiry}. Choose a plan to keep editing your workspace.`
              : "Every feature is unlocked during your trial. Choose a plan to keep editing your workspace."}
          </p>
        </div>
        {subscription.is_admin ? (
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#06173f] px-4 py-2 text-sm font-semibold text-white"
            to="/billing/plans"
          >
            Activate Monthly Plan
          </Link>
        ) : (
          <p className="text-sm font-semibold">Ask your administrator to activate a plan.</p>
        )}
      </div>
    </section>
  );
}
