import { useEffect, useState } from "react";
import { useToast } from "../../components/ui/ToastProvider";
import { Button, EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { fetchFieldStaffAssignmentOptions, saveProjectFieldAssignments, type FieldStaffAssignmentOption } from "./projectApi";

export function ProjectFieldAssignments({ projectId }: { projectId: string }) {
  const { showToast } = useToast();
  const [options, setOptions] = useState<FieldStaffAssignmentOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const rows = await fetchFieldStaffAssignmentOptions(projectId);
      setOptions(rows);
      setSelected(rows.filter((row) => row.is_assigned).map((row) => row.id));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to load Field Staff.", "error");
    } finally {
      setLoading(false);
    }
  }
  // Reload when the project identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [projectId]);

  async function save() {
    try {
      setSaving(true);
      await saveProjectFieldAssignments(projectId, selected);
      showToast("Field Staff assignments updated.", "success");
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Assignment update failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <h2 className="font-semibold text-slate-950">Field Staff assignment</h2>
    <p className="mt-1 text-sm text-slate-600">Assigned staff see this project only after it reaches Installation Scheduled.</p>
    {loading ? <div className="mt-4"><LoadingSkeleton /></div> : null}
    {!loading && options.length === 0 ? <div className="mt-4"><EmptyState title="No active Field Staff" description="Create or activate a staff user with the Field Staff role first." /></div> : null}
    {!loading && options.length > 0 ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{options.map((option) => <label key={option.id} className="flex items-center gap-3 rounded-lg border border-stone-200 p-3 text-sm"><input type="checkbox" checked={selected.includes(option.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))}/><span><span className="block font-semibold text-slate-900">{option.full_name ?? "Field Staff"}</span><span className="text-slate-500">{option.phone ?? "No phone"}</span></span></label>)}</div> : null}
    {!loading && options.length > 0 ? <div className="mt-4"><Button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save assignments"}</Button></div> : null}
  </section>;
}
