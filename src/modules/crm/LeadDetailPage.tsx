import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  convertLeadToCustomer,
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
  const [converting, setConverting] = useState(false);
  const [conversionLink, setConversionLink] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "leads", "view");
  const canCreate = hasPermission(profile, permissions, "leads", "create");
  const canUpdate = hasPermission(profile, permissions, "leads", "update");
  const canDelete = hasPermission(profile, permissions, "leads", "delete");
  const canCreateCustomer = hasPermission(profile, permissions, "customers", "create");
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
  const canConvert = canUpdate && canCreateCustomer;
  const primaryActionClass =
    "inline-flex min-h-10 items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-900";
  const disabledActionClass =
    "inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-semibold text-slate-500 opacity-75 shadow-sm";
  const convertActionClass =
    "inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-100 disabled:text-emerald-700 disabled:opacity-75";

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
      if (nextLead?.converted_customer_id) {
        setConversionLink(`/customers/${nextLead.converted_customer_id}`);
      } else {
        setConversionLink(null);
      }
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
        title="Lead profile is not available"
        description="Your role needs leads:view access to open lead details."
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
      showToast("Lead updated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead update failed.",
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
      showToast("Lead deleted.", "success");
      navigate("/leads");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleConvert() {
    if (!lead) {
      return;
    }

    if (lead.converted_customer_id) {
      setConversionLink(`/customers/${lead.converted_customer_id}`);
      showToast("Lead is already converted.", "info");
      return;
    }

    if (lead.status === "converted") {
      showToast("Lead is marked converted but has no customer link.", "error");
      return;
    }

    try {
      setConverting(true);
      const customer = await convertLeadToCustomer(lead.id);
      setConversionLink(`/customers/${customer.id}`);
      showToast("Lead converted to customer.", "success");
      navigate(`/customers/${customer.id}`);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead conversion failed.",
        "error",
      );
    } finally {
      setConverting(false);
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
      <Link className="text-sm font-semibold text-brand-700" to="/leads">
        Back to leads
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load lead" description={error} /> : null}
      {!loading && !error && !lead ? (
        <EmptyState title="Lead not found" description="This lead may have been deleted or is outside your organization access." />
      ) : null}

      {lead ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <header className="space-y-2">
              <p className="text-sm font-medium text-brand-600">SolarFlow CRM</p>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
                  {lead.full_name}
                </h1>
                {canUpdate ? (
                  <button
                    aria-label="Edit lead"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                    onClick={openEditForm}
                    title="Edit lead"
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 20h9" />
                      <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5z" />
                    </svg>
                  </button>
                ) : null}
              </div>
              <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                {lead.lead_code ?? "Lead"} / {lead.phone}
              </p>
            </header>
            <div className="flex flex-wrap gap-2">
              {canCreateSurvey ? (
                leadActionState.hasSiteSurvey ? (
                  <button className={disabledActionClass} disabled type="button">
                    Schedule Site Survey
                  </button>
                ) : (
                  <Link
                    className={primaryActionClass}
                    to={`/site-surveys?new=1&leadId=${lead.id}`}
                  >
                    Schedule Site Survey
                  </Link>
                )
              ) : (
                <PlaceholderAction>Schedule Site Survey</PlaceholderAction>
              )}
              {canCreateQuotation ? (
                leadActionState.hasQuotation ? (
                  <button className={disabledActionClass} disabled type="button">
                    Create Quotation
                  </button>
                ) : (
                  <Link
                    className={primaryActionClass}
                    to={`/quotations?new=1&leadId=${lead.id}`}
                  >
                    Create Quotation
                  </Link>
                )
              ) : (
                <PlaceholderAction>Create Quotation</PlaceholderAction>
              )}
              {canConvert ? (
                <button
                  className={convertActionClass}
                  disabled={converting || Boolean(lead.converted_customer_id)}
                  onClick={handleConvert}
                  type="button"
                >
                  {converting ? "Converting..." : "Convert to Customer"}
                </button>
              ) : null}
            </div>
          </div>

          {conversionLink ? (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">This lead has a customer profile.</span>
              <Link
                className="inline-flex rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
                to={conversionLink}
              >
                Open Customer
              </Link>
            </div>
          ) : null}

          <DetailSection title="Lead Basic Details">
            <DetailItem label="Lead Code" value={lead.lead_code ?? "-"} />
            <DetailItem label="Status" value={<StatusBadge value={lead.status} />} />
            <DetailItem label="Priority" value={<StatusBadge value={lead.priority} />} />
            <DetailItem label="Lead Source" value={lead.lead_source ?? "-"} />
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
                    Delete this lead from the organization pipeline.
                  </p>
                </div>
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Lead
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <LeadFormModal
          title="Edit Lead"
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
          title="Delete lead?"
          description="This lead record will be removed from the organization pipeline."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}
