import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Modal, TextArea, TextInput } from "../crm/CrmComponents";
import {
  archiveRecord,
  permanentlyDeleteRecord,
  previewRecordLifecycle,
  restoreRecord,
} from "./lifecycleApi";
import type {
  LifecycleAction,
  LifecycleDependency,
  LifecycleModuleKey,
  LifecyclePreview,
} from "./types";

const dependencyTitles: Record<LifecycleDependency["kind"], string> = {
  owned: "Owned components",
  open: "Open workflow blockers",
  historical: "Historical blockers",
};

type DependencyTarget = {
  actionLabel: string;
  targetId: string;
};

function blockedActionMessage(preview: LifecyclePreview, action: LifecycleAction) {
  if (action !== "delete") {
    return preview.guidance;
  }

  const hasReceivingHistory = preview.dependencies.some(
    (dependency) => dependency.module_key === "receiving_history",
  );

  if (preview.module_key === "purchase_orders" && hasReceivingHistory) {
    return "Material has already been received for this PO. This created stock history that must be kept, so the PO cannot be permanently deleted. Archive it instead.";
  }

  if (preview.dependencies.some((dependency) => dependency.kind === "historical")) {
    return "This record has linked history that must be kept, so it cannot be permanently deleted. Archive it instead.";
  }

  if (preview.dependencies.some((dependency) => dependency.kind === "open")) {
    return "Finish or cancel the linked open records before deleting this record.";
  }

  return preview.guidance;
}

function dependencyDescription(dependency: LifecycleDependency) {
  if (dependency.module_key === "receiving_history") {
    return "Received stock must keep its link to this purchase order.";
  }

  return dependency.guidance;
}

function dependencyLabel(dependency: LifecycleDependency) {
  if (dependency.module_key === "receiving_history") {
    return "Material received";
  }

  return dependency.label || dependency.module_key.split("_").join(" ");
}

export function ArchivedRecordBanner({
  archivedAt,
  reason,
}: {
  archivedAt?: string | null;
  reason?: string | null;
}) {
  if (!archivedAt) return null;
  return (
    <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
      <p className="font-semibold">Archived record — read only</p>
      <p className="mt-1">Existing links and historical reporting remain available. Restore does not reopen or reactivate the business status.</p>
      {reason ? <p className="mt-2 text-amber-800">Reason: {reason}</p> : null}
    </aside>
  );
}

export function RecordLifecyclePanel({
  moduleKey,
  recordId,
  recordLabel,
  archivedAt,
  archiveReason,
  canUpdate,
  canDelete,
  compact = false,
  dependencyTargets,
  onChanged,
}: {
  moduleKey: LifecycleModuleKey;
  recordId: string;
  recordLabel: string;
  archivedAt?: string | null;
  archiveReason?: string | null;
  canUpdate: boolean;
  canDelete: boolean;
  compact?: boolean;
  dependencyTargets?: Partial<Record<string, DependencyTarget>>;
  onChanged: (action: LifecycleAction, result: unknown) => void | Promise<void>;
}) {
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [preview, setPreview] = useState<LifecyclePreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(nextAction: LifecycleAction) {
    setAction(nextAction);
    setPreview(null);
    setReason("");
    setConfirmation("");
    setError(null);
    setLoading(true);
    try {
      setPreview(await previewRecordLifecycle(moduleKey, recordId, nextAction));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to preview this action.");
    } finally {
      setLoading(false);
    }
  }

  function close() {
    if (!submitting) setAction(null);
  }

  function showDependency(targetId: string) {
    setAction(null);
    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !preview || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = action === "archive"
        ? await archiveRecord(moduleKey, recordId, reason)
        : action === "restore"
          ? await restoreRecord(moduleKey, recordId, reason)
          : await permanentlyDeleteRecord(moduleKey, recordId, reason, confirmation);
      setAction(null);
      await onChanged(action, result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to complete this action.");
      try {
        setPreview(await previewRecordLifecycle(moduleKey, recordId, action));
      } catch {
        // Keep the execution error visible if the refresh also fails.
      }
    } finally {
      setSubmitting(false);
    }
  }

  const groupedDependencies = preview
    ? (["owned", "open", "historical"] as const).map((kind) => ({
        kind,
        rows: preview.dependencies.filter((dependency) => dependency.kind === kind),
      })).filter((group) => group.rows.length > 0)
    : [];
  const typedConfirmationMatches = action !== "delete" || confirmation.trim() === preview?.confirmation;
  const canSubmit = Boolean(preview?.allowed && reason.trim() && typedConfirmationMatches && !loading);
  const deletionIsBlocked = action === "delete" && preview && !preview.allowed;
  const displayedDependencyGroups = deletionIsBlocked
    ? [{
        kind: "historical" as const,
        rows: preview.dependencies.filter((dependency) => dependency.kind !== "owned"),
      }].filter((group) => group.rows.length > 0)
    : groupedDependencies;

  return (
    <div className="space-y-3">
      {!compact ? <ArchivedRecordBanner archivedAt={archivedAt} reason={archiveReason} /> : null}
      {(canUpdate || canDelete) ? (
        <section className={compact ? "" : "rounded-xl border border-stone-200 bg-white p-4 shadow-sm"}>
          <div className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}>
            {!compact ? (
              <div>
                <h2 className="font-semibold text-slate-950">Record lifecycle</h2>
                <p className="mt-1 text-sm text-slate-600">Archive keeps history. Permanent deletion is only offered for unused records after a server dependency check.</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canUpdate ? (
                <Button onClick={() => void open(archivedAt ? "restore" : "archive")} variant="secondary">
                  {archivedAt ? "Restore" : "Archive"}
                </Button>
              ) : null}
              {!archivedAt && canDelete ? (
                <Button onClick={() => void open("delete")} variant="danger">Delete permanently</Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {action ? (
        <Modal
          maxWidthClass="sm:max-w-2xl"
          noValidate
          onClose={close}
          onSubmit={submit}
          hideSubmit={Boolean(preview && !preview.allowed)}
          submitDisabled={!canSubmit}
          submitLabel={action === "delete" ? "Delete permanently" : action === "archive" ? "Archive record" : "Restore record"}
          submitting={submitting}
          title={`${action === "delete" ? "Delete" : action === "archive" ? "Archive" : "Restore"} ${recordLabel}`}
        >
          <div className="space-y-4 md:col-span-2">
            {loading ? <p className="text-sm text-slate-600">Checking current status and dependencies…</p> : null}
            {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
            {preview ? (
              <>
                <div className={`rounded-lg border p-3 text-sm ${preview.allowed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
                  <p className="font-semibold">{preview.allowed ? "Ready to continue" : action === "delete" ? "Why this cannot be deleted" : "This action is blocked"}</p>
                  <p className="mt-1">{preview.allowed ? preview.guidance : blockedActionMessage(preview, action)}</p>
                </div>
                {displayedDependencyGroups.map((group) => (
                  <section key={group.kind}>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {deletionIsBlocked ? "What is blocking deletion" : dependencyTitles[group.kind]}
                    </h3>
                    <div className="mt-2 space-y-2">
                      {group.rows.map((dependency, index) => {
                        const target = dependencyTargets?.[dependency.module_key];
                        return (
                          <div className="rounded-lg border border-stone-200 p-3 text-sm" key={`${dependency.module_key}-${index}`}>
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-medium text-slate-900">{dependencyLabel(dependency)}</p>
                              {dependency.module_key !== "receiving_history" ? (
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{dependency.count}</span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-slate-600">{dependencyDescription(dependency)}</p>
                            {target ? (
                              <button
                                className="mt-2 inline-flex text-sm font-semibold text-orange-700 hover:text-orange-800"
                                onClick={() => showDependency(target.targetId)}
                                type="button"
                              >
                                {target.actionLabel}
                              </button>
                            ) : dependency.route ? (
                              <Link
                                className="mt-2 inline-flex text-sm font-semibold text-orange-700 hover:text-orange-800"
                                onClick={close}
                                to={dependency.route}
                              >
                                View records
                              </Link>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </>
            ) : null}
            {!preview || preview.allowed ? (
              <TextArea className="block" label={`${action === "restore" ? "Restore" : action === "archive" ? "Archive" : "Deletion"} reason *`} onChange={setReason} value={reason} />
            ) : null}
            {action === "delete" && preview?.allowed ? (
              <TextInput
                error={confirmation && !typedConfirmationMatches ? `Type ${preview.confirmation} exactly.` : undefined}
                label={`Type ${preview.confirmation} to confirm permanent deletion`}
                onChange={setConfirmation}
                required
                value={confirmation}
              />
            ) : null}
            {action === "delete" && preview?.allowed ? <p className="text-xs leading-5 text-rose-700">Permanent deletion has no undo. The server rechecks dependencies in the deletion transaction.</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
