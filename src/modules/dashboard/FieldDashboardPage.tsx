import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { fetchFieldProjects } from "../projects/projectApi";
import { fetchFieldSurveys } from "../site-surveys/siteSurveyApi";

export function FieldDashboardPage() {
  const [counts, setCounts] = useState<{ surveys: number; projects: number; active: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([fetchFieldSurveys(), fetchFieldProjects()]).then(([surveys, projects]) => setCounts({ surveys: surveys.length, projects: projects.length, active: surveys.filter((row) => row.survey_status === "in_progress").length + projects.filter((row) => row.project_status === "installation_in_progress").length })).catch((value) => setError(value instanceof Error ? value.message : "Unable to load assigned work.")); }, []);
  return <div className="space-y-6"><PageHeader title="Dashboard" description="Your assigned field work only." />{!counts && !error ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load dashboard" description={error} /> : null}{counts ? <><div className="grid gap-3 sm:grid-cols-3"><Card label="Assigned surveys" value={counts.surveys}/><Card label="Released projects" value={counts.projects}/><Card label="In progress" value={counts.active}/></div><div className="grid gap-3 sm:grid-cols-2"><Link className="rounded-xl border border-stone-200 bg-white p-5 font-semibold text-[#06173f] shadow-sm" to="/site-surveys">Open Site Surveys</Link><Link className="rounded-xl border border-stone-200 bg-white p-5 font-semibold text-[#06173f] shadow-sm" to="/projects">Open Projects</Link></div></> : null}</div>;
}
function Card({ label, value }: { label: string; value: number }) { return <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p></section>; }
