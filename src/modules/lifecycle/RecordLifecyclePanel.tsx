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

const dependencyNames: Partial<Record<string, string>> = {
  b2b_sale_items: "Sale items",
  billing_links: "Billing records",
  bom_template_lines: "BOM template lines",
  category_usage: "Product and BOM usage",
  documents: "Documents",
  financial_history: "Financial history",
  inventory: "Inventory history",
  inventory_transactions: "Stock movements",
  inventory_usage: "Inventory history",
  invoice_items: "Invoice items",
  invoices: "Invoices",
  lead_followups: "Lead follow-ups",
  leads: "Leads",
  payments: "Payments",
  product_usage: "Product and pricing history",
  proforma_invoice_items: "Proforma invoice items",
  proforma_invoices: "Proforma invoices",
  projects: "Projects",
  purchase_order_items: "Purchase order items",
  purchase_orders: "Purchase orders",
  quotation_bom_items: "Quotation BOM history",
  quotation_components: "Quotation details",
  quotations: "Quotations",
  receiving_history: "Material received",
  sale_workflow: "Sales workflow history",
  site_surveys: "Site surveys",
  storage_objects: "Stored files",
};

type DependencyTarget = {
  actionLabel: string;
  targetId: string;
};

function blockedActionMessage(preview: LifecyclePreview, action: LifecycleAction) {
  if (preview.guidance.includes("required module permission")) {
    return `You do not have permission to ${action} this record.`;
  }

  if (preview.guidance.includes("restricted to tenant Admins")) {
    return "Only an administrator can permanently delete this record.";
  }

  if (action === "archive") {
    return "This record still has active work or is not in a final status. Complete or cancel it before archiving.";
  }

  if (action === "restore") {
    return preview.archived_at
      ? "This record cannot be restored right now."
      : "This record is already active and does not need to be restored.";
  }

  const hasReceivingHistory = preview.dependencies.some(
    (dependency) => dependency.module_key === "receiving_history",
  );

  if (preview.module_key === "purchase_orders" && hasReceivingHistory) {
    return "Material has already been received for this PO. This created stock history that must be kept, so the PO cannot be permanently deleted. Archive it instead.";
  }

  if (preview.dependencies.some((dependency) => dependency.kind === "historical")) {
    return "This record has history that must be kept, so it cannot be permanently deleted. Archive it instead.";
  }

  if (preview.dependencies.some((dependency) => dependency.kind === "open")) {
    return "Finish or cancel the linked open records before deleting this record.";
  }

  return "This record cannot be deleted in its current status. Archive it instead.";
}

function allowedActionMessage(action: LifecycleAction) {
  if (action === "archive") {
    return "Archiving removes this record from active lists but keeps its history and links. You can restore it later.";
  }

  if (action === "restore") {
    return "Restoring returns this record to active lists. Its current status and history will stay the same.";
  }

  return "This record has no history that must be kept and can be permanently deleted.";
}

function actionMessage(preview: LifecyclePreview, action: LifecycleAction) {
  return preview.allowed
    ? allowedActionMessage(action)
    : blockedActionMessage(preview, action);
}

function actionMessageTitle(preview: LifecyclePreview, action: LifecycleAction) {
  if (!preview.allowed) {
    if (action === "delete") return "Why this cannot be deleted";
    if (action === "archive") return "Why this cannot be archived";
    return "Why this cannot be restored";
  }

  if (action === "archive") return "Archive and keep history";
  if (action === "restore") return "Restore to active records";
  return "Permanent deletion";
}

function dependencyDescription(dependency: LifecycleDependency, previewAllowed: boolean) {
  if (dependency.module_key === "receiving_history") {
    return "Received stock must keep its link to this purchase order.";
  }

  if (previewAllowed) {
    return "This belongs to the record and will be removed with it.";
  }

  if (dependency.kind === "open") {
    return "Complete or cancel this linked work before deleting.";
  }

  return "This history must be kept and prevents permanent deletion.";
}

function dependencyLabel(dependency: LifecycleDependency) {
  return dependency.label
    || dependencyNames[dependency.module_key]
    || dependency.module_key.split("_").join(" ");
}

function reasonLabel(action: LifecycleAction) {
  if (action === "archive") return "Why are you archiving this record? *";
  if (action === "restore") return "Why are you restoring this record? *";
  return "Reason for permanent deletion *";
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

  const typedConfirmationMatches = action !== "delete" || confirmation.trim() === preview?.confirmation;
  const canSubmit = Boolean(preview?.allowed && reason.trim() && typedConfirmationMatches && !loading);
  const displayedDependencies = action === "delete" && preview
    ? preview.dependencies.filter((dependency) => (
        preview.allowed ? dependency.kind === "owned" : dependency.kind !== "owned"
      ))
    : [];

  return (
    <div className="space-y-3">
      {!compact ? <ArchivedRecordBanner archivedAt={archivedAt} reason={archiveReason} /> : null}
      {(canUpdate || canDelete) ? (
        <section className={compact ? "" : "rounded-xl border border-stone-200 bg-white p-4 shadow-sm"}>
          <div className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}>
            {!compact ? (
              <div>
                <h2 className="font-semibold text-slate-950">Record lifecycle</h2>
                <p className="mt-1 text-sm text-slate-600">Archive keeps the record and its history. Permanent deletion removes unused records.</p>
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
          maxWidthClass={action === "delete" ? "sm:max-w-2xl" : "sm:max-w-xl"}
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
            {loading ? <p className="text-sm text-slate-600">Checking whether this action is available…</p> : null}
            {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
            {preview ? (
              <>
                <div className={`rounded-lg border p-3 text-sm ${preview.allowed ? action === "delete" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
                  <p className="font-semibold">{actionMessageTitle(preview, action)}</p>
                  <p className="mt-1">{actionMessage(preview, action)}</p>
                </div>
                {displayedDependencies.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-slate-900">{preview.allowed ? "Also removed" : "What is blocking deletion"}</h3>
                    <div className="mt-2 space-y-2">
                      {displayedDependencies.map((dependency, index) => {
                        const target = dependencyTargets?.[dependency.module_key];
                        return (
                          <div className="rounded-lg border border-stone-200 p-3 text-sm" key={`${dependency.module_key}-${index}`}>
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-medium text-slate-900">{dependencyLabel(dependency)}</p>
                              {dependency.module_key !== "receiving_history" ? (
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{dependency.count}</span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-slate-600">{dependencyDescription(dependency, preview.allowed)}</p>
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
                                View linked records
                              </Link>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}
            {!preview || preview.allowed ? (
              <TextArea className="block" label={reasonLabel(action)} onChange={setReason} value={reason} />
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
            {action === "delete" && preview?.allowed ? <p className="text-xs leading-5 text-rose-700">Permanent deletion cannot be undone.</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
