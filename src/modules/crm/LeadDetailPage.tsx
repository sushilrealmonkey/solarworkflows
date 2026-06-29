import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  deleteLead,
  fetchLead,
  fetchLeadActionState,
  fetchStaffOptions,
  updateLead,
} from "./crmApi";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatEnquiryCode,
  hasPermission,
  labelize,
  leadToForm,
  requiredError,
  staffName,
} from "./crmUtils";
import type { Lead, LeadActionState, LeadFormValues, StaffOption } from "./types";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  NextStepLabel,
  PencilIcon,
  PlaceholderAction,
  StatusBadge,
} from "./CrmComponents";
import { LeadFormModal } from "./LeadsPage";
import { LeadFollowupsPanel } from "./LeadFollowupsPanel";

export function LeadDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadActionState, setLeadActionState] = useState<LeadActionState>({
    hasSiteSurvey: false,
    hasQuotation: false,
  });
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeadFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission(profile, permissions, "leads", "view");
  const canCreate = hasPermission(profile, permissions, "leads", "create");
  const canUpdate = hasPermission(profile, permissions, "leads", "update");
  const canDelete = hasPermission(profile, permissions, "leads", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canViewSurvey = hasPermission(
    profile,
    permissions,
    "site_surveys",
    "view",
  );
  const canCreateSurvey =
    canViewSurvey && hasPermission(
      profile,
      permissions,
      "site_surveys",
      "create",
    );
  const canViewQuotation = hasPermission(profile, permissions, "quotations", "view");
  const canCreateQuotation =
    canViewQuotation && hasPermission(profile, permissions, "quotations", "create");
  const primaryActionClass =
    "inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700";

  async function loadLead() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextLead, nextStaff, nextActionState] = await Promise.all([
        fetchLead(profile, id),
        fetchStaffOptions(profile),
        fetchLeadActionState(profile, id, {
          includeSiteSurvey: canViewSurvey,
          includeQuotation: canViewQuotation,
          includeQuotationBySurvey: canViewSurvey && canViewQuotation,
        }),
      ]);
      setLead(nextLead);
      setStaff(nextStaff);
      setLeadActionState(nextActionState);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load lead.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLead();
    // loadLead closes over the current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Enquiry profile is not available"
        description="Your role needs leads:view access to open enquiry details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!lead || !editing) {
      return;
    }

    const nextErrors = {
      full_name: requiredError(editing.full_name, "Full name"),
      phone: requiredError(editing.phone, "Phone"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      const updatedLead = await updateLead(lead.id, editing);
      setLead(updatedLead);
      setEditing(null);
      showToast("Enquiry updated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Enquiry update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!lead) {
      return;
    }

    try {
      setDeleting(true);
      await deleteLead(lead.id);
      showToast("Enquiry deleted.", "success");
      navigate("/leads");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Enquiry delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  function openEditForm() {
    if (!lead) {
      return;
    }

    setFormErrors({});
    setEditing(leadToForm(lead));
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/leads">
        Back to enquiries
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load enquiry" description={error} /> : null}
      {!loading && !error && !lead ? (
        <EmptyState title="Enquiry not found" description="This enquiry may have been deleted or is outside your organization access." />
      ) : null}

      {lead ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <RecordTitle
              recordType="Enquiry"
              name={lead.full_name}
              meta={[
                formatEnquiryCode(lead.lead_code),
                lead.lead_source,
                labelize(lead.status),
                lead.phone,
              ]}
              action={
                canUpdate ? (
                  <button
                    aria-label="Edit lead"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                    onClick={openEditForm}
                    title="Edit lead"
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                ) : null
              }
            />
            <div className="space-y-3">
              <NextStepLabel />
              <div className="flex flex-wrap gap-2">
                {leadActionState.hasSiteSurvey &&
                leadActionState.hasQuotation &&
                canViewProjects ? (
                  <Link
                    className={primaryActionClass}
                    to={
                      leadActionState.projectId
                        ? `/projects/${leadActionState.projectId}`
                        : "/projects"
                    }
                  >
                    Go to Project
                  </Link>
                ) : null}
                {!leadActionState.hasSiteSurvey && canCreateSurvey ? (
                  <Link
                    className={primaryActionClass}
                    to={`/site-surveys?new=1&leadId=${lead.id}`}
                  >
                    Create Site Survey
                  </Link>
                ) : !leadActionState.hasSiteSurvey ? (
                  <PlaceholderAction>Create Site Survey</PlaceholderAction>
                ) : null}
                {!leadActionState.hasQuotation && canCreateQuotation ? (
                  <Link
                    className={primaryActionClass}
                    to={`/quotations?new=1&leadId=${lead.id}`}
                  >
                    Create Quotation
                  </Link>
                ) : !leadActionState.hasQuotation ? (
                  <PlaceholderAction>Create Quotation</PlaceholderAction>
                ) : null}
                {leadActionState.hasSiteSurvey &&
                leadActionState.hasQuotation &&
                !canViewProjects ? (
                  <PlaceholderAction>Go to Project</PlaceholderAction>
                ) : null}
              </div>
            </div>
          </div>

          <DetailSection title="Enquiry Basic Details">
            <DetailItem label="Enq Code" value={formatEnquiryCode(lead.lead_code)} />
            <DetailItem label="Status" value={<StatusBadge value={lead.status} />} />
            <DetailItem label="Priority" value={<StatusBadge value={lead.priority} />} />
            <DetailItem label="Enquiry Source" value={lead.lead_source ?? "-"} />
            <DetailItem label="Offered Price" value={formatCurrency(lead.offered_price)} />
            <DetailItem
              label="Offered Price Updated"
              value={formatDateTime(lead.offered_price_updated_at)}
            />
            <DetailItem label="Assigned Staff" value={staffName(staff, lead.assigned_to)} />
            <DetailItem label="Created" value={formatDate(lead.created_at)} />
          </DetailSection>

          <DetailSection title="Contact Details">
            <DetailItem label="Full Name" value={lead.full_name} />
            <DetailItem label="Phone" value={lead.phone} />
            <DetailItem label="Alternate Phone" value={lead.alternate_phone ?? "-"} />
            <DetailItem label="Email" value={lead.email ?? "-"} />
          </DetailSection>

          <DetailSection title="Requirement Details">
            <DetailItem label="Requirement Type" value={labelize(lead.requirement_type)} />
            <DetailItem
              label="Estimated Load"
              value={lead.estimated_load_kw ? `${lead.estimated_load_kw} kW` : "-"}
            />
            <DetailItem
              label="Electricity Bill Amount"
              value={
                lead.electricity_bill_amount
                  ? `Rs. ${lead.electricity_bill_amount}`
                  : "-"
              }
            />
            <DetailItem label="Property Type" value={lead.property_type ?? "-"} />
            <DetailItem label="Roof Type" value={lead.roof_type ?? "-"} />
          </DetailSection>

          <DetailSection title="Address">
            <DetailItem label="Address" value={lead.address ?? "-"} />
            <DetailItem label="City" value={lead.city ?? "-"} />
            <DetailItem label="District" value={lead.district ?? "-"} />
            <DetailItem label="State" value={lead.state ?? "-"} />
            <DetailItem label="Pincode" value={lead.pincode ?? "-"} />
          </DetailSection>

          <LeadFollowupsPanel
            leadId={lead.id}
            defaultAssignedTo={lead.assigned_to}
            staff={staff}
            canCreate={canCreate}
            canUpdate={canUpdate}
          />

          <DetailSection title="Notes">
            <DetailItem label="Notes" value={lead.notes ?? "-"} />
          </DetailSection>

          {canDelete ? (
            <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-rose-900">
                    Danger Zone
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Delete this enquiry from the organization pipeline.
                  </p>
                </div>
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Enquiry
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <LeadFormModal
          title="Edit Enquiry"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          staff={staff}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete enquiry?"
          description="This enquiry record will be removed from the organization pipeline."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}
