import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SearchInput,
  SelectInput,
  StaffSelect,
  TextArea,
  TextInput,
  Toolbar,
  ViewLink,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
  labelize,
  leadRoofTypeOptions,
  requiredError,
  staffName,
} from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import {
  recordPaletteCardClassName,
  recordPaletteTableRowClassName,
} from "../shared/recordOriginStyles";
import {
  createSiteSurvey,
  deleteSiteSurvey,
  fetchSiteSurveys,
  fetchSurveyLead,
  fetchSurveyLeadOptions,
  updateSiteSurvey,
  updateSiteSurveyStatus,
} from "./siteSurveyApi";
import {
  formatLeadAddress,
  formatSurveyTime,
  getSurveyContact,
  leadOptionLabel,
  leadToSurveyForm,
  surveyStatusOptions,
  surveyStatusTone,
  surveyToForm,
} from "./surveyUtils";
import type {
  SiteSurveyFormValues,
  SiteSurveyStatus,
  SiteSurveyWithRelations,
  SurveyLeadSummary,
} from "./types";

type SurveyFilters = {
  search: string;
  status: string;
  assignedTo: string;
  scheduledDate: string;
};

const scheduledTimeOptions = [
  { value: "", label: "Select scheduled time" },
  ...Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2);
    const minute = index % 2 === 0 ? "00" : "30";
    const value = `${String(hour).padStart(2, "0")}:${minute}`;

    return { value, label: formatTimeOptionLabel(value) };
  }),
];

function formatTimeOptionLabel(value: string) {
  const [hourValue, minuteValue = "00"] = value.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${String(displayHour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
}

export function SiteSurveysPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [surveys, setSurveys] = useState<SiteSurveyWithRelations[]>([]);
  const [leads, setLeads] = useState<SurveyLeadSummary[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SurveyFilters>({
    search: "",
    status: "",
    assignedTo: "",
    scheduledDate: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    survey: SiteSurveyWithRelations | null;
    values: SiteSurveyFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<SiteSurveyWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    survey: SiteSurveyWithRelations;
    status: SiteSurveyStatus;
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [prefillHandled, setPrefillHandled] = useState(false);

  const canView = hasPermission(profile, permissions, "site_surveys", "view");
  const canCreate = hasPermission(profile, permissions, "site_surveys", "create");
  const canUpdate = hasPermission(profile, permissions, "site_surveys", "update");
  const canDelete = hasPermission(profile, permissions, "site_surveys", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateQuotation = hasPermission(
    profile,
    permissions,
    "quotations",
    "create",
  );

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextSurveys, nextLeads, nextStaff] =
        await Promise.all([
          fetchSiteSurveys(profile),
          fetchSurveyLeadOptions(profile),
          fetchStaffOptions(profile),
        ]);
      setSurveys(nextSurveys);
      setLeads(nextLeads);
      setStaff(nextStaff);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load site surveys.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  useEffect(() => {
    async function openLeadPrefill() {
      const leadId = searchParams.get("leadId");
      const shouldOpen = searchParams.get("new") === "1";

      if (!canCreate || !shouldOpen || !leadId || prefillHandled) {
        return;
      }

      try {
        const lead = await fetchSurveyLead(profile, leadId);
        if (!lead) {
          showToast("Lead could not be loaded for survey scheduling.", "error");
          return;
        }

        setFormErrors({});
        setFormState({
          mode: "create",
          survey: null,
          values: leadToSurveyForm(lead),
        });
      } catch (nextError) {
        showToast(
          nextError instanceof Error
            ? nextError.message
            : "Lead prefill failed.",
          "error",
        );
      } finally {
        setPrefillHandled(true);
        setSearchParams({}, { replace: true });
      }
    }

    void openLeadPrefill();
  }, [
    canCreate,
    prefillHandled,
    profile,
    searchParams,
    setSearchParams,
    showToast,
  ]);

  const filteredSurveys = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return surveys.filter((survey) => {
      const contact = getSurveyContact(survey);
      const matchesSearch =
        !search ||
        [
          survey.survey_code,
          survey.lead?.full_name,
          survey.customer?.full_name,
          contact.phone,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus =
        !filters.status || survey.survey_status === filters.status;
      const matchesAssigned =
        !filters.assignedTo || survey.assigned_to === filters.assignedTo;
      const matchesDate =
        !filters.scheduledDate ||
        survey.scheduled_date === filters.scheduledDate;

      return matchesSearch && matchesStatus && matchesAssigned && matchesDate;
    });
  }, [surveys, filters]);

  const surveyPagination = useTablePagination(filteredSurveys);
  const paginatedSurveys = surveyPagination.pageItems;

  if (!canView) {
    return (
      <AccessDenied
        title="Site surveys are not available"
        description="Your role needs site_surveys:view access to open this module."
      />
    );
  }

  function openEditForm(survey: SiteSurveyWithRelations) {
    setFormErrors({});
    setFormState({ mode: "edit", survey, values: surveyToForm(survey) });
  }

  function openSurveyDetail(surveyId: string) {
    navigate(`/site-surveys/${surveyId}`);
  }

  function handleSurveyRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    surveyId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSurveyDetail(surveyId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = {
      scheduled_date: requiredError(
        formState.values.scheduled_date,
        "Scheduled date",
      ),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createSiteSurvey(profile, formState.values);
        showToast("Site survey scheduled.", "success");
      } else if (formState.survey) {
        await updateSiteSurvey(formState.survey.id, formState.values);
        showToast("Site survey updated.", "success");
      }
      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Site survey save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await deleteSiteSurvey(deleteTarget.id);
      setSurveys((current) =>
        current.filter((survey) => survey.id !== deleteTarget.id),
      );
      showToast("Site survey deleted.", "success");
      setDeleteTarget(null);
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
    if (!statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await updateSiteSurveyStatus(statusTarget.survey.id, statusTarget.status);
      showToast("Survey status updated.", "success");
      setStatusTarget(null);
      await loadData();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Site Surveys"
          description="Review inspections created from enquiries and keep the survey handoff ready for future quotations."
        />
      </div>

      <Toolbar className="md:grid-cols-3">
        <SearchInput
          className="md:col-span-3"
          placeholder="Search survey, name, or phone"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Survey Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...surveyStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Assigned To"
          value={filters.assignedTo}
          onChange={(assignedTo) =>
            setFilters((current) => ({ ...current, assignedTo }))
          }
          options={[
            { value: "", label: "All staff" },
            ...staff.map((option) => ({
              value: option.id,
              label: option.full_name || option.email || option.phone || "Staff user",
            })),
          ]}
        />
        <TextInput
          label="Scheduled Date"
          type="date"
          value={filters.scheduledDate}
          onChange={(scheduledDate) =>
            setFilters((current) => ({ ...current, scheduledDate }))
          }
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load site surveys" description={error} />
      ) : null}
      {!loading && !error && filteredSurveys.length === 0 ? (
        <EmptyState
          title="No site surveys found"
          description="Site surveys will appear here after they are scheduled from an enquiry."
        />
      ) : null}

      {!loading && !error && filteredSurveys.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Survey</th>
                  <th className="px-4 py-3">Customer / Enquiry</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedSurveys.map((survey) => {
                  const contact = getSurveyContact(survey);
                  return (
                    <tr
                      key={survey.id}
                      className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName("projectFlow")}`}
                      onClick={() => openSurveyDetail(survey.id)}
                      onKeyDown={(event) => handleSurveyRowKeyDown(event, survey.id)}
                      role="link"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {survey.survey_code ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {contact.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {contact.sourceLabel}
                        </div>
                      </td>
                      <td className="px-4 py-3">{contact.phone}</td>
                      <td className="px-4 py-3">
                        <SurveyStatusBadge value={survey.survey_status} />
                      </td>
                      <td className="px-4 py-3">
                        {staffName(staff, survey.assigned_to)}
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(survey.created_at)}
                      </td>
                      <td className="w-44 px-4 py-3">
                        <SurveyNextStepActions
                          canCreateQuotation={canCreateQuotation}
                          canViewProjects={canViewProjects}
                          survey={survey}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedSurveys.map((survey) => {
              const contact = getSurveyContact(survey);
              return (
                <article
                  key={survey.id}
                  className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName("projectFlow")}`}
                  onClick={() => openSurveyDetail(survey.id)}
                  onKeyDown={(event) => handleSurveyRowKeyDown(event, survey.id)}
                  role="link"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {survey.survey_code ?? "Survey"}
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-slate-950">
                        {contact.name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {contact.phone}
                      </p>
                    </div>
                    <SurveyStatusBadge value={survey.survey_status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Scheduled</dt>
                      <dd className="font-medium text-slate-900">
                        {formatDate(survey.scheduled_date)}{" "}
                        {formatSurveyTime(survey.scheduled_time)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Assigned</dt>
                      <dd className="font-medium text-slate-900">
                        {staffName(staff, survey.assigned_to)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Capacity</dt>
                      <dd className="font-medium text-slate-900">
                        {survey.recommended_capacity_kw
                          ? `${survey.recommended_capacity_kw} kW`
                          : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Created</dt>
                      <dd className="font-medium text-slate-900">
                        {formatDate(survey.created_at)}
                      </dd>
                    </div>
                  </dl>
                  <div
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <SurveyNextStepActions
                      canCreateQuotation={canCreateQuotation}
                      canViewProjects={canViewProjects}
                      survey={survey}
                    />
                  </div>
                  <div
                    className="mt-4 flex flex-wrap gap-2"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <ViewLink to={`/site-surveys/${survey.id}`}>View</ViewLink>
                    {canUpdate ? (
                      <>
                        <Button
                          onClick={() => openEditForm(survey)}
                          variant="secondary"
                        >
                          Edit
                        </Button>
                        <SurveyStatusSelect
                          disabled={updatingStatus}
                          value={survey.survey_status ?? "scheduled"}
                          onChange={(status) => setStatusTarget({ survey, status })}
                        />
                      </>
                    ) : null}
                    {canDelete ? (
                      <Button
                        onClick={() => setDeleteTarget(survey)}
                        variant="danger"
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          <TablePagination label="site surveys" pagination={surveyPagination} />
        </>
      ) : null}

      {formState ? (
        <SiteSurveyFormModal
          title={
            formState.mode === "create" ? "Schedule Site Survey" : "Edit Site Survey"
          }
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          lookups={{ leads, staff }}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete site survey?"
          description={`This will remove ${deleteTarget.survey_code ?? "this survey"} from the survey workflow.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          title="Update survey status?"
          description={`Set ${statusTarget.survey.survey_code ?? "this survey"} to ${labelize(statusTarget.status)}.`}
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

export function SiteSurveyFormModal({
  title,
  values,
  setValues,
  errors,
  lookups,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: SiteSurveyFormValues;
  setValues: (values: SiteSurveyFormValues) => void;
  errors: Record<string, string>;
  lookups: {
    leads: SurveyLeadSummary[];
    staff: StaffOption[];
  };
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof SiteSurveyFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const roofTypeOptions = [
    { value: "", label: "Select roof type" },
    ...leadRoofTypeOptions.map((value) => ({ value, label: value })),
    ...(values.roof_type && !leadRoofTypeOptions.includes(values.roof_type)
      ? [{ value: values.roof_type, label: values.roof_type }]
      : []),
  ];
  const phaseTypeOptions = [
    { value: "", label: "Select phase type" },
    { value: "single_phase", label: "Single Phase" },
    { value: "three_phase", label: "Three Phase" },
    ...(values.phase_type &&
    !["single_phase", "three_phase"].includes(values.phase_type)
      ? [{ value: values.phase_type, label: labelize(values.phase_type) }]
      : []),
  ];
  const timeOptions = [
    ...scheduledTimeOptions,
    ...(values.scheduled_time &&
    !scheduledTimeOptions.some((option) => option.value === values.scheduled_time)
      ? [
          {
            value: values.scheduled_time,
            label: formatTimeOptionLabel(values.scheduled_time),
          },
        ]
      : []),
  ];

  function handleLeadChange(leadId: string) {
    const lead = lookups.leads.find((option) => option.id === leadId);
    const nextValues = { ...values, lead_id: leadId, customer_id: "" };

    if (lead) {
      nextValues.customer_id = lead.converted_customer_id ?? lead.customer_id ?? "";
      nextValues.assigned_to = nextValues.assigned_to || lead.assigned_to || "";
      nextValues.roof_type = nextValues.roof_type || lead.roof_type || "";
      nextValues.recommended_capacity_kw =
        nextValues.recommended_capacity_kw ||
        (lead.estimated_load_kw === null || lead.estimated_load_kw === undefined
          ? ""
          : String(lead.estimated_load_kw));
      nextValues.address_notes =
        nextValues.address_notes || formatLeadAddress(lead);
    }

    setValues(nextValues);
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Survey"
      submitting={saving}
    >
      <SelectInput
        label="Enquiry"
        value={values.lead_id}
        onChange={handleLeadChange}
        options={[
          { value: "", label: "No enquiry linked" },
          ...lookups.leads.map((lead) => ({
            value: lead.id,
            label: leadOptionLabel(lead),
          })),
        ]}
      />
      <TextInput
        label="Scheduled Date"
        value={values.scheduled_date}
        onChange={(value) => update("scheduled_date", value)}
        error={errors.scheduled_date}
        type="date"
        required
      />
      <SelectInput
        label="Scheduled Time"
        value={values.scheduled_time}
        onChange={(value) => update("scheduled_time", value)}
        options={timeOptions}
      />
      <StaffSelect
        staff={lookups.staff}
        value={values.assigned_to}
        onChange={(value) => update("assigned_to", value)}
      />
      <SelectInput
        label="Roof Type"
        value={values.roof_type}
        onChange={(value) => update("roof_type", value)}
        options={roofTypeOptions}
      />
      <TextInput
        label="Roof Area (sqft)"
        value={values.roof_area_sqft}
        onChange={(value) => update("roof_area_sqft", value)}
        type="number"
      />
      <TextInput
        label="Shadow Free Area (sqft)"
        value={values.shadow_free_area_sqft}
        onChange={(value) => update("shadow_free_area_sqft", value)}
        type="number"
      />
      <TextInput
        label="Latitude"
        value={values.latitude}
        onChange={(value) => update("latitude", value)}
        type="number"
      />
      <TextInput
        label="Longitude"
        value={values.longitude}
        onChange={(value) => update("longitude", value)}
        type="number"
      />
      <TextInput
        label="Recommended Capacity (kW)"
        value={values.recommended_capacity_kw}
        onChange={(value) => update("recommended_capacity_kw", value)}
        type="number"
      />
      <TextInput
        label="Sanctioned Load (kW)"
        value={values.sanctioned_load_kw}
        onChange={(value) => update("sanctioned_load_kw", value)}
        type="number"
      />
      <SelectInput
        label="Phase Type"
        value={values.phase_type}
        onChange={(value) => update("phase_type", value)}
        options={phaseTypeOptions}
      />
      <TextArea
        label="Address Notes"
        value={values.address_notes}
        onChange={(value) => update("address_notes", value)}
      />
      <TextArea
        label="Remarks"
        value={values.remarks}
        onChange={(value) => update("remarks", value)}
      />
    </Modal>
  );
}

function surveyHasQuotation(survey: SiteSurveyWithRelations) {
  return Boolean(survey.quotations && survey.quotations.length > 0);
}

function SurveyNextStepActions({
  survey,
  canCreateQuotation,
  canViewProjects,
}: {
  survey: SiteSurveyWithRelations;
  canCreateQuotation: boolean;
  canViewProjects: boolean;
}) {
  const className =
    "inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700";
  const projectPath = survey.project_id ? `/projects/${survey.project_id}` : "/projects";

  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {surveyHasQuotation(survey) && canViewProjects ? (
        <Link className={className} to={projectPath}>
          Go to Project
        </Link>
      ) : !surveyHasQuotation(survey) && canCreateQuotation ? (
        <Link
          className={className}
          to={`/quotations?new=1&siteSurveyId=${survey.id}`}
        >
          Create Quotation
        </Link>
      ) : (
        <span className="text-right text-sm font-medium text-slate-500">
          {surveyHasQuotation(survey) ? "Project ready" : "No next step available"}
        </span>
      )}
    </div>
  );
}

export function SurveyStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={surveyStatusTone(value)}>{labelize(value)}</Badge>;
}

export function SurveyStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: SiteSurveyStatus;
  onChange: (status: SiteSurveyStatus) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex">
      <span className="sr-only">Update survey status</span>
      <select
        className="min-h-9 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-stone-50 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as SiteSurveyStatus)}
      >
        {surveyStatusOptions.map((status) => (
          <option key={status} value={status}>
            {labelize(status)}
          </option>
        ))}
      </select>
    </label>
  );
}
