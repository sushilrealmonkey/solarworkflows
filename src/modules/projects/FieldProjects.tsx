import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import { Badge, Button, EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import { fetchFieldProject, fetchFieldProjects, updateFieldProjectStatus } from "./projectApi";
import type { FieldProject } from "./types";

export function FieldProjectsPage() {
  const [projects, setProjects] = useState<FieldProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFieldProjects()
      .then(setProjects)
      .catch((value) => setError(value instanceof Error ? value.message : "Unable to load assigned projects."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="Installation work assigned and released to you." />
      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load projects" description={error} /> : null}
      {!loading && !error && projects.length === 0 ? (
        <EmptyState title="No released projects" description="Projects appear after Backend schedules installation and assigns you." />
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{project.project_code ?? "Project"}</p>
                <h2 className="mt-1 truncate font-semibold text-slate-950">{project.project_name ?? project.customer_name ?? "Installation"}</h2>
              </div>
              <Badge tone="blue">{labelize(project.project_status)}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Field label="Customer" value={project.customer_name ?? "-"} />
              <Field label="Scheduled" value={formatDate(project.start_date)} />
              <Field label="Capacity" value={project.system_capacity_kw ? `${project.system_capacity_kw} kW` : "-"} />
              <Field label="Team" value={project.assigned_team.map((member) => member.name).filter(Boolean).join(", ") || "-"} />
            </dl>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function FieldProjectDetailPage() {
  const { id } = useParams();
  const { showToast } = useToast();
  const [project, setProject] = useState<FieldProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      setProject(await fetchFieldProject(id));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load project.");
    } finally {
      setLoading(false);
    }
  }

  // Reload when the route identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id]);

  const nextStatus = project?.project_status === "installation_scheduled"
    ? "installation_in_progress"
    : project?.project_status === "installation_in_progress"
      ? "installation_completed"
      : null;

  async function updateStatus() {
    if (!project || !nextStatus) return;
    try {
      setSaving(true);
      await updateFieldProjectStatus(project.id, nextStatus);
      showToast("Installation status updated.", "success");
      await load();
    } catch (value) {
      showToast(value instanceof Error ? value.message : "Status update failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/projects">Back to projects</Link>
      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load project" description={error} /> : null}
      {!loading && !error && !project ? <EmptyState title="Project not found" description="This project is not assigned and released to you." /> : null}
      {project ? (
        <>
          <header className="border-b border-stone-200 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{project.project_code ?? "Project"}</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{project.project_name ?? project.customer_name ?? "Installation"}</h1>
            <div className="mt-3"><Badge tone="blue">{labelize(project.project_status)}</Badge></div>
          </header>
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Installation details</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Customer" value={project.customer_name ?? "-"} />
              <Field label="Phone" value={project.customer_phone ?? "-"} href={project.customer_phone ? `tel:${project.customer_phone}` : undefined} />
              <Field label="Address" value={project.installation_address ?? "-"} />
              <Field label="Capacity" value={project.system_capacity_kw ? `${project.system_capacity_kw} kW` : "-"} />
              <Field label="Schedule" value={formatDate(project.start_date)} />
              <Field label="Expected completion" value={formatDate(project.expected_completion_date)} />
              <Field label="Assigned team" value={project.assigned_team.map((member) => member.name).filter(Boolean).join(", ") || "-"} />
              <Field label="Installation notes" value={project.field_notes ?? "-"} />
            </dl>
          </section>
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Next Step</h2>
            <div className="mt-4">
              {nextStatus ? <Button disabled={saving} onClick={updateStatus}>{saving ? "Updating..." : "Update Status"}</Button> : (
                <p className="text-sm text-slate-600">No status update is available. Completed work is read-only.</p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-900">{href ? <a className="font-semibold text-[#06173f]" href={href}>{value}</a> : value}</dd></div>;
}
