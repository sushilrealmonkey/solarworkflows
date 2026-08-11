import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import type { PlanAccessLevel } from "./types";

export function SubscriptionRoute({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: ReactNode;
}) {
  const { subscription } = useAuth();
  const access: PlanAccessLevel =
    subscription?.module_access?.[moduleKey] ??
    (subscription?.enabled_modules.includes(moduleKey) ? "full" : "locked");
  const [showDialog, setShowDialog] = useState(access !== "full");
  const [viewHistory, setViewHistory] = useState(false);

  useEffect(() => {
    setShowDialog(access !== "full");
    setViewHistory(false);
  }, [access, moduleKey]);

  if (!subscription || access === "full") {
    return children;
  }

  if (access === "read_only" && viewHistory) {
    return (
      <div className="space-y-4">
        <section className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Read-only Pro history</p>
            <p className="mt-1 text-orange-900/80">
              Existing records remain available. Upgrade to Pro to create, edit,
              delete, export, or run workflow actions in this module.
            </p>
          </div>
          {subscription.is_admin ? (
            <Link
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-[#06173f] px-4 py-2 font-semibold text-white"
              to="/billing/plans"
            >
              Upgrade to Pro
            </Link>
          ) : null}
        </section>
        {children}
      </div>
    );
  }

  return (
    <UpgradeDialog
      access={access}
      isAdmin={subscription.is_admin}
      moduleKey={moduleKey}
      onViewHistory={
        access === "read_only"
          ? () => {
              setViewHistory(true);
              setShowDialog(false);
            }
          : undefined
      }
      open={showDialog}
    />
  );
}

function UpgradeDialog({
  access,
  isAdmin,
  moduleKey,
  onViewHistory,
  open,
}: {
  access: PlanAccessLevel;
  isAdmin: boolean;
  moduleKey: string;
  onViewHistory?: () => void;
  open: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-3 sm:items-center">
      <section
        aria-labelledby={`upgrade-${moduleKey}`}
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-5 shadow-2xl"
        role="dialog"
      >
        <p className="text-sm font-semibold text-orange-700">Bizlee Pro feature</p>
        <h1
          className="mt-2 text-2xl font-semibold text-slate-950 outline-none"
          id={`upgrade-${moduleKey}`}
          ref={headingRef}
          tabIndex={-1}
        >
          Upgrade to use this module
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isAdmin
            ? access === "read_only"
              ? "Bizlee Core keeps this module read-only. Upgrade to Pro to use every workflow and action."
              : "This module is available with Bizlee Pro. Upgrade to use it in this workspace."
            : access === "read_only"
              ? "This workspace uses Bizlee Core. You can view its history, but only a company administrator can upgrade to restore actions."
              : "This module requires Bizlee Pro. Ask your company administrator to upgrade the workspace."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {isAdmin ? (
            <Link
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-[#06173f] px-5 py-2 text-sm font-semibold text-white"
              to="/billing/plans"
            >
              Upgrade to Pro
            </Link>
          ) : null}
          {access === "read_only" && onViewHistory ? (
            <button
              className="min-h-11 flex-1 rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-slate-700"
              onClick={onViewHistory}
              type="button"
            >
              View read-only history
            </button>
          ) : null}
          {!isAdmin && access === "locked" ? (
            <Link
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-slate-700"
              to="/dashboard"
            >
              Back to dashboard
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
