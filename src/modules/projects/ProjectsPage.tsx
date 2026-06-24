import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
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
  requiredError,
  staffName,
} from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import { fetchVendors } from "../vendors/vendorApi";
import type { Vendor } from "../vendors/types";
import {
  createProject,
  deleteProject,
  fetchProjectCustomers,
  fetchProjectQuotations,
  fetchProjects,
  fetchProjectSiteSurveys,
  updateProject,
  updateProjectStatus,
} from "./projectApi";
import {
  emptyProjectForm,
  filterInstallationVendors,
  formatCustomerAddress,
  formatKw,
  formatTeamDisplay,
  getProjectContact,
  parseTeamInput,
  priorityTone,
  projectPriorityOptions,
  projectStatusOptions,
  projectStatusTone,
  projectToForm,
  projectTypeOptions,
  teamVendorAssignmentInput,
} from "./projectUtils";
import type {
  ProjectFormValues,
  ProjectStatus,
  ProjectWithRelations,
} from "./types";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
} from "../site-surveys/types";
import { customerOptionLabel } from "../site-surveys/surveyUtils";
import type { QuotationWithRelations } from "../quotations/types";

type ProjectFilters = {
  search: string;
  status: string;
  priority: string;
  manager: string;
  startDate: string;
};

export function ProjectsPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectWithRelations[]>([]);
  const [customers, setCustomers] = useState<SurveyCustomerSummary[]>([]);
  const [quotations, setQuotations] = useState<QuotationWithRelations[]>([]);
  const [siteSurveys, setSiteSurveys] = useState<SiteSurveyWithRelations[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [installationVendors, setInstallationVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProjectFilters>({
    search: "",
    status: "",
    priority: "",
    manager: "",
    startDate: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    project: ProjectWithRelations | null;
    values: ProjectFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectWithRelations | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    project: ProjectWithRelations;
    status: ProjectStatus;
  } | null>(null);
  const [stockOutAlert, setStockOutAlert] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const canView = hasPermission(profile, permissions, "projects", "view");
  const canCreate = hasPermission(profile, permissions, "projects", "create");
  const canUpdate = hasPermission(profile, permissions, "projects", "update");
  const canDelete = hasPermission(profile, permissions, "projects", "delete");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [
        nextProjects,
        nextCustomers,
        nextQuotations,
        nextSiteSurveys,
        nextStaff,
        nextInstallationVendors,
      ] = await Promise.all([
        fetchProjects(profile),
        fetchProjectCustomers(profile),
        fetchProjectQuotations(profile),
        fetchProjectSiteSurveys(profile),
        fetchStaffOptions(profile),
        fetchVendors(profile).then(filterInstallationVendors).catch(() => []),
      ]);
      setProjects(nextProjects);
      setCustomers(nextCustomers);
      setQuotations(nextQuotations);
      setSiteSurveys(nextSiteSurveys);
      setStaff(nextStaff);
      setInstallationVendors(nextInstallationVendors);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load projects.",
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

  const filteredProjects = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return projects.filter((project) => {
      const contact = getProjectContact(project);
      const matchesSearch =
        !search ||
        [
          project.project_code,
          project.project_name,
          contact.customerName,
          contact.phone,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus =
        !filters.status || project.project_status === filters.status;
      const matchesPriority =
        !filters.priority || project.priority === filters.priority;
      const matchesManager =
        !filters.manager || project.assigned_project_manager === filters.manager;
      const matchesStart =
        !filters.startDate || project.start_date === filters.startDate;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesManager &&
        matchesStart
      );
    });
  }, [projects, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="Projects are not available"
        description="Your role needs projects:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      project: null,
      values: emptyProjectForm(),
    });
  }

  function openEditForm(project: ProjectWithRelations) {
    setFormErrors({});
    setFormState({
      mode: "edit",
      project,
      values: projectToForm(project),
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = {
      customer_id: requiredError(formState.values.customer_id, "Customer"),
      project_name: requiredError(formState.values.project_name, "Project name"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        const project = await createProject(profile, formState.values);
        showToast("Project created.", "success");
        setFormState(null);
        navigate(`/projects/${project.id}`);
        return;
      }

      if (formState.project) {
        await updateProject(formState.project.id, formState.values);
        showToast("Project updated.", "success");
        setFormState(null);
        await loadData();
      }
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Project save failed.",
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
      await deleteProject(deleteTarget.id);
      setProjects((current) =>
        current.filter((project) => project.id !== deleteTarget.id),
      );
      showToast("Project deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Project delete failed.",
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
      await updateProjectStatus(statusTarget.project.id, statusTarget.status);
      showToast("Project status updated.", "success");
      setStatusTarget(null);
      await loadData();
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Project status update failed.";

      if (statusTarget.status === "material_dispatched") {
        setStockOutAlert(message);
      } else {
        showToast(message, "error");
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Projects"
          description="Track accepted solar installations from project creation through commissioning."
        />
        {canCreate ? <Button onClick={openCreateForm}>Add Project</Button> : null}
      </div>

      <Toolbar className="md:grid-cols-4">
        <SearchInput
          className="md:col-span-4"
          placeholder="Search project, customer, or phone"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Project Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...projectStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Priority"
          value={filters.priority}
          onChange={(priority) =>
            setFilters((current) => ({ ...current, priority }))
          }
          options={[
            { value: "", label: "All priorities" },
            ...projectPriorityOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Project Manager"
          value={filters.manager}
          onChange={(manager) =>
            setFilters((current) => ({ ...current, manager }))
          }
          options={[
            { value: "", label: "All managers" },
            ...staff.map((option) => ({
              value: option.id,
              label: option.full_name || option.email || option.phone || "Staff user",
            })),
          ]}
        />
        <TextInput
          label="Start Date"
          type="date"
          value={filters.startDate}
          onChange={(startDate) =>
            setFilters((current) => ({ ...current, startDate }))
          }
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load projects" description={error} /> : null}
      {!loading && !error && filteredProjects.length === 0 ? (
        <EmptyState
          title="No projects found"
          description="Create a project manually or convert an accepted quotation into an installation project."
          action={canCreate ? <Button onClick={openCreateForm}>Add Project</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredProjects.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm 2xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Capacity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Manager</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredProjects.map((project) => {
                  const contact = getProjectContact(project);
                  return (
                    <tr key={project.id}>
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {project.project_code ?? "-"}
                      </td>
                      <td className="px-4 py-3">{project.project_name ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {contact.customerName}
                        </div>
                        <div className="text-xs text-slate-500">{contact.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        {formatKw(project.system_capacity_kw)}
                      </td>
                      <td className="px-4 py-3">
                        <ProjectStatusBadge value={project.project_status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge value={project.priority} />
                      </td>
                      <td className="px-4 py-3">
                        {staffName(staff, project.assigned_project_manager)}
                      </td>
                      <td className="px-4 py-3">{formatDate(project.start_date)}</td>
                      <td className="px-4 py-3">
                        {formatDate(project.expected_completion_date)}
                      </td>
                      <td className="px-4 py-3">{formatDate(project.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <ViewLink to={`/projects/${project.id}`}>View</ViewLink>
                          {canUpdate ? (
                            <>
                              <Button
                                onClick={() => openEditForm(project)}
                                variant="secondary"
                              >
                                Edit
                              </Button>
                              <ProjectStatusSelect
                                disabled={updatingStatus}
                                value={project.project_status ?? "created"}
                                onChange={(status) =>
                                  setStatusTarget({ project, status })
                                }
                              />
                            </>
                          ) : null}
                          {canDelete ? (
                            <Button
                              onClick={() => setDeleteTarget(project)}
                              variant="danger"
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 2xl:hidden">
            {filteredProjects.map((project) => {
              const contact = getProjectContact(project);
              return (
                <article
                  key={project.id}
                  className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {project.project_code ?? "Project"}
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-slate-950">
                        {project.project_name ?? contact.customerName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {contact.customerName} / {contact.phone}
                      </p>
                    </div>
                    <ProjectStatusBadge value={project.project_status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Capacity</dt>
                      <dd className="font-medium text-slate-900">
                        {formatKw(project.system_capacity_kw)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Priority</dt>
                      <dd>
                        <PriorityBadge value={project.priority} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Start</dt>
                      <dd className="font-medium text-slate-900">
                        {formatDate(project.start_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Manager</dt>
                      <dd className="font-medium text-slate-900">
                        {staffName(staff, project.assigned_project_manager)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ViewLink to={`/projects/${project.id}`}>View</ViewLink>
                    {canUpdate ? (
                      <>
                        <Button
                          onClick={() => openEditForm(project)}
                          variant="secondary"
                        >
                          Edit
                        </Button>
                        <ProjectStatusSelect
                          disabled={updatingStatus}
                          value={project.project_status ?? "created"}
                          onChange={(status) => setStatusTarget({ project, status })}
                        />
                      </>
                    ) : null}
                    {canDelete ? (
                      <Button
                        onClick={() => setDeleteTarget(project)}
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
        </>
      ) : null}

      {formState ? (
        <ProjectFormModal
          title={formState.mode === "create" ? "Add Project" : "Edit Project"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          customers={customers}
          quotations={quotations}
          siteSurveys={siteSurveys}
          staff={staff}
          installationVendors={installationVendors}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete project?"
          description={`This will remove ${deleteTarget.project_name ?? deleteTarget.project_code ?? "this project"} from the installation workflow.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          title={
            statusTarget.status === "cancelled"
              ? "Cancel project?"
              : "Update project status?"
          }
          description={`Set ${statusTarget.project.project_code ?? "this project"} to ${labelize(statusTarget.status)}.`}
          confirming={updatingStatus}
          confirmLabel={
            statusTarget.status === "cancelled" ? "Cancel Project" : "Update Status"
          }
          confirmingLabel="Updating..."
          confirmVariant={statusTarget.status === "cancelled" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusUpdate}
        />
      ) : null}

      {stockOutAlert ? (
        <AlertDialog
          title="BOM stock out entry is not placed"
          description={stockOutAlert}
          onClose={() => setStockOutAlert(null)}
        />
      ) : null}
    </div>
  );
}

export function ProjectFormModal({
  title,
  values,
  setValues,
  errors,
  customers,
  quotations,
  siteSurveys,
  staff,
  installationVendors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: ProjectFormValues;
  setValues: (values: ProjectFormValues) => void;
  errors: Record<string, string>;
  customers: SurveyCustomerSummary[];
  quotations: QuotationWithRelations[];
  siteSurveys: SiteSurveyWithRelations[];
  staff: StaffOption[];
  installationVendors: Vendor[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof ProjectFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const installationVendorOptions = installationTeamOptions(
    installationVendors,
    values.assigned_installation_team,
  );

  function handleCustomerChange(customerId: string) {
    const customer = customers.find((option) => option.id === customerId);
    const customerQuotation = latestCustomerQuotation(quotations, customerId);
    const customerSurvey = latestCustomerSiteSurvey(siteSurveys, customerId);
    const nextValues = applyCustomerToProjectValues(values, customerId, customer);
    const surveyCapacity =
      customerSurvey?.recommended_capacity_kw === null ||
      customerSurvey?.recommended_capacity_kw === undefined
        ? ""
        : String(customerSurvey.recommended_capacity_kw);
    const quotationCapacity =
      customerQuotation?.system_capacity_kw === null ||
      customerQuotation?.system_capacity_kw === undefined
        ? ""
        : String(customerQuotation.system_capacity_kw);

    setValues({
      ...nextValues,
      quotation_id: customerQuotation?.id ?? "",
      site_survey_id:
        customerQuotation?.site_survey_id ?? customerSurvey?.id ?? "",
      lead_id: customerQuotation?.lead_id ?? customerSurvey?.lead_id ?? "",
      project_name:
        customerQuotation?.customer?.full_name && customerQuotation.quotation_code
          ? `${customerQuotation.customer.full_name} Solar Installation - ${customerQuotation.quotation_code}`
          : nextValues.project_name,
      system_capacity_kw:
        quotationCapacity || surveyCapacity || nextValues.system_capacity_kw,
      notes: nextValues.notes || customerQuotation?.notes || "",
    });
  }

  function handleQuotationChange(quotationId: string) {
    const quotation = quotations.find((option) => option.id === quotationId);
    const customerId = quotation?.customer_id ?? values.customer_id;
    const customer = customers.find((option) => option.id === customerId);
    const nextValues = applyCustomerToProjectValues(values, customerId, customer);

    setValues({
      ...nextValues,
      quotation_id: quotationId,
      lead_id: quotation?.lead_id ?? values.lead_id,
      site_survey_id: quotation?.site_survey_id ?? values.site_survey_id,
      project_name:
        nextValues.project_name ||
        (quotation?.customer?.full_name && quotation.quotation_code
          ? `${quotation.customer.full_name} Solar Installation - ${quotation.quotation_code}`
          : ""),
      system_capacity_kw:
        nextValues.system_capacity_kw ||
        (quotation?.system_capacity_kw === null ||
        quotation?.system_capacity_kw === undefined
          ? ""
          : String(quotation.system_capacity_kw)),
      notes: nextValues.notes || quotation?.notes || "",
    });
  }

  function handleSurveyChange(siteSurveyId: string) {
    const survey = siteSurveys.find((option) => option.id === siteSurveyId);
    const customerId = survey?.customer_id ?? values.customer_id;
    const customer = customers.find((option) => option.id === customerId);
    const nextValues = applyCustomerToProjectValues(values, customerId, customer);

    setValues({
      ...nextValues,
      site_survey_id: siteSurveyId,
      lead_id: survey?.lead_id ?? values.lead_id,
      system_capacity_kw:
        nextValues.system_capacity_kw ||
        (survey?.recommended_capacity_kw === null ||
        survey?.recommended_capacity_kw === undefined
          ? ""
          : String(survey.recommended_capacity_kw)),
    });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Project"
      submitting={saving}
    >
      <SelectInput
        label="Customer"
        value={values.customer_id}
        onChange={handleCustomerChange}
        options={[
          { value: "", label: "Select customer" },
          ...customers.map((customer) => ({
            value: customer.id,
            label: customerOptionLabel(customer),
          })),
        ]}
      />
      {errors.customer_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.customer_id}</p>
      ) : null}
      <SelectInput
        label="Quotation"
        value={values.quotation_id}
        onChange={handleQuotationChange}
        options={[
          { value: "", label: "No quotation linked" },
          ...quotations.map((quotation) => ({
            value: quotation.id,
            label: `${quotation.quotation_code ?? "Quotation"} - ${
              quotation.customer?.full_name ?? "Customer"
            }`,
          })),
        ]}
      />
      <SelectInput
        label="Site Survey"
        value={values.site_survey_id}
        onChange={handleSurveyChange}
        options={[
          { value: "", label: "No site survey linked" },
          ...siteSurveys.map((survey) => ({
            value: survey.id,
            label: `${survey.survey_code ?? "Survey"} - ${
              survey.customer?.full_name ?? survey.lead?.full_name ?? "Unlinked"
            }`,
          })),
        ]}
      />
      <TextInput
        label="Project Name"
        value={values.project_name}
        onChange={(value) => update("project_name", value)}
        error={errors.project_name}
        required
      />
      <TextInput
        label="System Capacity (kW)"
        value={values.system_capacity_kw}
        onChange={(value) => update("system_capacity_kw", value)}
        type="number"
      />
      <SelectInput
        label="Project Type"
        value={values.project_type}
        onChange={(value) => update("project_type", value)}
        options={projectTypeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <SelectInput
        label="Project Status"
        value={values.project_status}
        onChange={(value) => update("project_status", value as ProjectStatus)}
        options={projectStatusOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <SelectInput
        label="Priority"
        value={values.priority}
        onChange={(value) =>
          update("priority", value as ProjectFormValues["priority"])
        }
        options={projectPriorityOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <TextInput
        label="Start Date"
        value={values.start_date}
        onChange={(value) => update("start_date", value)}
        type="date"
      />
      <TextInput
        label="Expected Completion"
        value={values.expected_completion_date}
        onChange={(value) => update("expected_completion_date", value)}
        type="date"
      />
      <StaffSelect
        staff={staff}
        value={values.assigned_project_manager}
        onChange={(value) => update("assigned_project_manager", value)}
      />
      <TextInput
        label="City"
        value={values.city}
        onChange={(value) => update("city", value)}
      />
      <TextInput
        label="District"
        value={values.district}
        onChange={(value) => update("district", value)}
      />
      <TextInput
        label="State"
        value={values.state}
        onChange={(value) => update("state", value)}
      />
      <TextInput
        label="Pincode"
        value={values.pincode}
        onChange={(value) => update("pincode", value)}
      />
      <TextArea
        label="Installation Address"
        value={values.installation_address}
        onChange={(value) => update("installation_address", value)}
      />
      <SelectInput
        label="Assigned Installation Team"
        value={values.assigned_installation_team}
        onChange={(value) => update("assigned_installation_team", value)}
        options={installationVendorOptions}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

function applyCustomerToProjectValues(
  values: ProjectFormValues,
  customerId: string,
  customer: SurveyCustomerSummary | undefined,
): ProjectFormValues {
  const customerProjectType = normalizeProjectType(customer?.customer_type);

  return {
    ...values,
    customer_id: customerId,
    project_name:
      values.project_name ||
      (customer?.full_name ? `${customer.full_name} Solar Installation` : ""),
    installation_address:
      values.installation_address ||
      (customer ? formatCustomerAddress(customer) : ""),
    city: values.city || customer?.city || "",
    district: values.district || customer?.district || "",
    state: values.state || customer?.state || "",
    pincode: values.pincode || customer?.pincode || "",
    project_type:
      customerProjectType || values.project_type || "residential",
    assigned_project_manager:
      values.assigned_project_manager || customer?.assigned_to || "",
  };
}

function latestCustomerQuotation(
  quotations: QuotationWithRelations[],
  customerId: string,
) {
  if (!customerId) {
    return null;
  }

  return quotations
    .filter((quotation) => quotation.customer_id === customerId)
    .slice()
    .sort((first, second) =>
      sortByLatestDate(
        first.accepted_at ||
          first.sent_at ||
          first.quotation_date ||
          first.created_at,
        second.accepted_at ||
          second.sent_at ||
          second.quotation_date ||
          second.created_at,
      ),
    )[0] ?? null;
}

function latestCustomerSiteSurvey(
  siteSurveys: SiteSurveyWithRelations[],
  customerId: string,
) {
  if (!customerId) {
    return null;
  }

  return siteSurveys
    .filter((survey) => survey.customer_id === customerId)
    .slice()
    .sort((first, second) =>
      sortByLatestDate(
        first.completed_at || first.scheduled_date || first.created_at,
        second.completed_at || second.scheduled_date || second.created_at,
      ),
    )[0] ?? null;
}

function installationTeamOptions(vendors: Vendor[], currentValue: string) {
  const vendorOptions = vendors.map((vendor) => ({
    value: teamVendorAssignmentInput({
      vendor_id: vendor.id,
      vendor_code: vendor.vendor_code,
      vendor_name: vendor.vendor_name,
      vendor_type: vendor.vendor_type,
      phone: vendor.phone,
    }),
    label: vendorInstallationLabel(vendor),
  }));
  const hasCurrentValue =
    !currentValue ||
    vendorOptions.some((option) => option.value === currentValue);

  return [
    { value: "", label: "Select installation vendor" },
    ...(hasCurrentValue
      ? []
      : [
          {
            value: currentValue,
            label: `Current - ${formatTeamDisplay(parseTeamInput(currentValue))}`,
          },
        ]),
    ...vendorOptions,
  ];
}

function vendorInstallationLabel(vendor: Vendor) {
  const contact = [vendor.contact_person, vendor.phone].filter(Boolean).join(" / ");
  const type = labelize(vendor.vendor_type);

  return `${vendor.vendor_code ?? "Vendor"} - ${vendor.vendor_name}${
    contact ? ` (${contact})` : ""
  } - ${type}`;
}

function sortByLatestDate(
  firstDate: string | null | undefined,
  secondDate: string | null | undefined,
) {
  return dateSortValue(secondDate) - dateSortValue(firstDate);
}

function dateSortValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeProjectType(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  const match = projectTypeOptions.find((option) => option === normalized);

  return match ?? "";
}

export function ProjectStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={projectStatusTone(value)}>{labelize(value)}</Badge>;
}

export function PriorityBadge({ value }: { value: string | null | undefined }) {
  return <Badge tone={priorityTone(value)}>{labelize(value)}</Badge>;
}

export function ProjectStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex">
      <span className="sr-only">Update project status</span>
      <select
        className="min-h-9 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-stone-50 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as ProjectStatus)}
      >
        {projectStatusOptions.map((status) => (
          <option key={status} value={status}>
            {labelize(status)}
          </option>
        ))}
      </select>
    </label>
  );
}
