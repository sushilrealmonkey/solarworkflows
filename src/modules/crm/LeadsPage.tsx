import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  convertLeadToCustomer,
  createLead,
  deleteLead,
  fetchOrganizationFollowups,
  fetchLeads,
  fetchStaffOptions,
  updateLead,
} from "./crmApi";
import {
  emptyLeadForm,
  formatDate,
  getLeadFollowupState,
  hasPermission,
  labelize,
  leadPriorityOptions,
  leadPropertyTypeOptions,
  leadRequirementTypeOptions,
  leadRoofTypeOptions,
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
  Button,
  ConfirmDialog,
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
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [conversionLink, setConversionLink] = useState<string | null>(null);
  const [openActionLeadId, setOpenActionLeadId] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "leads", "view");
  const canCreate = hasPermission(profile, permissions, "leads", "create");
  const canUpdate = hasPermission(profile, permissions, "leads", "update");
  const canDelete = hasPermission(profile, permissions, "leads", "delete");
  const canCreateCustomer = hasPermission(profile, permissions, "customers", "create");
  const canConvert = canUpdate && canCreateCustomer;

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextLeads, nextStaff, nextFollowups] = await Promise.all([
        fetchLeads(profile),
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
  }, [canView, profile?.id]);

  const filteredLeads = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesSearch =
        !search ||
        [lead.full_name, lead.phone, lead.lead_code]
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

  if (!canView) {
    return (
      <AccessDenied
        title="Leads are not available"
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
        showToast("Lead created.", "success");
      } else if (formState.lead) {
        const updatedLead = await updateLead(formState.lead.id, formState.values);
        setLeads((current) =>
          current.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead)),
        );
        showToast("Lead updated.", "success");
      }
      setFormState(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead save failed.",
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
      await deleteLead(deleteTarget.id);
      setLeads((current) => current.filter((lead) => lead.id !== deleteTarget.id));
      showToast("Lead deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleConvert(lead: Lead) {
    if (lead.converted_customer_id) {
      setConversionLink(`/customers/${lead.converted_customer_id}`);
      setLeads((current) => current.filter((item) => item.id !== lead.id));
      showToast("Lead is already converted.", "info");
      return;
    }

    if (lead.status === "converted") {
      showToast("Lead is marked converted but has no customer link.", "error");
      return;
    }

    try {
      setConvertingId(lead.id);
      const customer = await convertLeadToCustomer(lead.id);
      setConversionLink(`/customers/${customer.id}`);
      setLeads((current) => current.filter((item) => item.id !== lead.id));
      showToast("Lead converted to customer.", "success");
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Lead conversion failed.",
        "error",
      );
    } finally {
      setConvertingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Leads"
          description="Capture solar enquiries, track status, assign staff, and convert qualified leads into customer profiles."
        />
        {canCreate ? <Button onClick={openCreateForm}>Add Lead</Button> : null}
      </div>

      {conversionLink ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-[#06173f] sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium">Customer profile is ready.</span>
          <Link
            className="inline-flex rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-700"
            to={conversionLink}
          >
            Open Customer
          </Link>
        </div>
      ) : null}

      <Toolbar className="md:grid-cols-4">
        <SearchInput
          className="md:col-span-4"
          placeholder="Search name, phone, or lead code"
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
      {error ? <EmptyState title="Could not load leads" description={error} /> : null}
      {!loading && !error && filteredLeads.length === 0 ? (
        <EmptyState
          title="No leads found"
          description="Add a lead to start tracking enquiries and follow-up status."
          action={canCreate ? <Button onClick={openCreateForm}>Add Lead</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredLeads.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">Requirement</th>
                  <th className="px-4 py-3">Load</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="w-12 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                    onClick={() => openLeadDetail(lead.id)}
                    onKeyDown={(event) => handleLeadRowKeyDown(event, lead.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {lead.lead_code ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#06173f]">
                      {lead.full_name}
                    </td>
                    <td className="px-4 py-3">{lead.phone}</td>
                    <td className="px-4 py-3">{lead.city ?? "-"}</td>
                    <td className="px-4 py-3">{labelize(lead.requirement_type)}</td>
                    <td className="px-4 py-3">
                      {lead.estimated_load_kw ? `${lead.estimated_load_kw} kW` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={lead.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={lead.priority} />
                    </td>
                    <td className="px-4 py-3">{staffName(staff, lead.assigned_to)}</td>
                    <td className="px-4 py-3">{formatDate(lead.created_at)}</td>
                    <td
                      className="relative px-4 py-3 text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        aria-label={`Actions for ${lead.full_name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-lg font-semibold leading-none text-slate-600 shadow-sm hover:bg-stone-50"
                        onClick={() =>
                          setOpenActionLeadId((current) =>
                            current === lead.id ? null : lead.id,
                          )
                        }
                        type="button"
                      >
                        &#8942;
                      </button>
                      {openActionLeadId === lead.id ? (
                        <div className="absolute right-4 z-30 mt-2 w-36 rounded-lg border border-stone-200 bg-white p-1 text-left shadow-lg">
                          <Link
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                            onClick={() => setOpenActionLeadId(null)}
                            to={`/leads/${lead.id}`}
                          >
                            View
                          </Link>
                          {canUpdate ? (
                            <button
                              className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                              onClick={() => {
                                setOpenActionLeadId(null);
                                openEditForm(lead);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                          ) : null}
                          {canConvert ? (
                            <button
                              className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={convertingId === lead.id}
                              onClick={() => {
                                setOpenActionLeadId(null);
                                void handleConvert(lead);
                              }}
                              type="button"
                            >
                              {convertingId === lead.id ? "Converting..." : "Convert"}
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                              onClick={() => {
                                setOpenActionLeadId(null);
                                setDeleteTarget(lead);
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {filteredLeads.map((lead) => (
              <article
                key={lead.id}
                className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                onClick={() => openLeadDetail(lead.id)}
                onKeyDown={(event) => handleLeadRowKeyDown(event, lead.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {lead.lead_code ?? "Lead"}
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
                    <dt className="text-xs text-slate-500">City</dt>
                    <dd className="font-medium text-slate-900">{lead.city ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Requirement</dt>
                    <dd className="font-medium text-slate-900">
                      {labelize(lead.requirement_type)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Load</dt>
                    <dd className="font-medium text-slate-900">
                      {lead.estimated_load_kw ? `${lead.estimated_load_kw} kW` : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Assigned</dt>
                    <dd className="font-medium text-slate-900">
                      {staffName(staff, lead.assigned_to)}
                    </dd>
                  </div>
                </dl>
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
                  {canConvert ? (
                    <Button
                      onClick={() => handleConvert(lead)}
                      disabled={convertingId === lead.id}
                      variant="secondary"
                    >
                      {convertingId === lead.id ? "Converting..." : "Convert"}
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button onClick={() => setDeleteTarget(lead)} variant="danger">
                      Delete
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {formState ? (
        <LeadFormModal
          title={formState.mode === "create" ? "Add Lead" : "Edit Lead"}
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

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete lead?"
          description={`This will remove ${deleteTarget.full_name} from the lead pipeline.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
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
      submitLabel="Save Lead"
      submitting={saving}
    >
      <TextInput label="Full Name" value={values.full_name} onChange={(value) => update("full_name", value)} error={errors.full_name} required />
      <TextInput label="Phone" value={values.phone} onChange={(value) => update("phone", value)} error={errors.phone} required />
      <TextInput label="Alternate Phone" value={values.alternate_phone} onChange={(value) => update("alternate_phone", value)} />
      <TextInput label="Email" value={values.email} onChange={(value) => update("email", value)} type="email" />
      <TextInput label="Address" value={values.address} onChange={(value) => update("address", value)} />
      <TextInput label="City" value={values.city} onChange={(value) => update("city", value)} />
      <TextInput label="District" value={values.district} onChange={(value) => update("district", value)} />
      <TextInput label="State" value={values.state} onChange={(value) => update("state", value)} />
      <TextInput label="Pincode" value={values.pincode} onChange={(value) => update("pincode", value)} />
      <TextInput label="Lead Source" value={values.lead_source} onChange={(value) => update("lead_source", value)} />
      <SelectInput
        label="Requirement Type"
        value={values.requirement_type}
        onChange={(value) => update("requirement_type", value)}
        options={[
          { value: "", label: "Select requirement type" },
          ...leadRequirementTypeOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <TextInput label="Estimated Load (kW)" value={values.estimated_load_kw} onChange={(value) => update("estimated_load_kw", value)} type="number" />
      <TextInput label="Electricity Bill Amount" value={values.electricity_bill_amount} onChange={(value) => update("electricity_bill_amount", value)} type="number" />
      <TextInput label="Offered Price" value={values.offered_price} onChange={(value) => update("offered_price", value)} type="number" />
      <SelectInput
        label="Property Type"
        value={values.property_type}
        onChange={(value) => update("property_type", value)}
        options={[
          { value: "", label: "Select property type" },
          ...leadPropertyTypeOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <SelectInput
        label="Roof Type"
        value={values.roof_type}
        onChange={(value) => update("roof_type", value)}
        options={[
          { value: "", label: "Select roof type" },
          ...leadRoofTypeOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <SelectInput label="Status" value={values.status} onChange={(value) => update("status", value)} options={leadStatusOptions.map((value) => ({ value, label: labelize(value) }))} />
      <SelectInput label="Priority" value={values.priority} onChange={(value) => update("priority", value)} options={leadPriorityOptions.map((value) => ({ value, label: labelize(value) }))} />
      <StaffSelect staff={staff} value={values.assigned_to} onChange={(value) => update("assigned_to", value)} />
      <TextArea label="Notes" value={values.notes} onChange={(value) => update("notes", value)} />
    </Modal>
  );
}
