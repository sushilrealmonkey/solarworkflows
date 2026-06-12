import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  PlaceholderAction,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
  requiredError,
  staffName,
} from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import {
  deleteSiteSurvey,
  fetchSiteSurvey,
  fetchSurveyLeadOptions,
  updateSiteSurvey,
  updateSiteSurveyStatus,
  uploadSiteSurveyDocument,
  uploadSiteSurveyPhoto,
} from "./siteSurveyApi";
import {
  formatCustomerAddress,
  formatLeadAddress,
  formatSurveyTime,
  getSurveyContact,
  surveyToForm,
} from "./surveyUtils";
import {
  SiteSurveyFormModal,
  SurveyStatusBadge,
  SurveyStatusSelect,
} from "./SiteSurveysPage";
import type {
  SiteSurveyFormValues,
  SiteSurveyStatus,
  SiteSurveyWithRelations,
  SurveyLeadSummary,
} from "./types";

export function SiteSurveyDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<SiteSurveyWithRelations | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [leads, setLeads] = useState<SurveyLeadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SiteSurveyFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<SiteSurveyStatus | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  const canView = hasPermission(profile, permissions, "site_surveys", "view");
  const canUpdate = hasPermission(profile, permissions, "site_surveys", "update");
  const canDelete = hasPermission(profile, permissions, "site_surveys", "delete");
  const canCreateQuotation = hasPermission(
    profile,
    permissions,
    "quotations",
    "create",
  );

  async function loadSurvey() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextSurvey, nextStaff, nextLeads] =
        await Promise.all([
          fetchSiteSurvey(profile, id),
          fetchStaffOptions(profile),
          fetchSurveyLeadOptions(profile),
        ]);
      setSurvey(nextSurvey);
      setStaff(nextStaff);
      setLeads(nextLeads);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load site survey.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSurvey();
    // loadSurvey closes over the current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Site survey details are not available"
        description="Your role needs site_surveys:view access to open survey details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!survey || !editing) {
      return;
    }

    const nextErrors = {
      scheduled_date: requiredError(editing.scheduled_date, "Scheduled date"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateSiteSurvey(survey.id, editing);
      setEditing(null);
      showToast("Site survey updated.", "success");
      await loadSurvey();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Site survey update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!survey) {
      return;
    }

    try {
      setDeleting(true);
      await deleteSiteSurvey(survey.id);
      showToast("Site survey deleted.", "success");
      navigate("/site-surveys");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Site survey delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function confirmStatusUpdate() {
    if (!survey || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await updateSiteSurveyStatus(survey.id, statusTarget);
      showToast("Survey status updated.", "success");
      setStatusTarget(null);
      await loadSurvey();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Survey status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!survey || files.length === 0) {
      return;
    }

    try {
      setUploadingPhoto(true);
      let nextSurvey = survey;
      for (const file of files) {
        nextSurvey = await uploadSiteSurveyPhoto(profile, nextSurvey, file);
      }
      setSurvey(nextSurvey);
      showToast("Site photo uploaded.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Site photo upload failed.",
        "error",
      );
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleDocumentUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0) ?? null;
    event.target.value = "";

    if (!survey || !file) {
      return;
    }

    try {
      setUploadingDocument(true);
      const nextSurvey = await uploadSiteSurveyDocument(profile, survey, file);
      setSurvey(nextSurvey);
      showToast("Survey document uploaded.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Survey document upload failed.",
        "error",
      );
    } finally {
      setUploadingDocument(false);
    }
  }

  const contact = survey ? getSurveyContact(survey) : null;

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-brand-700" to="/site-surveys">
        Back to site surveys
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load site survey" description={error} />
      ) : null}
      {!loading && !error && !survey ? (
        <EmptyState
          title="Site survey not found"
          description="This survey may have been deleted or is outside your organization access."
        />
      ) : null}

      {survey && contact ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={survey.survey_code ?? "Site Survey"}
              description={`${contact.name} / ${contact.phone}`}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate ? (
                <>
                  <Button
                    onClick={() => {
                      setFormErrors({});
                      setEditing(surveyToForm(survey));
                    }}
                    variant="secondary"
                  >
                    Edit Survey
                  </Button>
                  <SurveyStatusSelect
                    disabled={updatingStatus}
                    value={survey.survey_status ?? "scheduled"}
                    onChange={setStatusTarget}
                  />
                </>
              ) : null}
              {canCreateQuotation ? (
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-brand-600 bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-900"
                  to={`/quotations?new=1&siteSurveyId=${survey.id}`}
                >
                  Create Quotation
                </Link>
              ) : (
                <PlaceholderAction>Create Quotation</PlaceholderAction>
              )}
            </div>
          </div>

          <DetailSection title="Lead and Customer Details">
            <DetailItem label="Source" value={contact.sourceLabel} />
            <DetailItem label="Name" value={contact.name} />
            <DetailItem label="Phone" value={contact.phone} />
            <DetailItem label="Lead" value={leadLink(survey)} />
            <DetailItem label="Customer" value={customerLink(survey)} />
            <DetailItem
              label="Contact Email"
              value={survey.customer?.email ?? survey.lead?.email ?? "-"}
            />
            <DetailItem
              label="Address"
              value={
                survey.customer
                  ? formatCustomerAddress(survey.customer) || "-"
                  : survey.lead
                    ? formatLeadAddress(survey.lead) || "-"
                    : "-"
              }
            />
          </DetailSection>

          <DetailSection title="Schedule Details">
            <DetailItem
              label="Status"
              value={<SurveyStatusBadge value={survey.survey_status} />}
            />
            <DetailItem
              label="Scheduled Date"
              value={formatDate(survey.scheduled_date)}
            />
            <DetailItem
              label="Scheduled Time"
              value={formatSurveyTime(survey.scheduled_time)}
            />
            <DetailItem
              label="Assigned Staff"
              value={staffName(staff, survey.assigned_to)}
            />
            <DetailItem
              label="Completed At"
              value={formatDateTime(survey.completed_at)}
            />
            <DetailItem label="Created" value={formatDate(survey.created_at)} />
          </DetailSection>

          <DetailSection title="Technical Survey Data">
            <DetailItem label="Roof Type" value={survey.roof_type ?? "-"} />
            <DetailItem
              label="Roof Area"
              value={
                survey.roof_area_sqft ? `${survey.roof_area_sqft} sqft` : "-"
              }
            />
            <DetailItem
              label="Shadow Free Area"
              value={
                survey.shadow_free_area_sqft
                  ? `${survey.shadow_free_area_sqft} sqft`
                  : "-"
              }
            />
            <DetailItem
              label="Structure Type"
              value={survey.structure_type ?? "-"}
            />
            <DetailItem
              label="Recommended Capacity"
              value={
                survey.recommended_capacity_kw
                  ? `${survey.recommended_capacity_kw} kW`
                  : "-"
              }
            />
            <DetailItem
              label="Existing Meter Type"
              value={survey.existing_meter_type ?? "-"}
            />
            <DetailItem
              label="Sanctioned Load"
              value={
                survey.sanctioned_load_kw
                  ? `${survey.sanctioned_load_kw} kW`
                  : "-"
              }
            />
            <DetailItem label="Phase Type" value={survey.phase_type ?? "-"} />
            <DetailItem
              label="Latitude"
              value={survey.latitude === null ? "-" : survey.latitude}
            />
            <DetailItem
              label="Longitude"
              value={survey.longitude === null ? "-" : survey.longitude}
            />
            <DetailItem label="Address Notes" value={survey.address_notes ?? "-"} />
            <DetailItem label="Remarks" value={survey.remarks ?? "-"} />
          </DetailSection>

          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-slate-950">
                Photos and Documents
              </h2>
              {canUpdate ? (
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50">
                    {uploadingPhoto ? "Uploading..." : "Upload Photos"}
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={uploadingPhoto}
                      onChange={handlePhotoUpload}
                    />
                  </label>
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50">
                    {uploadingDocument ? "Uploading..." : "Upload Document"}
                    <input
                      className="sr-only"
                      type="file"
                      disabled={uploadingDocument}
                      onChange={handleDocumentUpload}
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-slate-700">Site Photos</p>
                {survey.site_photos && survey.site_photos.length > 0 ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {survey.site_photos.map((photo) => (
                      <a
                        className="block overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
                        href={photo.url}
                        key={`${photo.url}-${photo.uploaded_at ?? photo.name}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <img
                          alt={photo.name}
                          className="h-36 w-full object-cover"
                          src={photo.url}
                        />
                        <div className="p-2">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {photo.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {fileSizeLabel(photo.size)}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No site photos uploaded.
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700">
                  Survey Document
                </p>
                {survey.electricity_bill_url ? (
                  <a
                    className="mt-2 inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                    href={survey.electricity_bill_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Uploaded Document
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No survey document uploaded.
                  </p>
                )}
              </div>
            </div>
          </section>

          <DetailSection title="Status Timeline">
            <DetailItem
              label="Current Status"
              value={<SurveyStatusBadge value={survey.survey_status} />}
            />
            <DetailItem
              label="Timeline"
              value="Placeholder for scheduled, rescheduled, in-progress, completed, and cancelled events."
            />
          </DetailSection>

          {canDelete ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-rose-950">
                    Danger Zone
                  </h2>
                  <p className="mt-1 text-sm text-rose-800">
                    Delete this site survey record from the workflow.
                  </p>
                </div>
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Survey
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <SiteSurveyFormModal
          title="Edit Site Survey"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          lookups={{ leads, staff }}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete site survey?"
          description="This survey record will be removed from the organization workflow."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}

      {statusTarget && survey ? (
        <ConfirmDialog
          title="Update survey status?"
          description={`Set ${survey.survey_code ?? "this survey"} to ${labelize(statusTarget)}.`}
          confirming={updatingStatus}
          confirmLabel="Update Status"
          confirmingLabel="Updating..."
          confirmVariant="primary"
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusUpdate}
        />
      ) : null}
    </div>
  );
}

function leadLink(survey: SiteSurveyWithRelations) {
  if (!survey.lead_id) {
    return "-";
  }

  return (
    <Link className="font-semibold text-brand-700" to={`/leads/${survey.lead_id}`}>
      {survey.lead?.lead_code ?? survey.lead?.full_name ?? "Open lead"}
    </Link>
  );
}

function customerLink(survey: SiteSurveyWithRelations) {
  if (!survey.customer_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-brand-700"
      to={`/customers/${survey.customer_id}`}
    >
      {survey.customer?.customer_code ?? survey.customer?.full_name ?? "Open customer"}
    </Link>
  );
}

function fileSizeLabel(size: number | null | undefined) {
  if (!size) {
    return "Uploaded file";
  }

  if (size < 1024 * 1024) {
    return `${Math.max(size / 1024, 1).toFixed(0)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
