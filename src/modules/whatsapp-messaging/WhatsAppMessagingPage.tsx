import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import {
  controlCampaign, createCampaign, fetchCampaigns, fetchContactLists,
  fetchConversationMessages, fetchConversations, fetchOutreachSettings,
  fetchRecentWhatsAppMessages, fetchWhatsAppPhoneNumbers, fetchWhatsAppTemplates,
  fetchWorkerHealth, importContactList, processCampaignsNow, saveOutreachSettings,
  sendFreeFormReply, fetchDailyQueue,
  updateCampaignDailyLimit,
} from "./whatsappMessagingApi";
import type {
  WhatsAppCampaign, WhatsAppContactList, WhatsAppConversation, WhatsAppMessage,
  WhatsAppPhoneNumber, WhatsAppTemplate, WhatsAppThreadMessage, WhatsAppWorkerHealth,
  WhatsAppDailyQueue,
} from "./types";

type Tab = "today" | "campaigns" | "contacts" | "inbox" | "activity" | "settings";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "today", label: "Today’s Contacts" }, { id: "campaigns", label: "Campaigns" },
  { id: "contacts", label: "Contact Lists" },
  { id: "inbox", label: "Inbox" }, { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

export function WhatsAppMessagingPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("today");
  const [phoneNumbers, setPhoneNumbers] = useState<WhatsAppPhoneNumber[]>([]);
  const [lists, setLists] = useState<WhatsAppContactList[]>([]);
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [workerHealth, setWorkerHealth] = useState<WhatsAppWorkerHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyId = profile?.company_id ?? "";

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [numbers, contactLists, campaignRows, conversationRows, activity, worker] = await Promise.all([
        fetchWhatsAppPhoneNumbers(), fetchContactLists(), fetchCampaigns(),
        fetchConversations(), fetchRecentWhatsAppMessages(), fetchWorkerHealth(),
      ]);
      setPhoneNumbers(numbers); setLists(contactLists); setCampaigns(campaignRows);
      setConversations(conversationRows); setMessages(activity); setWorkerHealth(worker);
    } catch (loadError) {
      setError(messageOf(loadError));
    }
  }, []);

  const canAccess = Boolean(profile?.is_super_admin || profile?.platform_role === "backend_staff");
  useEffect(() => { if (canAccess) void refresh(); }, [canAccess, refresh]);

  if (!canAccess) return <AccessDenied />;
  return (
    <div className="space-y-5">
      <PageHeader title="WhatsApp Outreach"
        description="Import opted-in prospects, run controlled template campaigns, and manage replies." />
      <nav className="flex gap-2 overflow-x-auto rounded-xl border border-stone-200 bg-white p-2 shadow-sm">
        {tabs.map((item) => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)}
            className={`min-h-10 shrink-0 rounded-lg px-4 text-sm font-semibold ${tab === item.id ? "bg-[#06173f] text-white" : "text-slate-600 hover:bg-stone-50"}`}>
            {item.label}
          </button>
        ))}
      </nav>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {tab === "today" ? <TodayQueue campaigns={campaigns}
        showToast={showToast} /> : null}
      {tab === "campaigns" ? <Campaigns companyId={companyId} phoneNumbers={phoneNumbers}
        lists={lists} campaigns={campaigns} workerHealth={workerHealth}
        onChanged={refresh} showToast={showToast} /> : null}
      {tab === "contacts" ? <ContactLists phoneNumbers={phoneNumbers} lists={lists}
        onChanged={refresh} showToast={showToast} /> : null}
      {tab === "inbox" ? <Inbox conversations={conversations} /> : null}
      {tab === "activity" ? <Activity messages={messages} onRefresh={refresh} /> : null}
      {tab === "settings" ? <Settings companyId={companyId} showToast={showToast} /> : null}
    </div>
  );
}

function Campaigns({ companyId, phoneNumbers, lists, campaigns, workerHealth, onChanged, showToast }: {
  companyId: string; phoneNumbers: WhatsAppPhoneNumber[]; lists: WhatsAppContactList[];
  campaigns: WhatsAppCampaign[]; workerHealth: WhatsAppWorkerHealth | null;
  onChanged: () => Promise<void>;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const campaignPagination = useTablePagination(campaigns, 5);
  const [form, setForm] = useState({ name: "", phoneNumberId: "", contactListId: "",
    templateKey: "", batchSize: "20", delaySeconds: "5", dailyMessageLimit: "10", scheduledAt: "",
    dailySendTime: "09:00", sendTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    variableMappings: [] as string[] });
  const selectedTemplate = useMemo(
    () => templates.find((item) => `${item.name}:${item.language}` === form.templateKey) ?? null,
    [form.templateKey, templates],
  );
  useEffect(() => {
    if (!form.phoneNumberId) { setTemplates([]); return; }
    void fetchWhatsAppTemplates(form.phoneNumberId).then(setTemplates).catch((e) => showToast(messageOf(e), "error"));
  }, [form.phoneNumberId, showToast]);
  const compatibleLists = useMemo(() => {
    const sender = phoneNumbers.find((item) => item.id === form.phoneNumberId);
    return sender ? lists.filter((item) => item.company_id === sender.companyId) : [];
  }, [form.phoneNumberId, lists, phoneNumbers]);
  async function submit(event: FormEvent) {
    event.preventDefault(); const [templateName, templateLanguage] = form.templateKey.split(":");
    setBusy(true);
    try {
      await createCampaign({ ...form, templateName, templateLanguage,
        batchSize: Number(form.batchSize), delaySeconds: Number(form.delaySeconds),
        dailyMessageLimit: Number(form.dailyMessageLimit),
        dailySendTime: form.dailySendTime, sendTimezone: form.sendTimezone,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        variableMappings: form.variableMappings });
      showToast("Campaign created.", "success"); setForm({ ...form, name: "", templateKey: "", variableMappings: [] });
      await onChanged();
    } catch (e) { showToast(messageOf(e), "error"); } finally { setBusy(false); }
  }
  async function act(campaign: WhatsAppCampaign, action: string) {
    if (action === "start") {
      const recipientCount = Object.values(campaign.recipientSummary?.counts ?? {})
        .reduce((total, count) => total + count, 0);
      const sender = campaign.whatsapp_phone_numbers?.verified_name ||
        campaign.whatsapp_phone_numbers?.display_phone_number || "Unknown sender";
      const confirmed = window.confirm(
        `Start “${campaign.name}”?\n\nSender: ${sender}\nTemplate: ${campaign.template_name} (${campaign.template_language})\nRecipients: ${recipientCount}\n\nOnly opted-in, non-opted-out contacts will be eligible.`,
      );
      if (!confirmed) return;
    }
    try { await controlCampaign(campaign.id, action); await onChanged(); showToast(`Campaign ${action}ed.`, "success"); }
    catch (e) { showToast(messageOf(e), "error"); }
  }
  async function processNow() {
    setBusy(true);
    try {
      const result = await processCampaignsNow();
      showToast(`Worker processed ${result.claimed} recipient${result.claimed === 1 ? "" : "s"}; ${result.sent} sent.`, "success");
      await onChanged();
    } catch (e) { showToast(messageOf(e), "error"); } finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-950">Delivery worker</h2>
            <Badge>{workerHealth?.cronActive ? "Cron active" : "Cron unavailable"}</Badge>
            <Badge>{workerHealth?.testMode ? "Test mode" : "Live mode"}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Last run: {formatDateTime(workerHealth?.lastRunAt)}
            {" · "}Next run: {formatDateTime(workerHealth?.nextRunAt)}
            {workerHealth?.lastHttpStatus ? ` · HTTP ${workerHealth.lastHttpStatus}` : ""}
          </p>
          {workerHealth?.lastResponse ? <p className="mt-1 text-xs text-slate-500">
            Claimed {workerHealth.lastResponse.claimed ?? 0} · sent {workerHealth.lastResponse.sent ?? 0}
            {" · "}retried {workerHealth.lastResponse.retried ?? 0} · failed {workerHealth.lastResponse.failed ?? 0}
          </p> : null}
        </div>
        <button type="button" className={primary} disabled={busy} onClick={() => void processNow()}>
          {busy ? "Processing…" : "Process now"}
        </button>
      </div>
    </section>
    <div className="grid gap-5 xl:grid-cols-[minmax(360px,.75fr)_1fr]">
    <Panel title="Create campaign" eyebrow="Approved template">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Campaign name"><input className={input} required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="From number"><select className={input} required value={form.phoneNumberId}
          onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value, contactListId: "", templateKey: "", variableMappings: [] })}>
          <option value="">Select number</option>{phoneNumbers.map((p) => <option key={p.id} value={p.id}>{p.verifiedName || p.displayPhoneNumber}</option>)}
        </select></Field>
        <Field label="Contact list"><select className={input} required value={form.contactListId}
          onChange={(e) => setForm({ ...form, contactListId: e.target.value })}>
          <option value="">{form.phoneNumberId ? "Select list" : "Select sender first"}</option>{compatibleLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.contact_count})</option>)}
        </select></Field>
        <Field label="Template"><select className={input} required value={form.templateKey}
          onChange={(e) => {
            const template = templates.find((item) => `${item.name}:${item.language}` === e.target.value);
            setForm({ ...form, templateKey: e.target.value,
              variableMappings: Array.from({ length: template?.bodyParameterCount ?? 0 }, () => "") });
          }}>
          <option value="">Select approved template</option>{templates.map((t) => <option key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>{t.name} · {t.language}</option>)}
        </select></Field>
        {selectedTemplate?.bodyParameterCount ? (
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            {form.variableMappings.map((mapping, index) => (
              <Field key={index} label={`Template variable {{${selectedTemplate.bodyParameterNames?.[index] ?? index + 1}}}`}>
                <select className={input} required value={mapping}
                  onChange={(event) => setForm({ ...form,
                    variableMappings: form.variableMappings.map((value, mappingIndex) =>
                      mappingIndex === index ? event.target.value : value) })}>
                  <option value="">Select contact field</option>
                  <option value="name">Contact name</option>
                  <option value="phone_number">Phone number</option>
                </select>
              </Field>
            ))}
          </div>
        ) : null}
        <Field label="Batch size"><input className={input} type="number" min="1" max="100" value={form.batchSize}
          onChange={(e) => setForm({ ...form, batchSize: e.target.value })} /></Field>
        <Field label="Daily contacts"><input className={input} type="number" min="1" max="10000"
          value={form.dailyMessageLimit}
          onChange={(e) => setForm({ ...form, dailyMessageLimit: e.target.value })} /></Field>
        <Field label={`Daily send time (${form.sendTimezone})`}><input className={input} type="time"
          required value={form.dailySendTime}
          onChange={(e) => setForm({ ...form, dailySendTime: e.target.value })} /></Field>
        <Field label="Delay between messages (seconds)"><input className={input} type="number" min="1" max="3600" value={form.delaySeconds}
          onChange={(e) => setForm({ ...form, delaySeconds: e.target.value })} /></Field>
        <Field label="Schedule (optional)"><input className={input} type="datetime-local" value={form.scheduledAt}
          onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
        <div className="flex items-end"><button className={primary}
          disabled={busy || !companyId || form.variableMappings.some((value) => !value)}>
          {busy ? "Creating…" : "Create campaign"}</button></div>
      </form>
      <Notice>
        Campaigns are processed automatically every minute. Test mode currently
        restricts delivery to the configured test allowlist.
      </Notice>
    </Panel>
    <Panel title="Campaign queue" eyebrow={`${campaigns.length} campaigns`}>
      <div className="space-y-3">{campaigns.length ? campaignPagination.pageItems.map((c) => <article key={c.id} className="rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{c.name}</h3>
          <p className="mt-1 text-xs text-slate-500">{c.template_name} · {c.daily_message_limit}/day at {formatCampaignTime(c.daily_send_time)} ({c.send_timezone}) · batch {c.batch_size} · {c.delay_seconds}s delay</p></div><Badge>{c.status}</Badge></div>
        {!['completed', 'cancelled'].includes(c.status) ?
          <CampaignSchedule campaign={c} onChanged={onChanged} showToast={showToast} /> : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(c.recipientSummary?.counts ?? {}).map(([status, count]) => (
            <span key={status} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-slate-600">
              {status} {count}
            </span>
          ))}
        </div>
        {c.recipientSummary?.failures?.length ? <div className="mt-3 space-y-1 rounded-lg bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-900">Latest delivery failures</p>
          {c.recipientSummary.failures.map((failure, index) => (
            <p key={`${failure.phoneSuffix}-${index}`} className="text-xs text-rose-800">
              {failure.contactName || `Contact …${failure.phoneSuffix}`}
              {failure.code ? ` (${failure.code})` : ""}: {failure.reason}
            </p>
          ))}
        </div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {(c.status === "draft" || c.status === "scheduled") ? <SmallButton onClick={() => act(c, "start")}>Start</SmallButton> : null}
          {c.status === "running" ? <SmallButton onClick={() => act(c, "pause")}>Pause</SmallButton> : null}
          {c.status === "paused" ? <SmallButton onClick={() => act(c, "resume")}>Resume</SmallButton> : null}
          {!["completed", "cancelled"].includes(c.status) ? <SmallButton onClick={() => act(c, "cancel")}>Cancel</SmallButton> : null}
        </div></article>) : <Empty>No campaigns yet. Import a list first.</Empty>}</div>
      <div className="mt-4"><TablePagination label="campaigns" pagination={campaignPagination}
        pageSizeOptions={[5]} /></div>
    </Panel>
    </div>
  </div>;
}

function CampaignSchedule({ campaign, onChanged, showToast }: {
  campaign: WhatsAppCampaign;
  onChanged: () => Promise<void>;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [dailyLimit, setDailyLimit] = useState(String(campaign.daily_message_limit));
  const [sendTime, setSendTime] = useState(campaign.daily_send_time.slice(0, 5));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDailyLimit(String(campaign.daily_message_limit));
    setSendTime(campaign.daily_send_time.slice(0, 5));
  }, [campaign.daily_message_limit, campaign.daily_send_time]);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      await updateCampaignDailyLimit(
        campaign.id, Number(dailyLimit), sendTime, campaign.send_timezone,
      );
      await onChanged(); showToast("Campaign daily schedule updated.", "success");
    } catch (error) { showToast(messageOf(error), "error"); } finally { setBusy(false); }
  }

  return <form className="mt-3 grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    onSubmit={save}>
    <Field label="Daily contacts"><input className={input} type="number" min="1" max="10000"
      value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} /></Field>
    <Field label={`Daily send time (${campaign.send_timezone})`}><input className={input} type="time"
      required value={sendTime} onChange={(event) => setSendTime(event.target.value)} /></Field>
    <button className={secondary} disabled={busy}>{busy ? "Saving…" : "Save schedule"}</button>
  </form>;
}

function TodayQueue({ campaigns, showToast }: {
  campaigns: WhatsAppCampaign[];
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [campaignId, setCampaignId] = useState("");
  const [queue, setQueue] = useState<WhatsAppDailyQueue | null>(null);
  const eligibleCampaigns = campaigns.filter((campaign) =>
    Boolean(campaign.started_at) && campaign.status !== "cancelled");

  useEffect(() => {
    if (!campaignId && eligibleCampaigns[0]) setCampaignId(eligibleCampaigns[0].id);
  }, [campaignId, eligibleCampaigns]);

  const load = useCallback(async () => {
    if (!campaignId) { setQueue(null); return; }
    try {
      const value = await fetchDailyQueue(campaignId);
      setQueue(value);
    } catch (error) { showToast(messageOf(error), "error"); }
  }, [campaignId, showToast]);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-5">
    <Panel title="Today’s outreach queue" eyebrow="Shared staff and admin view">
      <div>
        <Field label="Campaign"><select className={input} value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}>
          <option value="">Select campaign</option>
          {eligibleCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>
            {campaign.name} ({campaign.status})
          </option>)}
        </select></Field>
      </div>
      {queue ? <>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Metric label="Daily limit" value={queue.dailyMessageLimit} />
          <Metric label="Sent today" value={queue.sentToday} />
          <Metric label="Available today" value={queue.remainingToday} />
        </div>
        <div className="mt-4 space-y-2">
          {queue.rows.map((row) => <article key={row.id}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-stone-200 p-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.name || "Unnamed contact"}</p>
              <p className="font-mono text-sm text-slate-700">{row.phoneNumber}</p>
              <p className="text-xs text-slate-500">{row.sentAt ? formatDateTime(row.sentAt) : "Queued for today"}</p></div>
            <Badge>{row.status}</Badge>
          </article>)}
          {!queue.rows.length ? <Empty>No contacts are allocated for today.</Empty> : null}
        </div>
      </> : <Empty>Select a campaign to see today’s contacts.</Empty>}
    </Panel>
  </div>;
}

function ContactLists({ phoneNumbers, lists, onChanged, showToast }: {
  phoneNumbers: WhatsAppPhoneNumber[]; lists: WhatsAppContactList[]; onChanged: () => Promise<void>;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [name, setName] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [preview, setPreview] = useState<Array<{ phoneNumber: string; name: string; customFields: Record<string, string> }>>([]);
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const listPagination = useTablePagination(lists, 10);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null; setFile(selected);
    if (!selected) return setPreview([]);
    try { setPreview(parseCsv(await selected.text())); if (!name) setName(selected.name.replace(/\.csv$/i, "")); }
    catch (e) { setPreview([]); showToast(messageOf(e), "error"); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault(); if (!file || !consent) return;
    setBusy(true);
    try { const result = await importContactList({ phoneNumberId, name, filename: file.name, contacts: preview });
      showToast(`${result.imported} contacts imported.`, "success"); setFile(null); setPreview([]); setName(""); setConsent(false); await onChanged();
    } catch (e) { showToast(messageOf(e), "error"); } finally { setBusy(false); }
  }
  return <div className="grid gap-5 lg:grid-cols-2">
    <Panel title="Upload CSV" eyebrow="Opted-in contacts"><form className="space-y-4" onSubmit={upload}>
      <Field label="List name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="WhatsApp sender"><select className={input} value={phoneNumberId}
        onChange={(e) => setPhoneNumberId(e.target.value)} required>
        <option value="">Select sender</option>
        {phoneNumbers.map((item) => <option key={item.id} value={item.id}>{item.verifiedName || item.displayPhoneNumber}</option>)}
      </select></Field>
      <Field label="CSV file"><input className={input} type="file" accept=".csv,text/csv" onChange={choose} required /></Field>
      <p className="text-xs text-slate-500">Required column: phone_number. Optional: name. Other columns become template fields.</p>
      <label className="flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I confirm every contact has consented to receive WhatsApp messages.</label>
      {preview.length ? <Notice>{preview.length} valid unique contacts ready. Preview: {preview.slice(0, 3).map((r) => r.phoneNumber).join(", ")}</Notice> : null}
      <button className={primary} disabled={!preview.length || !consent || busy || !phoneNumberId}>{busy ? "Importing…" : "Import contact list"}</button>
    </form></Panel>
    <Panel title="Saved lists" eyebrow={`${lists.length} lists`}><div className="space-y-3">{lists.length ? listPagination.pageItems.map((list) =>
      <article key={list.id} className="flex items-center justify-between rounded-xl border border-stone-200 p-4">
        <div><h3 className="font-semibold">{list.name}</h3><p className="mt-1 text-xs text-slate-500">{list.source_filename || "CSV import"}</p></div>
        <Badge>{list.contact_count} contacts</Badge></article>) : <Empty>No contact lists imported.</Empty>}</div>
      <div className="mt-4"><TablePagination label="lists" pagination={listPagination}
        pageSizeOptions={[10]} /></div></Panel>
  </div>;
}

function Inbox({ conversations }: { conversations: WhatsAppConversation[] }) {
  const [selected, setSelected] = useState(""); const [thread, setThread] = useState<WhatsAppThreadMessage[]>([]);
  const [reply, setReply] = useState(""); const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const conversationPagination = useTablePagination(conversations, 10);
  async function loadThread(conversationId: string) {
    setThread(await fetchConversationMessages(conversationId));
  }
  useEffect(() => {
    setReply(""); setReplyError("");
    if (!selected) { setThread([]); return; }
    void loadThread(selected).catch((error) => setReplyError(messageOf(error)));
  }, [selected]);
  const active = conversations.find((item) => item.id === selected);
  const latestInbound = [...thread].reverse().find((message) => message.direction === "inbound");
  const serviceWindowUntil = latestInbound
    ? new Date(latestInbound.source_timestamp).getTime() + 24 * 60 * 60 * 1_000
    : 0;
  const serviceWindowOpen = serviceWindowUntil > Date.now();
  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !serviceWindowOpen || !reply.trim()) return;
    setSending(true); setReplyError("");
    try {
      await sendFreeFormReply({ conversationId: selected, text: reply.trim() });
      setReply(""); await loadThread(selected);
    } catch (error) { setReplyError(messageOf(error)); }
    finally { setSending(false); }
  }
  return <div className="grid min-h-[520px] gap-5 lg:grid-cols-[320px_1fr]">
    <Panel title="Conversations" eyebrow={`${conversations.length} threads`}><div className="space-y-2">{conversationPagination.pageItems.map((c) =>
      <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full rounded-lg border p-3 text-left ${selected === c.id ? "border-orange-300 bg-orange-50" : "border-stone-200"}`}>
        <p className="font-semibold">{c.contact_name || c.contact_wa_id}</p><p className="mt-1 text-xs text-slate-500">{new Date(c.last_message_at).toLocaleString()}</p>
      </button>)}</div><div className="mt-4"><TablePagination label="threads"
        pagination={conversationPagination} pageSizeOptions={[10]} /></div></Panel>
    <Panel title={active?.contact_name || active?.contact_wa_id || "Select a conversation"} eyebrow="Webhook replies">
      {!active ? <Empty>Select a contact to view their complete message thread.</Empty> :
        <><div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">{thread.map((m) => <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${m.direction === "outbound" ? "bg-[#06173f] text-white" : "bg-stone-100 text-slate-800"}`}>
            <p>{m.text_body || `[${m.message_type}]`}</p><p className="mt-1 text-[10px] opacity-70">{m.status} · {new Date(m.source_timestamp).toLocaleString()}</p>
          </div></div>)}</div>
        <form className="mt-4 space-y-3 border-t border-stone-200 pt-4" onSubmit={submitReply}>
          <textarea className={`${input} min-h-24 resize-y py-3`} maxLength={4096}
            placeholder={serviceWindowOpen ? "Type a WhatsApp reply…" : "The 24-hour service window is closed"}
            value={reply} onChange={(event) => setReply(event.target.value)}
            disabled={!serviceWindowOpen || sending} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">{serviceWindowOpen
              ? `Free-form replies available until ${new Date(serviceWindowUntil).toLocaleString()}`
              : "Send an approved template to restart the conversation."}</p>
            <button className={primary} disabled={!serviceWindowOpen || !reply.trim() || sending}>
              {sending ? "Sending…" : "Send reply"}</button>
          </div>
          {replyError ? <Notice tone="error">{replyError}</Notice> : null}
        </form></>}
      <Notice>Incoming replies appear automatically. Free-form replies are available for 24 hours after the contact&apos;s latest message.</Notice>
    </Panel>
  </div>;
}

function Activity({ messages, onRefresh }: { messages: WhatsAppMessage[]; onRefresh: () => Promise<void> }) {
  const totals = useMemo(() => Object.fromEntries(["sent", "delivered", "read", "failed"].map((s) => [s, messages.filter((m) => m.status === s).length])), [messages]);
  const activityPagination = useTablePagination(messages, 25);
  return <Panel title="Delivery activity" eyebrow="Latest 50 messages"><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
    {Object.entries(totals).map(([label, value]) => <div key={label} className="rounded-lg bg-stone-50 p-3"><p className="text-xs capitalize text-slate-500">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}
  </div><button className={secondary} onClick={() => void onRefresh()}>Refresh</button>
  <div className="mt-4 space-y-2">{activityPagination.pageItems.map((m) => <article key={m.id} className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
    <div className="min-w-0"><p className="truncate text-sm font-semibold">{m.text_body || m.message_type}</p><p className="text-xs text-slate-500">{m.direction}</p></div><Badge>{m.status}</Badge>
  </article>)}</div><div className="mt-4"><TablePagination label="messages"
    pagination={activityPagination} pageSizeOptions={[25]} /></div></Panel>;
}

function Settings({ companyId, showToast }: { companyId: string; showToast: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [batch, setBatch] = useState("20"); const [delay, setDelay] = useState("5"); const [keywords, setKeywords] = useState("stop, unsubscribe");
  const [dailyCampaigns, setDailyCampaigns] = useState("10"); const [dailyMessages, setDailyMessages] = useState("100");
  useEffect(() => { void fetchOutreachSettings().then((value) => { if (!value) return; setBatch(String(value.default_batch_size)); setDelay(String(value.default_delay_seconds)); setDailyCampaigns(String(value.daily_campaign_limit)); setDailyMessages(String(value.daily_message_limit)); setKeywords(value.opt_out_keywords.join(", ")); }); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); try { await saveOutreachSettings({ companyId, defaultBatchSize: Number(batch), defaultDelaySeconds: Number(delay), dailyCampaignLimit: Number(dailyCampaigns), dailyMessageLimit: Number(dailyMessages), optOutKeywords: keywords.split(",").map((v) => v.trim()).filter(Boolean) }); showToast("Settings saved.", "success"); } catch (error) { showToast(messageOf(error), "error"); } }
  return <Panel title="Sending defaults" eyebrow="Safety controls"><form className="grid max-w-2xl gap-4 sm:grid-cols-2" onSubmit={submit}>
    <Field label="Default batch size"><input className={input} type="number" min="1" max="100" value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
    <Field label="Default delay (seconds)"><input className={input} type="number" min="1" max="3600" value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
    <Field label="Daily campaign limit"><input className={input} type="number" min="1" max="100" value={dailyCampaigns} onChange={(e) => setDailyCampaigns(e.target.value)} /></Field>
    <Field label="Daily message limit"><input className={input} type="number" min="1" max="10000" value={dailyMessages} onChange={(e) => setDailyMessages(e.target.value)} /></Field>
    <div className="sm:col-span-2"><Field label="Opt-out keywords"><input className={input} value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field></div>
    <button className={primary} disabled={!companyId}>Save settings</button>
  </form></Panel>;
}

function parseCsv(csv: string) {
  const rows = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one contact.");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const phoneIndex = headers.findIndex((h) => ["phone_number", "phone", "whatsapp_number"].includes(h));
  if (phoneIndex < 0) throw new Error("CSV needs a phone_number column.");
  const nameIndex = headers.indexOf("name"); const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    const phoneNumber = (row[phoneIndex] ?? "").replace(/\D/g, "");
    if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error(`Invalid phone number on row ${index + 2}.`);
    if (seen.has(phoneNumber)) throw new Error(`Duplicate phone number on row ${index + 2}.`);
    seen.add(phoneNumber); const customFields: Record<string, string> = {};
    headers.forEach((header, column) => { if (column !== phoneIndex && column !== nameIndex && header) customFields[header] = row[column] ?? ""; });
    return { phoneNumber, name: nameIndex >= 0 ? row[nameIndex] ?? "" : "", customFields };
  });
}
function parseCsvLine(line: string) {
  const values: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i += 1) { const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  } values.push(value.trim()); return values;
}
function Panel({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6"><p className="text-xs font-semibold uppercase tracking-[.15em] text-orange-600">{eyebrow}</p><h2 className="mb-5 mt-1 text-xl font-semibold text-slate-950">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>{children}</label>; }
function Badge({ children }: { children: React.ReactNode }) { return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">{children}</span>; }
function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "error" }) { return <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}>{children}</div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-stone-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold text-slate-950">{value}</p></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-lg border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-slate-500">{children}</p>; }
function SmallButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className={secondary}>{children}</button>; }
function AccessDenied() { return <section className="rounded-xl border border-rose-200 bg-rose-50 p-6"><h1 className="text-xl font-semibold text-rose-950">Access denied</h1><p className="mt-2 text-sm text-rose-800">WhatsApp Outreach is restricted to super admins.</p></section>; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "The request could not be completed."; }
function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}
function formatCampaignTime(value: string) { return value.slice(0, 5); }
const input = "min-h-11 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";
const primary = "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#06173f] px-5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-stone-50";
