import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { Badge, EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import { fetchScopedSurveySummaries } from "./siteSurveyApi";
import type { ScopedSurveySummary } from "./types";

export function RestrictedSurveysPage() {
  const [records, setRecords] = useState<ScopedSurveySummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchScopedSurveySummaries().then(setRecords).catch((value) => setError(value instanceof Error ? value.message : "Unable to load surveys.")).finally(() => setLoading(false)); }, []);
  return <div className="space-y-6"><PageHeader title="Site Surveys" description="Schedule, status, and completion summaries for your related records." />{loading ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load surveys" description={error} /> : null}{!loading && !error && records.length === 0 ? <EmptyState title="No related surveys" description="Related survey summaries will appear here." /> : null}<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <Link key={record.id} to={`/site-surveys/${record.id}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{record.survey_code}</p><h2 className="mt-1 font-semibold text-slate-950">{record.contact_name ?? "Site survey"}</h2></div><Badge tone="blue">{labelize(record.survey_status)}</Badge></div><p className="mt-3 text-sm text-slate-600">{formatDate(record.scheduled_date)} {record.scheduled_time ?? ""}</p></Link>)}</div></div>;
}

export function RestrictedSurveyDetailPage() {
  const { id } = useParams(); const [record, setRecord] = useState<ScopedSurveySummary | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!id) return; fetchScopedSurveySummaries(id).then((rows) => setRecord(rows[0] ?? null)).catch((value) => setError(value instanceof Error ? value.message : "Unable to load survey.")).finally(() => setLoading(false)); }, [id]);
  return <div className="space-y-6"><Link className="text-sm font-semibold text-[#06173f]" to="/site-surveys">Back to site surveys</Link>{loading ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load survey" description={error} /> : null}{!loading && !error && !record ? <EmptyState title="Survey not found" description="This survey is outside your related record scope." /> : null}{record ? <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{record.survey_code}</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">{record.contact_name ?? "Site survey"}</h1></div><Badge tone="blue">{labelize(record.survey_status)}</Badge></div><dl className="mt-6 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(record.scheduled_date)} {record.scheduled_time ?? ""}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(record.completed_at)}</dd></div></dl></section> : null}</div>;
}
