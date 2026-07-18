import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  createLead,
  fetchOrganizationFollowups,
  fetchLeads,
  fetchStaffOptions,
  updateLead,
} from "./crmApi";
import {
  emptyLeadForm,
  formatDate,
  formatEnquiryCode,
  getLeadFollowupState,
  hasPermission,
  labelize,
  leadPriorityOptions,
  leadRequirementTypeOptions,
  leadSourceOptions,
  leadStatusOptions,
  leadToForm,
  requiredError,
  staffName,
} from "./crmUtils";
import type {
  Lead,
  LeadFollowupWithLead,
  LeadFormValues,
  StaffOption,
} from "./types";
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SearchInput,
  SelectInput,
  StaffSelect,
  StatusBadge,
  TextArea,
  TextInput,
  Toolbar,
  ViewLink,
} from "./CrmComponents";
import {
  recordPaletteCardClassName,
  recordPaletteTableRowClassName,
} from "../shared/recordOriginStyles";
import {
  quotationWorkflowPillLabel,
  quotationWorkflowState,
  type QuotationWorkflowState,
} from "../shared/quotationWorkflow";

type LeadFilters = {
  search: string;
  status: string;
  priority: string;
  assignedTo: string;
  followupState: string;
};

export function LeadsPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [followups, setFollowups] = useState<LeadFollowupWithLead[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({
    search: "",
    status: "",
    priority: "",
    assignedTo: "",
    followupState: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    lead: Lead | null;
    values: LeadFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "leads", "view");
  const canCreate = hasPermission(profile, permissions, "leads", "create");
  const canUpdate = hasPermission(profile, permissions, "leads", "update");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateSurvey = hasPermission(
    profile,
    permissions,
    "site_surveys",
    "create",
  );
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
      const [nextLeads, nextStaff, nextFollowups] = await Promise.all([
        fetchLeads(profile, archiveScope),
        fetchStaffOptions(profile),
        fetchOrganizationFollowups(profile),
      ]);
      setLeads(nextLeads);
      setStaff(nextStaff);
      setFollowups(nextFollowups);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load leads.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over the current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveScope, canView, profile?.id]);

  const filteredLeads = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesSearch =
        !search ||
        [lead.full_name, lead.phone, lead.lead_code, formatEnquiryCode(lead.lead_code)]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || lead.status === filters.status;
      const matchesPriority =
        !filters.priority || lead.priority === filters.priority;
      const matchesAssigned =
        !filters.assignedTo || lead.assigned_to === filters.assignedTo;
      const matchesFollowup =
        !filters.followupState ||
        getLeadFollowupState(lead.id, followups) === filters.followupState;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesAssigned &&
        matchesFollowup
      );
    });
  }, [leads, followups, filters]);

  const leadPagination = useTablePagination(filteredLeads);
  const paginatedLeads = leadPagination.pageItems;

  if (!canView) {
    return (
      <AccessDenied
        title="Enquiries are not available"
        description="Your role needs leads:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({ mode: "create", lead: null, values: emptyLeadForm() });
  }

  function openEditForm(lead: Lead) {
    setFormErrors({});
    setFormState({ mode: "edit", lead, values: leadToForm(lead) });
  }

  function openLeadDetail(leadId: string) {
    navigate(`/leads/${leadId}`);
  }

  function handleLeadRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    leadId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLeadDetail(leadId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = {
      full_name: requiredError(formState.values.full_name, "Full name"),
      phone: requiredError(formState.values.phone, "Phone"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        const createdLead = await createLead(profile, formState.values);
        setLeads((current) => [createdLead, ...current]);
        showToast("Enquiry created.", "success");
      } else if (formState.lead) {
        const updatedLead = await updateLead(formState.lead.id, formState.values);
        setLeads((current) =>
          current.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead)),
        );
        showToast("Enquiry updated.", "success");
      }
      setFormState(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Enquiry save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Enquiries"
          description="Capture solar enquiries, track status, assign staff, and convert qualified enquiries into customer profiles."
        />
        {canCreate ? <Button onClick={openCreateForm}>Add Enquiry</Button> : null}
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

      <Toolbar className="md:grid-cols-4">
        <SearchInput
          className="md:col-span-4"
          placeholder="Search name, phone, or enq code"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...leadStatusOptions.map((value) => ({
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
            ...leadPriorityOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Follow-up"
          value={filters.followupState}
          onChange={(followupState) =>
            setFilters((current) => ({ ...current, followupState }))
          }
          options={[
            { value: "", label: "All follow-ups" },
            { value: "today", label: "Due today" },
            { value: "overdue", label: "Overdue" },
            { value: "none", label: "No follow-up scheduled" },
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
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load enquiries" description={error} /> : null}
      {!loading && !error && filteredLeads.length === 0 ? (
        <EmptyState
          title="No enquiries found"
          description="Add an enquiry to start tracking enquiries and follow-up status."
          action={canCreate ? <Button onClick={openCreateForm}>Add Enquiry</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredLeads.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Enq Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName("projectFlow")}`}
                    onClick={() => openLeadDetail(lead.id)}
                    onKeyDown={(event) => handleLeadRowKeyDown(event, lead.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatEnquiryCode(lead.lead_code)}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#06173f]">
                      {lead.full_name}
                    </td>
                    <td className="px-4 py-3">{lead.phone}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={lead.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={lead.priority} />
                    </td>
                    <td className="px-4 py-3">{staffName(staff, lead.assigned_to)}</td>
                    <td className="px-4 py-3">{formatDate(lead.created_at)}</td>
                    <td className="w-44 px-4 py-3">
                      <LeadNextStepActions
                        canCreateQuotation={canCreateQuotation}
                        canCreateSurvey={canCreateSurvey}
                        canViewProjects={canViewProjects}
                        lead={lead}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedLeads.map((lead) => (
              <article
                key={lead.id}
                className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName("projectFlow")}`}
                onClick={() => openLeadDetail(lead.id)}
                onKeyDown={(event) => handleLeadRowKeyDown(event, lead.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatEnquiryCode(lead.lead_code)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {lead.full_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">{lead.phone}</p>
                  </div>
                  <StatusBadge value={lead.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Assigned</dt>
                    <dd className="font-medium text-slate-900">
                      {staffName(staff, lead.assigned_to)}
                    </dd>
                  </div>
                </dl>
                <div
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <LeadNextStepActions
                    canCreateQuotation={canCreateQuotation}
                    canCreateSurvey={canCreateSurvey}
                    canViewProjects={canViewProjects}
                    lead={lead}
                  />
                </div>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <ViewLink to={`/leads/${lead.id}`}>View</ViewLink>
                  {canUpdate ? (
                    <Button onClick={() => openEditForm(lead)} variant="secondary">
                      Edit
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <TablePagination label="enquiries" pagination={leadPagination} />
        </>
      ) : null}

      {formState ? (
        <LeadFormModal
          title={formState.mode === "create" ? "Add Enquiry" : "Edit Enquiry"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          staff={staff}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

    </div>
  );
}

export function LeadFormModal({
  title,
  values,
  setValues,
  errors,
  staff,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: LeadFormValues;
  setValues: (values: LeadFormValues) => void;
  errors: Record<string, string>;
  staff: StaffOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof LeadFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Enquiry"
      submitting={saving}
    >
      <TextInput label="Full Name" value={values.full_name} onChange={(value) => update("full_name", value)} error={errors.full_name} required />
      <TextInput label="Phone" value={values.phone} onChange={(value) => update("phone", value)} error={errors.phone} required />
      <TextInput label="Email" value={values.email} onChange={(value) => update("email", value)} type="email" />
      <TextInput label="Offered Price" value={values.offered_price} onChange={(value) => update("offered_price", value)} type="number" />
      <TextArea label="Full Address" value={values.address} onChange={(value) => update("address", value)} />
      <TextInput label="City" value={values.city} onChange={(value) => update("city", value)} />
      <SelectInput
        label="Enquiry Source"
        value={values.lead_source}
        onChange={(value) => update("lead_source", value)}
        options={[
          { value: "", label: "Select enquiry source" },
          ...leadSourceOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <SelectInput
        label="Requirement Type"
        value={values.requirement_type}
        onChange={(value) => update("requirement_type", value)}
        options={[
          { value: "", label: "Select requirement type" },
          ...leadRequirementTypeOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <SelectInput label="Status" value={values.status} onChange={(value) => update("status", value)} options={leadStatusOptions.map((value) => ({ value, label: labelize(value) }))} />
      <SelectInput label="Priority" value={values.priority} onChange={(value) => update("priority", value)} options={leadPriorityOptions.map((value) => ({ value, label: labelize(value) }))} />
      <StaffSelect staff={staff} value={values.assigned_to} onChange={(value) => update("assigned_to", value)} />
      <TextArea label="Notes" value={values.notes} onChange={(value) => update("notes", value)} />
    </Modal>
  );
}

function LeadNextStepActions({
  lead,
  canCreateSurvey,
  canCreateQuotation,
  canViewProjects,
}: {
  lead: Lead;
  canCreateSurvey: boolean;
  canCreateQuotation: boolean;
  canViewProjects: boolean;
}) {
  const hasSiteSurvey = Boolean(lead.action_state?.hasSiteSurvey);
  const hasQuotation = Boolean(lead.action_state?.hasQuotation);
  const workflowState = quotationWorkflowState(lead.action_state?.quotations);
  const projectPath = lead.action_state?.projectId
    ? `/projects/${lead.action_state.projectId}`
    : "/projects";
  const className =
    "inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700";
  const buttons = [
    workflowState === "accepted" && canViewProjects ? (
      <Link
        className={className}
        key="project"
        onClick={(event) => event.stopPropagation()}
        to={projectPath}
      >
        Go to Project
      </Link>
    ) : null,
    !hasQuotation && canCreateQuotation ? (
      <Link
        className={className}
        key="quotation"
        onClick={(event) => event.stopPropagation()}
        to={`/quotations?new=1&leadId=${lead.id}`}
      >
        Create Quotation
      </Link>
    ) : null,
    !hasSiteSurvey && canCreateSurvey ? (
      <Link
        className={className}
        key="site-survey"
        onClick={(event) => event.stopPropagation()}
        to={`/site-surveys?new=1&leadId=${lead.id}`}
      >
        Create Site Survey
      </Link>
    ) : null,
  ].filter(Boolean);

  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {workflowState !== "none" && workflowState !== "accepted" ? (
        <LeadQuotationWorkflowPill state={workflowState} />
      ) : buttons.length > 0 ? (
        <div className="flex flex-col gap-2">{buttons}</div>
      ) : (
        <span className="text-right text-sm font-medium text-slate-500">
          {hasSiteSurvey && hasQuotation
            ? "Project ready"
            : "No next step available"}
        </span>
      )}
    </div>
  );
}

function LeadQuotationWorkflowPill({
  state,
}: {
  state: Exclude<QuotationWorkflowState, "none">;
}) {
  const tone = state === "accepted" ? "green" : state === "waiting" ? "amber" : "red";
  return <Badge tone={tone}>{quotationWorkflowPillLabel(state)}</Badge>;
}
