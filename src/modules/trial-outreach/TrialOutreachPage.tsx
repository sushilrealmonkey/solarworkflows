import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { PageLoader } from "../../components/PageLoader";
import { useToast } from "../../components/ui/ToastProvider";
import { formatDisplayDateTime } from "../../utils/dateFormat";
import {
  claimTrialOutreachCall,
  fetchTrialOutreachCompany,
  fetchTrialOutreachDashboard,
  fetchTrialOutreachQueue,
  recordTrialOutreachBlocker,
  recordTrialOutreachOutcome,
  rescheduleTrialOutreachTouchpoint,
  updateTrialOutreachEnrollment,
} from "./trialOutreachApi";
import type {
  TrialEngagementSnapshot,
  TrialOutreachCompanyDetail,
  TrialOutreachDashboard,
} from "./types";

type QueueRow = TrialEngagementSnapshot;

const inputClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";

export function TrialOutreachPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [dashboard, setDashboard] = useState<TrialOutreachDashboard | null>(null);
  const [detail, setDetail] = useState<TrialOutreachCompanyDetail | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canAccess = Boolean(profile?.is_super_admin || profile?.platform_role === "backend_staff");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [queue, summary] = await Promise.all([
        fetchTrialOutreachQueue({ search, state: stateFilter || undefined, due: dueOnly }),
        fetchTrialOutreachDashboard(),
      ]);
      setRows(queue.companies);
      setDashboard(summary);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load trial outreach.");
    } finally {
      setLoading(false);
    }
  }, [dueOnly, search, stateFilter]);

  useEffect(() => {
    if (canAccess) void load();
    else setLoading(false);
  }, [canAccess, load]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    void fetchTrialOutreachCompany(selectedCompanyId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((nextError) => {
        if (!cancelled) showToast(nextError instanceof Error ? nextError.message : "Unable to load workspace details.", "error");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, showToast]);

  async function runAction(action: () => Promise<unknown>, message: string) {
    try {
      setBusy(message);
      await action();
      await load();
      if (selectedCompanyId) setDetail(await fetchTrialOutreachCompany(selectedCompanyId));
      showToast(message, "success");
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : "Trial outreach action failed.", "error");
    } finally {
      setBusy(null);
    }
  }

  if (!canAccess) {
    return <section className="rounded-xl border border-rose-200 bg-rose-50 p-6"><h1 className="text-xl font-semibold text-rose-950">Access denied</h1><p className="mt-2 text-sm text-rose-800">Trial Outreach is available to authorized platform staff.</p></section>;
  }

  const metrics: Array<[string, number | string | null | undefined]> = [
    ["Active trials", dashboard?.active_trial_count],
    ["Interventions due", dashboard?.interventions_due_count],
    ["No login in 24h", dashboard?.no_login_24h_count],
    ["Setup stalled", dashboard?.setup_stalled_count],
    ["No enquiry", dashboard?.no_enquiry_count],
    ["Inactive 48h", dashboard?.inactive_48h_count],
    ["High intent", dashboard?.high_intent_count],
    ["Value reached", dashboard?.value_reached_count],
    ["Team adoption", dashboard?.adoption_signal_count],
    ["Conversion tasks", dashboard?.conversion_tasks_due_count],
    ["Rescue tasks", dashboard?.rescue_tasks_due_count],
    ["Support escalations", dashboard?.support_escalation_count],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Trial Engagement" description="Review complete trial behavior and take the next best engagement action." />
        <button className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:border-orange-400 disabled:opacity-60" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <MetricCard key={label} label={label} value={numberValue(value)} />)}</section>
      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-end">
        <label className="text-sm font-semibold text-slate-700">Search company or contact<input className={inputClass} onChange={(event) => setSearch(event.target.value)} placeholder="Company, name, phone, email" value={search} /></label>
        <label className="text-sm font-semibold text-slate-700">Engagement state<select className={inputClass} onChange={(event) => setStateFilter(event.target.value)} value={stateFilter}><option value="">All states</option><option value="never_started">Never started</option><option value="started_stalled">Started, stalled</option><option value="activated_inactive">Activated, inactive</option><option value="engaged">Engaged</option><option value="converted">Converted</option><option value="expired">Expired</option></select></label>
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-700"><input checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} type="checkbox" />Tasks due now</label>
      </section>
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-stone-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-semibold text-slate-950">Behavior queue</h2><p className="mt-1 text-sm text-slate-600">{rows.length} workspace{rows.length === 1 ? "" : "s"} match the current filters. Click a row to view every detail.</p></div><p className="text-xs text-slate-500">Scroll horizontally on smaller screens to see all columns.</p></div>
        {loading ? <PageLoader label="Loading trial outreach queue…" /> : rows.length === 0 ? <div className="p-6 text-sm text-slate-500">No trial workspaces match these filters.</div> : <div className="overflow-x-auto"><table className="min-w-[1420px] w-full text-left text-sm"><thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Company & contact</th><th className="px-4 py-3">Trial</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Intent</th><th className="px-4 py-3">Next intervention</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3"><span className="sr-only">Open details</span></th></tr></thead><tbody className="divide-y divide-stone-200">{rows.map((row) => <QueueTableRow key={row.company_id} onSelect={() => setSelectedCompanyId(row.company_id)} row={row} selected={row.company_id === selectedCompanyId} />)}</tbody></table></div>}
      </section>
      <TrialOutreachModal busy={busy} detail={detail} loading={detailLoading} onAction={runAction} onClose={() => setSelectedCompanyId(null)} open={Boolean(selectedCompanyId)} />
    </div>
  );
}

function TrialOutreachModal({ busy, detail, loading, onAction, onClose, open }: { busy: string | null; detail: TrialOutreachCompanyDetail | null; loading: boolean; onAction: (action: () => Promise<unknown>, message: string) => Promise<void>; onClose: () => void; open: boolean }) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  const snapshot = detail?.snapshot;
  const title = snapshot?.company_name ?? (loading ? "Loading workspace" : "Workspace details");
  const contact = snapshot ? [snapshot.contact_name, snapshot.contact_phone ?? snapshot.contact_email].filter(Boolean).join(" · ") : "Behavior, evidence, interventions, and history";
  return createPortal(<div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}><section aria-labelledby="trial-outreach-detail-title" aria-modal="true" className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-stone-50 shadow-2xl sm:max-w-6xl sm:rounded-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white px-4 py-4 sm:px-6"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Trial workspace</p><h2 className="mt-1 truncate text-xl font-semibold text-slate-950 sm:text-2xl" id="trial-outreach-detail-title">{title}</h2><p className="mt-1 truncate text-sm text-slate-600">{contact}</p></div><button aria-label="Close workspace details" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-500 hover:bg-stone-100 hover:text-slate-950" onClick={onClose} type="button">×</button></header><div className="p-4 sm:p-6">{loading ? <PageLoader label="Loading workspace details…" /> : detail ? <DetailBody busy={busy} detail={detail} onAction={onAction} /> : <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-slate-600">Workspace details are unavailable.</p>}</div></section></div>, document.body);
}

function DetailBody({ busy, detail, onAction }: { busy: string | null; detail: TrialOutreachCompanyDetail; onAction: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState("connected");
  const [blocker, setBlocker] = useState("setup");
  const [notes, setNotes] = useState("");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const { snapshot } = detail;
  const task = detail.touchpoints.find((touchpoint) => ["call", "support"].includes(touchpoint.channel) && touchpoint.status === "due") ?? null;
  const paused = snapshot.enrollment_status === "paused";
  const terminal = ["converted", "expired", "opted_out", "completed"].includes(snapshot.enrollment_status ?? "");
  useEffect(() => {
    setNotes("");
    setRescheduleAt(task ? toDateTimeInput(task.scheduled_at) : "");
  }, [detail, task]);
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><MiniMetric label="Trial day" value={"Day " + snapshot.trial_day + "/14"} /><MiniMetric label="Remaining" value={snapshot.days_remaining + " days"} /><MiniMetric label="State" value={labelize(snapshot.engagement_state)} /><MiniMetric label="Intent score" value={numberValue(snapshot.intent_score) + "/100"} /><MiniMetric label="Intent tier" value={labelize(snapshot.intent_tier)} /><MiniMetric label="Next task" value={task ? labelize(task.channel) : "No task due"} /></section>
    <section className="rounded-xl border border-orange-100 bg-orange-50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold text-slate-950">Behavior evidence</h3><p className="mt-1 text-sm text-slate-600">All key evidence collected for this trial workspace.</p></div><div className="flex flex-wrap gap-2">{snapshot.is_high_intent ? <SignalBadge label="High intent" /> : null}{snapshot.value_reached ? <SignalBadge label="Value reached" /> : null}{snapshot.adoption_signal ? <SignalBadge label="Team adoption" /> : null}</div></div><dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"><EvidenceItem label="Subscription" value={labelize(snapshot.subscription_status)} /><EvidenceItem label="Onboarding" value={labelize(snapshot.onboarding_status) + " · " + labelize(snapshot.onboarding_step)} /><EvidenceItem label="First login" value={formatDisplayDateTime(snapshot.first_login_at)} /><EvidenceItem label="Last login" value={formatDisplayDateTime(snapshot.last_login_at)} /><EvidenceItem label="Last activity" value={formatDisplayDateTime(snapshot.last_activity_at)} /><EvidenceItem label="Sessions" value={String(numberValue(snapshot.login_event_count))} /><EvidenceItem label="Enquiries" value={numberValue(snapshot.lead_count) + " total · " + numberValue(snapshot.enquiry_without_followup_count) + " no follow-up"} /><EvidenceItem label="Products" value={String(numberValue(snapshot.product_count))} /><EvidenceItem label="Quotations" value={String(numberValue(snapshot.quotation_count))} /><EvidenceItem label="Customers" value={String(numberValue(snapshot.customer_count))} /><EvidenceItem label="Projects" value={String(numberValue(snapshot.project_count))} /><EvidenceItem label="Team invites" value={String(numberValue(snapshot.team_invite_count))} /><EvidenceItem label="Feature errors, 24h" value={String(numberValue(snapshot.feature_error_count_24h))} /><EvidenceItem label="Trial start" value={formatDisplayDateTime(snapshot.trial_started_at)} /><EvidenceItem label="Trial end" value={formatDisplayDateTime(snapshot.trial_ends_at)} /><EvidenceItem label="Timezone" value={snapshot.timezone} /></dl></section>
    <section className="grid gap-5 xl:grid-cols-2"><div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold text-slate-950">Engagement controls</h3><p className="mt-1 text-sm text-slate-600">Manage outreach and record the result of the current task.</p></div><div className="flex flex-wrap gap-2"><button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={!snapshot.enrollment_id || Boolean(busy)} onClick={() => snapshot.enrollment_id && void onAction(() => updateTrialOutreachEnrollment(snapshot.enrollment_id!, paused ? "resume" : "pause"), paused ? "Outreach resumed." : "Outreach paused.")} type="button">{paused ? "Resume outreach" : "Pause outreach"}</button><button className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" disabled={terminal || Boolean(busy)} onClick={() => snapshot.enrollment_id && void onAction(() => updateTrialOutreachEnrollment(snapshot.enrollment_id!, "stop"), "Outreach stopped.")} type="button">Stop outreach</button></div></div>
      {task ? <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-blue-950">{task.channel === "support" ? "Support escalation due" : "Call due"}</p><p className="mt-1 text-sm text-blue-900">{task.reason ?? "Help the client complete one real workflow."}</p></div><StatusBadge value={task.status} /></div><button className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => claimTrialOutreachCall(task.id), task.channel === "support" ? "Support task claimed." : "Call task claimed.")} type="button">Claim task</button><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-blue-950">Outcome<select className={inputClass} onChange={(event) => setOutcome(event.target.value)} value={outcome}><option value="connected">Connected</option><option value="no_answer">No answer</option><option value="requested_callback">Requested callback</option><option value="wrong_number">Wrong number</option><option value="do_not_contact">Do not contact</option><option value="resolved">Resolved</option><option value="not_resolved">Not resolved</option></select></label><label className="text-xs font-semibold text-blue-950">Blocker<select className={inputClass} onChange={(event) => setBlocker(event.target.value)} value={blocker}><option value="setup">Setup</option><option value="time">No time</option><option value="unclear_next_step">Unclear next step</option><option value="technical_issue">Technical issue</option><option value="pricing">Pricing</option><option value="other">Other</option></select></label></div><textarea className={inputClass + " min-h-20"} onChange={(event) => setNotes(event.target.value)} placeholder="Task notes" value={notes} /><div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end"><button className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => recordTrialOutreachOutcome(task.id, { outcome, blocker, notes }), "Task outcome saved.")} type="button">Save outcome</button><label className="text-xs font-semibold text-blue-950">Reschedule<input className={inputClass} onChange={(event) => setRescheduleAt(event.target.value)} type="datetime-local" value={rescheduleAt} /></label><button className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-900 disabled:opacity-50" disabled={!rescheduleAt || Boolean(busy)} onClick={() => void onAction(() => rescheduleTrialOutreachTouchpoint(task.id, new Date(rescheduleAt).toISOString()), "Task rescheduled.")} type="button">Reschedule</button></div></div> : <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-slate-600">No call or support task is due right now.</p>}
      {!terminal && snapshot.enrollment_id ? <div className="space-y-2 rounded-lg border border-stone-200 p-3"><p className="font-semibold text-slate-950">Record blocker</p><textarea className={inputClass + " min-h-20"} onChange={(event) => setNotes(event.target.value)} placeholder="What should the team know?" value={notes} /><button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => recordTrialOutreachBlocker(snapshot.enrollment_id!, { blocker, notes }), "Blocker saved.")} type="button">Save blocker</button></div> : null}
    </div><History title="Portal activity" emptyLabel="No portal activity captured yet.">{detail.activities.map((activity) => <HistoryItem key={activity.id} title={labelize(activity.event_key)} meta={labelize(activity.module) + (activity.route ? " · " + activity.route : "") + " · " + labelize(activity.source)} time={activity.occurred_at} />)}</History></section>
    <section className="grid gap-5 xl:grid-cols-2"><History title="Intervention timeline" emptyLabel="No interventions have been scheduled yet.">{detail.touchpoints.slice().reverse().map((touchpoint) => <HistoryItem key={touchpoint.id} badge={touchpoint.status} meta={labelize(touchpoint.channel) + " · " + labelize(touchpoint.priority) + " · " + (touchpoint.reason ?? labelize(touchpoint.touchpoint_key))} time={touchpoint.scheduled_at} title={labelize(touchpoint.trigger_key ?? touchpoint.touchpoint_key)} />)}</History><History title="Interaction history" emptyLabel="No interactions recorded yet.">{detail.interactions.map((interaction) => <HistoryItem key={interaction.id} meta={labelize(interaction.channel) + (interaction.outcome ? " · " + labelize(interaction.outcome) : "") + (interaction.blocker ? " · Blocker: " + labelize(interaction.blocker) : "") + (interaction.notes ? " · " + interaction.notes : "")} time={interaction.occurred_at} title={labelize(interaction.interaction_type)} />)}</History></section>
  </div>;
}

function QueueTableRow({ onSelect, row, selected }: { onSelect: () => void; row: QueueRow; selected: boolean }) {
  const nextAction = row.due_task ? (row.due_task.channel === "support" ? "Support task" : "Call task") + " · " + labelize(row.due_task.priority) : row.next_touchpoint ? labelize(row.next_touchpoint.trigger_key ?? row.next_touchpoint.key) : "No intervention scheduled";
  const nextAt = row.next_touchpoint?.scheduled_at ?? null;
  return <tr aria-label={"Open details for " + (row.company_name ?? "workspace")} className={"cursor-pointer transition focus-visible:bg-orange-50 " + (selected ? "bg-orange-50" : "hover:bg-stone-50")} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} tabIndex={0}>
    <td className="min-w-[250px] px-4 py-4 align-top"><p className="font-semibold text-slate-950">{row.company_name ?? "Unnamed company"}</p><p className="mt-1 text-xs text-slate-600">{row.contact_name ?? "No contact"}{row.contact_phone || row.contact_email ? " · " + (row.contact_phone ?? row.contact_email) : ""}</p></td>
    <td className="min-w-[115px] px-4 py-4 align-top"><p className="font-semibold text-slate-800">Day {row.trial_day}/14</p><p className="mt-1 text-xs text-slate-500">{row.days_remaining} days left</p></td>
    <td className="min-w-[145px] px-4 py-4 align-top"><StatusBadge value={row.engagement_state} /><p className="mt-2 text-xs text-slate-500">{labelize(row.enrollment_status)}</p></td>
    <td className="min-w-[275px] px-4 py-4 align-top"><div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-slate-600"><span>Sessions <strong className="text-slate-950">{numberValue(row.login_event_count)}</strong></span><span>Setup <strong className="text-slate-950">{labelize(row.onboarding_status)}</strong></span><span>Enquiries <strong className="text-slate-950">{numberValue(row.lead_count)}</strong></span><span>No follow-up <strong className="text-slate-950">{numberValue(row.enquiry_without_followup_count)}</strong></span><span>Products <strong className="text-slate-950">{numberValue(row.product_count)}</strong></span><span>Quotations <strong className="text-slate-950">{numberValue(row.quotation_count)}</strong></span></div></td>
    <td className="min-w-[155px] px-4 py-4 align-top"><p className="font-semibold text-slate-800">{numberValue(row.intent_score)}/100</p><p className="mt-1 text-xs text-slate-600">{labelize(row.intent_tier)}</p><div className="mt-2 flex flex-wrap gap-1">{row.is_high_intent ? <SmallSignal label="High" /> : null}{row.value_reached ? <SmallSignal label="Value" /> : null}{row.adoption_signal ? <SmallSignal label="Team" /> : null}</div></td>
    <td className="min-w-[245px] px-4 py-4 align-top"><p className="font-medium text-slate-800">{nextAction}</p><p className="mt-1 text-xs text-slate-500">{nextAt ? formatDisplayDateTime(nextAt) : "No date scheduled"}</p></td>
    <td className="min-w-[165px] px-4 py-4 align-top text-xs text-slate-600">{formatDisplayDateTime(row.last_activity_at)}</td>
    <td className="w-28 px-4 py-4 align-top text-right"><button className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-orange-400 hover:text-orange-800" onClick={(event) => { event.stopPropagation(); onSelect(); }} type="button">View details</button></td>
  </tr>;
}

function History({ children, emptyLabel, title }: { children: Array<React.ReactElement>; emptyLabel: string; title: string }) { return <section className="rounded-xl border border-stone-200 bg-white p-4"><h3 className="font-semibold text-slate-950">{title}</h3><div className="mt-3 space-y-2">{children.length ? children : <p className="text-sm text-slate-500">{emptyLabel}</p>}</div></section>; }
function HistoryItem({ badge, meta, time, title }: { badge?: string; meta: string; time: string; title: string }) { return <div className="rounded-lg border border-stone-100 bg-stone-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-800">{title}</p><p className="mt-1 break-words text-xs text-slate-600">{meta}</p></div>{badge ? <StatusBadge value={badge} /> : <time className="shrink-0 text-right text-xs text-slate-500">{formatDisplayDateTime(time)}</time>}</div>{badge ? <p className="mt-1 text-xs text-slate-500">{formatDisplayDateTime(time)}</p> : null}</div>; }
function MetricCard({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p></div>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-stone-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-950">{value}</p></div>; }
function EvidenceItem({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-800">{value}</dd></div>; }
function SignalBadge({ label }: { label: string }) { return <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{label}</span>; }
function SmallSignal({ label }: { label: string }) { return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">{label}</span>; }
function StatusBadge({ value }: { value: string | null | undefined }) { const tone = ["engaged", "converted", "delivered", "read", "sent"].includes(value ?? "") ? "green" : ["expired", "failed", "opted_out", "cancelled"].includes(value ?? "") ? "red" : "amber"; return <span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-semibold " + (tone === "green" ? "bg-emerald-50 text-emerald-700" : tone === "red" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>{labelize(value)}</span>; }
function numberValue(value: number | string | null | undefined) { const number = Number(value ?? 0); return Number.isFinite(number) ? number : 0; }
function toDateTimeInput(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16); }
function labelize(value: string | null | undefined) { return (value ?? "—").replace(/_/g, " ").replace(/\b\w/g, (character: string) => character.toUpperCase()); }
