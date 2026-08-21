import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../../app/AuthProvider";
import {
  fetchDashboardRecentLeads,
  fetchDashboardTeamMemberCount,
} from "./dashboardApi";
import { fetchProducts } from "../product-master/productMasterApi";
import { fetchOrganizationSettings } from "../settings/settingsApi";
import {
  loadGettingStartedState,
  openGettingStartedEnquiryState,
  shouldShowGettingStarted,
  type GettingStartedState,
  type GettingStartedTask,
} from "./gettingStarted";

export function GettingStartedChecklist({
  profile,
}: {
  profile: UserProfile | null;
}) {
  const [state, setState] = useState<GettingStartedState | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const loadChecklist = useCallback(async () => {
    return loadGettingStartedState({
      loadCompany: fetchOrganizationSettings,
      loadProducts: () => fetchProducts(profile, "all"),
      loadTeam: async () => {
        return {
          additionalActiveOrInvitedCount: await fetchDashboardTeamMemberCount(),
        };
      },
      loadEnquiries: () => fetchDashboardRecentLeads(profile, 1),
    });
  }, [profile]);

  useEffect(() => {
    let active = true;
    setState(null);

    void loadChecklist().then((nextState) => {
      if (active) setState(nextState);
    });

    return () => {
      active = false;
    };
  }, [loadChecklist, loadVersion]);

  if (!state) return <GettingStartedLoading />;
  if (!shouldShowGettingStarted(state)) return null;

  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-lg border border-orange-100 bg-orange-50/45 p-3 shadow-sm shadow-orange-950/5 sm:p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            className="text-base font-semibold text-slate-950"
            id="getting-started-title"
          >
            Get started with Bizlee
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {state.completedCount} of 4 complete
          </p>
        </div>
        {state.hasUnknown ? (
          <button
            className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-[#06173f] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            onClick={() => setLoadVersion((version) => version + 1)}
            type="button"
          >
            Retry check
          </button>
        ) : null}
      </div>

      <div
        aria-label={`${state.completedCount} of 4 setup tasks complete`}
        aria-valuemax={4}
        aria-valuemin={0}
        aria-valuenow={state.completedCount}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-100"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-orange-500 transition-[width]"
          style={{ width: `${state.completedCount * 25}%` }}
        />
      </div>

      {state.hasUnknown ? (
        <p className="mt-2 text-xs leading-5 text-amber-800" role="status">
          Some setup status is unavailable. You can keep using the dashboard or
          open the setup area directly.
        </p>
      ) : null}

      <div className="mt-2 divide-y divide-orange-100">
        {state.tasks.map((task) => (
          <GettingStartedTaskRow key={task.key} task={task} />
        ))}
      </div>
    </section>
  );
}

function GettingStartedTaskRow({ task }: { task: GettingStartedTask }) {
  const complete = task.status === "complete";
  const unknown = task.status === "unknown";

  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5">
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
          complete
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : unknown
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-slate-300 bg-white text-slate-600"
        }`}
      >
        {complete ? "✓" : unknown ? "!" : "○"}
      </span>
      <span
        className={`min-w-0 flex-1 text-sm ${
          complete ? "font-medium text-slate-600" : "font-semibold text-slate-950"
        }`}
      >
        {task.label}
        {complete ? <span className="sr-only"> complete</span> : null}
        {unknown ? <span className="sr-only"> status unavailable</span> : null}
      </span>
      {complete ? (
        <span className="shrink-0 text-xs font-medium text-slate-500">Done</span>
      ) : (
        <Link
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-orange-200 bg-white px-3 text-xs font-semibold text-[#06173f] shadow-sm transition hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          state={
            task.key === "enquiry" ? openGettingStartedEnquiryState : undefined
          }
          to={task.destination}
        >
          {task.actionLabel}
        </Link>
      )}
    </div>
  );
}

function GettingStartedLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading Getting started with Bizlee"
      className="rounded-lg border border-orange-100 bg-orange-50/45 p-3 shadow-sm shadow-orange-950/5 sm:p-4"
    >
      <div className="h-5 w-44 animate-pulse rounded bg-orange-100" />
      <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-orange-100" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-10 animate-pulse rounded-lg bg-white/80"
            key={index}
          />
        ))}
      </div>
      <span className="sr-only">Checking setup progress</span>
    </section>
  );
}
