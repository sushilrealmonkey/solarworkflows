import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  NextStepLabel,
  PencilIcon,
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
import type { StaffOption } from "../crm/types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import {
  fetchFieldStaffOptions,
  fetchSiteSurvey,
  fetchSurveyLeadOptions,
  updateSiteSurvey,
  updateSiteSurveyStatus,
  uploadSiteSurveyDocument,
  uploadSiteSurveyPhoto,
} from "./siteSurveyApi";
import { SiteSurveyMapLinkButton } from "./SiteSurveyMapLinkButton";
import {
  formatCustomerAddress,
  formatLeadAddress,
  formatSurveyTime,
  getSurveyContact,
  surveyToForm,
} from "./surveyUtils";
import {
  SiteSurveyQuotationApprovalPill,
  SiteSurveyFormModal,
  SurveyStatusSelect,
  surveyQuotationWorkflowState,
} from "./SiteSurveysPage";
import type {
  SiteSurveyFormValues,
  SiteSurveyStatus,
  SiteSurveyFile,
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
  const [statusTarget, setStatusTarget] = useState<SiteSurveyStatus | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  const canView = hasPermission(profile, permissions, "site_surveys", "view");
  const canUpdate = hasPermission(profile, permissions, "site_surveys", "update");
  const canDelete = hasPermission(profile, permissions, "site_surveys", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
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
          fetchFieldStaffOptions(),
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
      await updateSiteSurvey(survey.id, editing, "detail");
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
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!survey || files.length === 0) {
      return;
    }

    try {
      setUploadingDocument(true);
      let nextSurvey = survey;
      for (const file of files) {
        nextSurvey = await uploadSiteSurveyDocument(profile, nextSurvey, file);
      }
      setSurvey(nextSurvey);
      showToast(
        files.length === 1
          ? "Survey document uploaded."
          : `${files.length} survey documents uploaded.`,
        "success",
      );
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
  const workflowState = survey ? surveyQuotationWorkflowState(survey) : "none";
  const surveyDocuments = survey ? getSurveyDocuments(survey) : [];

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/site-surveys">
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
          <div>
            <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <RecordTitle
                  recordType="Site Survey"
                  name={contact.name}
                  meta={[
                    survey.survey_code ?? "Site Survey",
                    survey.customer?.customer_code ??
                      survey.lead?.lead_code ??
                      contact.sourceLabel,
                    contact.phone,
                  ]}
                  action={
                    canUpdate && !survey.archived_at ? (
                      <button
                        aria-label="Edit site survey"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                        onClick={() => {
                          setFormErrors({});
                          setEditing(surveyToForm(survey));
                        }}
                        title="Edit site survey"
                        type="button"
                      >
                        <PencilIcon />
                      </button>
                    ) : null
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  {canUpdate && !survey.archived_at ? (
                    <SurveyStatusSelect
                      disabled={updatingStatus}
                      showLabel
                      value={survey.survey_status ?? "scheduled"}
                      onChange={setStatusTarget}
                    />
                  ) : null}
                </div>
              </div>
              <div className="space-y-3 lg:max-w-md lg:shrink-0 lg:text-right">
                <div className="lg:flex lg:justify-end">
                  <NextStepLabel />
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <SiteSurveyMapLinkButton survey={survey} />
                  {workflowState !== "none" && workflowState !== "accepted" ? (
                    <SiteSurveyQuotationApprovalPill state={workflowState} />
                  ) : workflowState === "accepted" && canViewProjects ? (
                    <Link
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
                      to={survey.project_id ? `/projects/${survey.project_id}` : "/projects"}
                    >
                      Go to Project
                    </Link>
                  ) : !surveyHasQuotation(survey) && canCreateQuotation ? (
                    <Link
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
                      to={`/quotations?new=1&siteSurveyId=${survey.id}`}
                    >
                      Create Quotation
                    </Link>
                  ) : surveyHasQuotation(survey) ? (
                    <PlaceholderAction>Go to Project</PlaceholderAction>
                  ) : (
                    <PlaceholderAction>Create Quotation</PlaceholderAction>
                  )}
                </div>
              </div>
            </header>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <DetailSection compact title="Enquiry and Customer Details">
              <DetailItem label="Source" value={contact.sourceLabel} />
              <DetailItem label="Name" value={contact.name} />
              <DetailItem label="Phone" value={contact.phone} />
              <DetailItem label="Enquiry" value={leadLink(survey)} />
              <DetailItem label="Customer" value={customerLink(survey)} />
              <DetailItem
                label="Contact Email"
                value={survey.customer?.email ?? survey.lead?.email ?? "-"}
              />
              <div className="sm:col-span-2">
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
              </div>
            </DetailSection>

            <DetailSection compact title="Schedule Details">
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
          </div>

          <DetailSection
            compact
            gridClassName="sm:grid-cols-3 lg:grid-cols-4"
            title="Technical Survey Data"
          >
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
              label="Recommended Capacity"
              value={
                survey.recommended_capacity_kw
                  ? `${survey.recommended_capacity_kw} kW`
                  : "-"
              }
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
            <div className="sm:col-span-3 lg:col-span-4">
              <DetailItem label="Address Notes" value={survey.address_notes ?? "-"} />
            </div>
            <div className="sm:col-span-3 lg:col-span-4">
              <DetailItem label="Remarks" value={survey.remarks ?? "-"} />
            </div>
          </DetailSection>

          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-slate-950">
                Photos and Documents
              </h2>
              {canUpdate && !survey.archived_at ? (
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
                      multiple
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
                      <SurveyFileCard
                        file={photo}
                        key={`${photo.url}-${photo.uploaded_at ?? photo.name}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No site photos uploaded.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-700">
                    Survey Documents
                  </p>
                  {surveyDocuments.length > 0 ? (
                    <span className="text-xs text-slate-500">
                      {surveyDocuments.length}
                    </span>
                  ) : null}
                </div>
                {surveyDocuments.length > 0 ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {surveyDocuments.map((file) => (
                      <SurveyFileCard
                        file={file}
                        key={`${file.url}-${file.uploaded_at ?? file.name}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No survey documents uploaded.
                  </p>
                )}
              </div>
            </div>
          </section>

          <RecordLifecyclePanel
            archiveReason={survey.archive_reason}
            archivedAt={survey.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="site_surveys"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Site survey permanently deleted.", "success");
                navigate("/site-surveys");
                return;
              }
              showToast(action === "archive" ? "Site survey archived." : "Site survey restored.", "success");
              await loadSurvey();
            }}
            recordId={survey.id}
            recordLabel={survey.survey_code || "Site survey"}
          />
        </>
      ) : null}

      {editing ? (
        <SiteSurveyFormModal
          title="Edit Site Survey"
          values={editing}
          formMode="detail"
          setValues={setEditing}
          errors={formErrors}
          lookups={{ leads, staff }}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
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
    <Link className="font-semibold text-[#06173f]" to={`/leads/${survey.lead_id}`}>
      {survey.lead?.lead_code ?? survey.lead?.full_name ?? "Open enquiry"}
    </Link>
  );
}

function customerLink(survey: SiteSurveyWithRelations) {
  if (!survey.customer_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
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

function SurveyFileCard({ file }: { file: SiteSurveyFile }) {
  const extension = fileExtension(file.name || file.url);
  const mimeType = file.mime_type?.toLowerCase() ?? "";
  const isImage =
    mimeType.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension);
  const isPdf = mimeType === "application/pdf" || extension === "pdf";

  return (
    <a
      className="block overflow-hidden rounded-lg border border-stone-200 bg-stone-50 transition-shadow hover:shadow-sm"
      href={file.url}
      rel="noreferrer"
      target="_blank"
    >
      <div className="relative h-36 overflow-hidden bg-stone-100">
        {isImage ? (
          <img
            alt={`${file.name} preview`}
            className="h-full w-full object-cover"
            loading="lazy"
            src={file.url}
          />
        ) : isPdf ? (
          <iframe
            className="pointer-events-none h-[175%] w-full origin-top-left scale-[0.58]"
            loading="lazy"
            src={`${file.url}#toolbar=0&navpanes=0&scrollbar=0`}
            title={`${file.name} preview`}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <SurveyFileIcon />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">
              {extension || "File"}
            </span>
          </div>
        )}
        <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          {isImage ? "Image" : isPdf ? "PDF" : extension || "File"}
        </span>
      </div>
      <div className="p-2">
        <p className="truncate text-sm font-medium text-slate-900" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-slate-500">{fileSizeLabel(file.size)}</p>
      </div>
    </a>
  );
}

function SurveyFileIcon() {
  return (
    <svg aria-hidden="true" className="size-10" fill="none" viewBox="0 0 24 24">
      <path
        d="M7 3.75h6.25L18 8.5v11.75a.75.75 0 0 1-.75.75h-10.5a.75.75 0 0 1-.75-.75V4.5A.75.75 0 0 1 7 3.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M13 3.75V8.5h4.75M9 12h6M9 15h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function fileExtension(value: string) {
  const fileName = value.split("?")[0]?.split("/").pop() ?? "";
  return fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
}

function getSurveyDocuments(survey: SiteSurveyWithRelations): SiteSurveyFile[] {
  const documents = Array.isArray(survey.survey_documents)
    ? survey.survey_documents
    : [];

  if (!survey.electricity_bill_url) {
    return documents;
  }

  const legacyDocumentIsPresent = documents.some(
    (document) =>
      document.url === survey.electricity_bill_url ||
      document.file_path === survey.electricity_bill_url,
  );

  if (legacyDocumentIsPresent) {
    return documents;
  }

  return [
    {
      name: surveyDocumentName(survey),
      url: survey.electricity_bill_url,
      mime_type: fileExtension(survey.electricity_bill_url) === "pdf"
        ? "application/pdf"
        : undefined,
    },
    ...documents,
  ];
}

function surveyHasQuotation(survey: SiteSurveyWithRelations) {
  return Boolean(survey.quotations && survey.quotations.length > 0);
}

function surveyDocumentName(survey: SiteSurveyWithRelations) {
  if (!survey.electricity_bill_url) {
    return "Uploaded Document";
  }

  const path = survey.electricity_bill_url.split("?")[0] ?? "";
  const name = path.split("/").filter(Boolean).pop();
  return name ? decodeURIComponent(name) : "Uploaded Document";
}
