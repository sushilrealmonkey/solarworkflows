import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { Badge, EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import { fetchScopedProjectSummaries } from "./projectApi";
import type { ScopedProjectSummary } from "./types";

export function RestrictedProjectsPage() {
  const [records, setRecords] = useState<ScopedProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchScopedProjectSummaries().then(setRecords).catch((value) => setError(value instanceof Error ? value.message : "Unable to load projects.")).finally(() => setLoading(false)); }, []);
  return <div className="space-y-6"><PageHeader title="Projects" description="Role-related project status summaries." />{loading ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load projects" description={error} /> : null}{!loading && !error && records.length === 0 ? <EmptyState title="No related projects" description="Projects related to records within your scope will appear here." /> : null}<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{records.map((record) => <Link key={record.id} to={`/projects/${record.id}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{record.project_code ?? "Project"}</p><h2 className="mt-1 font-semibold text-slate-950">{record.project_name ?? record.customer_name ?? "Project"}</h2></div><Badge tone="blue">{labelize(record.project_status)}</Badge></div><p className="mt-3 text-sm text-slate-600">Expected {formatDate(record.expected_completion_date)}</p></Link>)}</div></div>;
}

export function RestrictedProjectDetailPage() {
  const { id } = useParams();
  const [record, setRecord] = useState<ScopedProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!id) return; fetchScopedProjectSummaries(id).then((rows) => setRecord(rows[0] ?? null)).catch((value) => setError(value instanceof Error ? value.message : "Unable to load project.")).finally(() => setLoading(false)); }, [id]);
  return <div className="space-y-6"><Link className="text-sm font-semibold text-[#06173f]" to="/projects">Back to projects</Link>{loading ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load project" description={error} /> : null}{!loading && !error && !record ? <EmptyState title="Project not found" description="This project is outside your related record scope." /> : null}{record ? <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{record.project_code}</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">{record.project_name ?? record.customer_name ?? "Project"}</h1></div><Badge tone="blue">{labelize(record.project_status)}</Badge></div><dl className="mt-6 grid gap-4 sm:grid-cols-2"><Item label="Customer" value={record.customer_name ?? "-"}/><Item label="Expected date" value={formatDate(record.expected_completion_date)}/><Item label="Assigned manager" value={record.assigned_manager_name ?? "-"}/>{record.system_capacity_kw != null ? <Item label="Capacity" value={`${record.system_capacity_kw} kW`}/> : null}</dl></section> : null}</div>;
}
function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-900">{value}</dd></div>; }
