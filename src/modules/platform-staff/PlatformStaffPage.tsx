import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import { AccessDenied, Badge, Button, ConfirmDialog, EmptyState, LoadingSkeleton, TextInput } from "../crm/CrmComponents";
import { deletePlatformStaff, fetchPlatformStaff, invitePlatformStaff, updatePlatformStaffStatus } from "./platformStaffApi";
import type { PlatformStaff } from "./types";

export function PlatformStaffPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [staff, setStaff] = useState<PlatformStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PlatformStaff | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      setStaff(await fetchPlatformStaff());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load platform staff.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (profile?.is_super_admin) void load(); }, [profile?.is_super_admin]);

  if (!profile?.is_super_admin) {
    return <AccessDenied title="Platform staff is not available" description="Only super admins can manage platform staff." />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      await invitePlatformStaff({ fullName, email });
      setFullName("");
      setEmail("");
      showToast("Backend Staff invite sent.", "success");
      await load();
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : "Invite failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(member: PlatformStaff) {
    const status = member.status === "active" ? "inactive" : "active";
    try {
      await updatePlatformStaffStatus(member.id, status);
      showToast(`Staff ${status === "active" ? "activated" : "deactivated"}.`, "success");
      await load();
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : "Status update failed.", "error");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deletePlatformStaff(deleteTarget.id);
      showToast("Backend Staff account deleted.", "success");
      setDeleteTarget(null);
      await load();
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : "Staff deletion failed.", "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Platform Staff" description="Create role-based platform users. Backend Staff can access WhatsApp Outreach only." />
      <form className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_13rem_auto] lg:items-end" onSubmit={submit}>
        <TextInput label="Full name" value={fullName} onChange={setFullName} />
        <TextInput label="Email" type="email" value={email} onChange={setEmail} />
        <label className="block text-sm font-medium text-slate-700">Role
          <select className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm" disabled value="backend_staff">
            <option value="backend_staff">Backend Staff</option>
          </select>
        </label>
        <Button type="submit" disabled={saving}>{saving ? "Sending..." : "Create Staff"}</Button>
      </form>
      {loading ? <LoadingSkeleton /> : error ? <EmptyState title="Could not load staff" description={error} /> : (
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="divide-y divide-stone-100">
            {staff.length === 0 ? <div className="p-5 text-sm text-slate-500">No platform staff created yet.</div> : staff.map((member) => (
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" key={member.id}>
                <div><p className="font-medium text-slate-950">{member.full_name}</p><p className="text-sm text-slate-500">{member.email}</p></div>
                <div className="flex flex-wrap items-center gap-3"><Badge>{member.status ?? "invited"}</Badge><span className="text-sm text-slate-600">Backend Staff</span><Button onClick={() => void toggle(member)}>{member.status === "active" ? "Deactivate" : "Activate"}</Button><Button variant="danger" onClick={() => setDeleteTarget(member)}>Delete</Button></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete Backend Staff?"
          description={`This permanently removes ${deleteTarget.full_name ?? deleteTarget.email ?? "this staff member"}'s login and platform profile. This cannot be undone.`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
          confirming={deleting}
        />
      ) : null}
    </div>
  );
}
