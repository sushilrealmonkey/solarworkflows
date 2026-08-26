import { useCallback, useEffect, useState } from "react";
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

const inputClass = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100";

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
    setDetailLoading(true);
    void fetchTrialOutreachCompany(selectedCompanyId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((nextError) => {
        if (!cancelled) showToast(nextError instanceof Error ? nextError.message : "Unable to load company outreach.", "error");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedCompanyId, showToast]);

  async function refreshAfter(action: () => Promise<unknown>, message: string) {
    try {
      setBusy(message);
      await action();
      await load();
      if (selectedCompanyId) setDetail((await fetchTrialOutreachCompany(selectedCompanyId)));
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
    ["Enrolled this month", dashboard?.enrolled_count],
    ["No login", dashboard?.no_login_count],
    ["No first value", dashboard?.no_first_value_count],
    ["Calls due today", dashboard?.calls_due_today_count],
    ["First value by day 7", dashboard?.first_value_day_7_count],
    ["Converted", dashboard?.converted_count],
    ["Replies", dashboard?.replies_count],
    ["Delivery failures", dashboard?.failed_delivery_count],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Trial Outreach" description="Help trial workspaces reach their first useful solar workflow before the 14-day trial ends." />
        <button className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:border-orange-400 disabled:opacity-60" disabled={loading} onClick={() => void load()} type="button">{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => <MetricCard key={label} label={label} value={numberValue(value)} />)}
      </section>

      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-end">
        <label className="text-sm font-semibold text-slate-700">Search company or contact<input className={`${inputClass} mt-1 font-normal`} onChange={(event) => setSearch(event.target.value)} placeholder="Company, name, phone, email" value={search} /></label>
        <label className="text-sm font-semibold text-slate-700">Engagement state<select className={`${inputClass} mt-1 font-normal`} onChange={(event) => setStateFilter(event.target.value)} value={stateFilter}><option value="">All states</option><option value="never_started">Never started</option><option value="started_stalled">Started, stalled</option><option value="activated_inactive">Activated, inactive</option><option value="engaged">Engaged</option><option value="converted">Converted</option><option value="expired">Expired</option></select></label>
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-700"><input checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} type="checkbox" />Calls due today</label>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-4 py-4"><h2 className="font-semibold text-slate-950">Activation queue</h2><p className="mt-1 text-sm text-slate-600">{rows.length} workspace{rows.length === 1 ? "" : "s"} match the current filters.</p></div>
          {loading ? <PageLoader label="Loading trial outreach queue…" /> : rows.length === 0 ? <div className="p-6 text-sm text-slate-500">No trial workspaces match these filters.</div> : (
            <>
              <div className="divide-y divide-stone-200 md:hidden">{rows.map((row) => <QueueCard key={row.company_id} row={row} selected={row.company_id === selectedCompanyId} onSelect={() => setSelectedCompanyId(row.company_id)} />)}</div>
              <div className="hidden overflow-x-auto md:block"><table className="min-w-[920px] w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Trial</th><th className="px-4 py-3">State</th><th className="px-4 py-3">First value</th><th className="px-4 py-3">Next touch</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-stone-200">{rows.map((row) => <QueueTableRow key={row.company_id} row={row} selected={row.company_id === selectedCompanyId} onSelect={() => setSelectedCompanyId(row.company_id)} />)}</tbody></table></div>
            </>
          )}
        </section>

        <DetailPanel detail={detail} loading={detailLoading} busy={busy} onAction={refreshAfter} />
      </div>
    </div>
  );
}

function DetailPanel({ detail, loading, busy, onAction }: { detail: TrialOutreachCompanyDetail | null; loading: boolean; busy: string | null; onAction: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState("connected");
  const [blocker, setBlocker] = useState("setup");
  const [notes, setNotes] = useState("");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  useEffect(() => {
    const dueCall = detail?.touchpoints.find((touchpoint) => touchpoint.channel === "call" && touchpoint.status === "due") ?? null;
    setSelectedCallId(dueCall?.id ?? null);
    setNotes("");
    setRescheduleAt(dueCall ? toDateTimeInput(dueCall.scheduled_at) : "");
  }, [detail]);

  if (loading) return <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><PageLoader label="Loading outreach timeline…" /></section>;
  if (!detail) return <section className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-sm text-slate-500">Select a workspace to review its progress, touchpoints, and call history.</section>;

  const { snapshot } = detail;
  const call = selectedCallId ? detail.touchpoints.find((touchpoint) => touchpoint.id === selectedCallId) : null;
  const paused = snapshot.enrollment_status === "paused";
  const terminal = ["converted", "expired", "opted_out", "completed"].includes(snapshot.enrollment_status ?? "");

  return <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Selected workspace</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{snapshot.company_name ?? "Unnamed company"}</h2><p className="mt-1 text-sm text-slate-600">{snapshot.contact_name ?? "No contact"} · {snapshot.contact_phone ?? snapshot.contact_email ?? "No contact details"}</p></div>
    <div className="grid grid-cols-2 gap-3"><MiniMetric label="Trial day" value={`${snapshot.trial_day}/14`} /><MiniMetric label="Remaining" value={`${snapshot.days_remaining}d`} /><MiniMetric label="State" value={labelize(snapshot.engagement_state)} /><MiniMetric label="First value" value={snapshot.first_value_reached ? labelize(snapshot.first_value_kind) : "Not yet"} /></div>
    <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 text-sm text-slate-700"><p className="font-semibold text-slate-950">First-value progress</p><p className="mt-1">{snapshot.first_value_progress.input_count} lead/customer record{snapshot.first_value_progress.input_count === 1 ? "" : "s"} · {snapshot.first_value_progress.workflow_count} workflow record{snapshot.first_value_progress.workflow_count === 1 ? "" : "s"}</p><p className="mt-1 text-xs text-slate-600">Last activity: {formatDisplayDateTime(snapshot.last_activity_at)}</p></div>
    <div className="flex flex-wrap gap-2"><button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={!snapshot.enrollment_id || Boolean(busy)} onClick={() => snapshot.enrollment_id && void onAction(() => updateTrialOutreachEnrollment(snapshot.enrollment_id!, paused ? "resume" : "pause"), paused ? "Outreach resumed." : "Outreach paused.")} type="button">{paused ? "Resume outreach" : "Pause outreach"}</button><button className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" disabled={terminal || Boolean(busy)} onClick={() => snapshot.enrollment_id && void onAction(() => updateTrialOutreachEnrollment(snapshot.enrollment_id!, "stop"), "Outreach stopped.")} type="button">Stop outreach</button></div>

    {call ? <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><div><p className="font-semibold text-blue-950">Call due</p><p className="mt-1 text-sm text-blue-900">{typeof call.metadata?.call_script === "string" ? call.metadata.call_script : "Help the client complete one real workflow."}</p></div><button className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => claimTrialOutreachCall(call.id), "Call task claimed.")} type="button">Claim call</button><select className={inputClass} onChange={(event) => setOutcome(event.target.value)} value={outcome}><option value="connected">Connected</option><option value="no_answer">No answer</option><option value="requested_callback">Requested callback</option><option value="wrong_number">Wrong number</option><option value="do_not_contact">Do not contact</option></select><select className={inputClass} onChange={(event) => setBlocker(event.target.value)} value={blocker}><option value="setup">Setup</option><option value="time">No time</option><option value="unclear_next_step">Unclear next step</option><option value="technical_issue">Technical issue</option><option value="pricing">Pricing</option><option value="other">Other</option></select><textarea className={`${inputClass} min-h-20`} onChange={(event) => setNotes(event.target.value)} placeholder="Call notes" value={notes} /><button className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => recordTrialOutreachOutcome(call.id, { outcome, blocker, notes }), "Call outcome saved.")} type="button">Save call outcome</button><div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-xs font-semibold text-blue-950">Reschedule<input className={`${inputClass} mt-1`} onChange={(event) => setRescheduleAt(event.target.value)} type="datetime-local" value={rescheduleAt} /></label><button className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-900 disabled:opacity-50" disabled={!rescheduleAt || Boolean(busy)} onClick={() => void onAction(() => rescheduleTrialOutreachTouchpoint(call.id, new Date(rescheduleAt).toISOString()), "Call rescheduled.")} type="button">Reschedule</button></div></div> : null}

    {!terminal && snapshot.enrollment_id ? <div className="space-y-3 rounded-lg border border-stone-200 p-3"><p className="font-semibold text-slate-950">Record blocker</p><select className={inputClass} onChange={(event) => setBlocker(event.target.value)} value={blocker}><option value="setup">Setup</option><option value="time">No time</option><option value="unclear_next_step">Unclear next step</option><option value="technical_issue">Technical issue</option><option value="pricing">Pricing</option><option value="other">Other</option></select><textarea className={`${inputClass} min-h-20`} onChange={(event) => setNotes(event.target.value)} placeholder="What should the team know?" value={notes} /><button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void onAction(() => recordTrialOutreachBlocker(snapshot.enrollment_id!, { blocker, notes }), "Blocker saved.")} type="button">Save blocker</button></div> : null}

    <div><p className="mb-2 font-semibold text-slate-950">Touchpoint timeline</p><div className="space-y-2">{detail.touchpoints.slice().reverse().slice(0, 8).map((touchpoint) => <div className="flex items-start justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50 p-3 text-sm" key={touchpoint.id}><div><p className="font-medium text-slate-800">Day {touchpoint.sequence_day} · {labelize(touchpoint.touchpoint_key)} · {touchpoint.channel}</p><p className="mt-1 text-xs text-slate-500">{formatDisplayDateTime(touchpoint.scheduled_at)}</p></div><StatusBadge value={touchpoint.status} /></div>)}</div></div>
    <div><p className="mb-2 font-semibold text-slate-950">Interaction history</p>{detail.interactions.length ? <div className="space-y-2">{detail.interactions.slice(0, 6).map((interaction) => <div className="rounded-lg border border-stone-100 p-3 text-sm" key={interaction.id}><div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-800">{labelize(interaction.interaction_type)}</span><span className="text-xs text-slate-500">{formatDisplayDateTime(interaction.occurred_at)}</span></div>{interaction.blocker ? <p className="mt-1 text-xs text-orange-700">Blocker: {labelize(interaction.blocker)}</p> : null}{interaction.notes ? <p className="mt-1 text-xs text-slate-600">{interaction.notes}</p> : null}</div>)}</div> : <p className="text-sm text-slate-500">No interactions recorded yet.</p>}</div>
  </section>;
}

function QueueCard({ row, selected, onSelect }: { row: QueueRow; selected: boolean; onSelect: () => void }) {
  return <button className={`w-full p-4 text-left transition ${selected ? "bg-orange-50" : "hover:bg-stone-50"}`} onClick={onSelect} type="button"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{row.company_name ?? "Unnamed company"}</p><p className="mt-1 text-sm text-slate-600">{row.contact_name ?? "No contact"} · {row.contact_phone ?? "No phone"}</p></div><StatusBadge value={row.engagement_state} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600"><span>Day <strong className="text-slate-950">{row.trial_day}/14</strong></span><span>Left <strong className="text-slate-950">{row.days_remaining}d</strong></span><span>Value <strong className="text-slate-950">{row.first_value_reached ? "Yes" : "No"}</strong></span></div><p className="mt-3 text-xs text-orange-700">{row.due_call ? "Call due today" : row.next_touchpoint ? `${labelize(row.next_touchpoint.key)} · ${formatDisplayDateTime(row.next_touchpoint.scheduled_at)}` : "No next touchpoint"}</p></button>;
}

function QueueTableRow({ row, selected, onSelect }: { row: QueueRow; selected: boolean; onSelect: () => void }) {
  return <tr className={selected ? "bg-orange-50" : undefined}><td className="px-4 py-3"><button className="text-left" onClick={onSelect} type="button"><p className="font-semibold text-slate-950">{row.company_name ?? "Unnamed company"}</p><p className="mt-1 text-xs text-slate-500">{row.contact_name ?? "No contact"} · {row.contact_phone ?? "No phone"}</p></button></td><td className="px-4 py-3 text-slate-700">Day {row.trial_day}/14<br /><span className="text-xs text-slate-500">{row.days_remaining} days left</span></td><td className="px-4 py-3"><StatusBadge value={row.engagement_state} /></td><td className="px-4 py-3 text-slate-700">{row.first_value_reached ? labelize(row.first_value_kind) : "Not reached"}<br /><span className="text-xs text-slate-500">{row.first_value_progress.input_count} inputs · {row.first_value_progress.workflow_count} workflows</span></td><td className="px-4 py-3 text-xs text-slate-600">{row.due_call ? "Call due today" : row.next_touchpoint ? `${labelize(row.next_touchpoint.key)}\n${formatDisplayDateTime(row.next_touchpoint.scheduled_at)}` : "—"}</td><td className="px-4 py-3"><button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-slate-700" onClick={onSelect} type="button">Review</button></td></tr>;
}

function MetricCard({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p></div>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-stone-200 bg-stone-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-950">{value}</p></div>; }
function StatusBadge({ value }: { value: string | null | undefined }) { const tone = ["engaged", "converted", "delivered", "read", "sent"].includes(value ?? "") ? "green" : ["expired", "failed", "opted_out", "cancelled"].includes(value ?? "") ? "red" : "amber"; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone === "green" ? "bg-emerald-50 text-emerald-700" : tone === "red" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{labelize(value)}</span>; }
function numberValue(value: number | string | null | undefined) { const number = Number(value ?? 0); return Number.isFinite(number) ? number : 0; }
function toDateTimeInput(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16); }
function labelize(value: string | null | undefined) { return (value ?? "—").replace(/_/g, " ").replace(/\b\w/g, (character: string) => character.toUpperCase()); }
