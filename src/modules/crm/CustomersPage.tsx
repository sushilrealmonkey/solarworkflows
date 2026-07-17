import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  convertLeadToCustomer,
  createCustomer,
  fetchCustomers,
  fetchLeads,
  fetchProjectIdsForCustomers,
  fetchStaffOptions,
  updateCustomer,
} from "./crmApi";
import {
  customerStatusOptions,
  customerSegmentLabel,
  customerToForm,
  customerTypeOptionsForSegment,
  emptyCustomerForm,
  emptyCustomerFormForSegment,
  formatDate,
  hasPermission,
  labelize,
  normalizeCustomerSubmitValues,
  requiredError,
  staffName,
} from "./crmUtils";
import type {
  Customer,
  CustomerFormValues,
  CustomerSegment,
  Lead,
  StaffOption,
} from "./types";
import {
  AccessDenied,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  NextStepLabel,
  PlaceholderAction,
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

type CustomerFilters = {
  search: string;
  status: string;
  customerType: string;
};

export function CustomersPage({ segment }: { segment: CustomerSegment }) {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [projectIdsByCustomer, setProjectIdsByCustomer] = useState<
    Map<string, string>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CustomerFilters>({
    search: "",
    status: "",
    customerType: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    source: "direct" | "lead";
    customer: Customer | null;
    leadId: string;
    values: CustomerFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "customers", "view");
  const canCreate = hasPermission(profile, permissions, "customers", "create");
  const canUpdate = hasPermission(profile, permissions, "customers", "update");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateB2BSale = hasPermission(profile, permissions, "b2b_sales", "create");
  const canCreateDirectly = segment === "b2b_direct" && canCreate;

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextCustomers, nextLeads, nextStaff] = await Promise.all([
        fetchCustomers(profile, { segment, archiveScope }),
        fetchLeads(profile).catch(() => []),
        fetchStaffOptions(profile),
      ]);
      const nextProjectIdsByCustomer = canViewProjects
        ? await fetchProjectIdsForCustomers(
            profile,
            nextCustomers.map((customer) => customer.id),
          )
        : new Map<string, string>();
      setCustomers(nextCustomers);
      setLeads(nextLeads);
      setStaff(nextStaff);
      setProjectIdsByCustomer(nextProjectIdsByCustomer);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load customers.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over the current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveScope, canView, canViewProjects, profile?.id, segment]);

  const filteredCustomers = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return customers.filter((customer) => {
      const matchesSearch =
        !search ||
        [
          customer.full_name,
          customer.business_name,
          customer.phone,
          customer.gst_number,
          customer.customer_code,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus =
        !filters.status || customer.status === filters.status;
      const matchesType =
        !filters.customerType ||
        customer.customer_type === filters.customerType;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [customers, filters]);

  const customerPagination = useTablePagination(filteredCustomers);
  const paginatedCustomers = customerPagination.pageItems;

  if (!canView) {
    return (
      <AccessDenied
        title="Customers are not available"
        description="Your role needs customers:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      source: "direct",
      customer: null,
      leadId: "",
      values: emptyCustomerFormForSegment(segment),
    });
  }

  function openEditForm(customer: Customer) {
    setFormErrors({});
    setFormState({
      mode: "edit",
      source: "direct",
      customer,
      leadId: "",
      values: customerToForm(customer),
    });
  }

  function openCustomerDetail(customerId: string) {
    navigate(`/customers/${customerId}`);
  }

  function handleCustomerRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    customerId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCustomerDetail(customerId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = {
      lead_id:
        formState.mode === "create" && formState.source === "lead"
          ? requiredError(formState.leadId, "Lead")
          : "",
      full_name:
        segment === "project_based"
          ? requiredError(formState.values.full_name, "Full name")
          : "",
      business_name:
        segment === "b2b_direct"
          ? requiredError(formState.values.business_name, "Business name")
          : "",
      contact_person_name:
        segment === "b2b_direct"
          ? requiredError(formState.values.contact_person_name, "Contact person")
          : "",
      phone: requiredError(formState.values.phone, "Phone"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      const submitValues = normalizeCustomerSubmitValues(
        formState.values,
        segment,
      );

      if (formState.mode === "create") {
        const createdCustomer =
          formState.source === "lead"
            ? await updateCustomer(
                (await convertLeadToCustomer(formState.leadId)).id,
                submitValues,
              )
            : await createCustomer(profile, submitValues);
        setCustomers((current) => [createdCustomer, ...current]);
        if (formState.source === "lead") {
          setLeads((current) =>
            current.filter((lead) => lead.id !== formState.leadId),
          );
        }
        showToast("Customer created.", "success");
      } else if (formState.customer) {
        const updatedCustomer = await updateCustomer(
          formState.customer.id,
          submitValues,
        );
        setCustomers((current) =>
          current.map((customer) =>
            customer.id === updatedCustomer.id ? updatedCustomer : customer,
          ),
        );
        showToast("Customer updated.", "success");
      }
      setFormState(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Customer save failed.",
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
          title={
            segment === "b2b_direct"
              ? "Business Customers"
              : "Customers"
          }
          description={
            segment === "b2b_direct"
              ? "Manage installers, retailers, and direct product-sale customers."
              : "Review customers created from the enquiry workflow for surveys, quotations, and projects."
          }
        />
        {canCreateDirectly ? <Button onClick={openCreateForm}>Add Business Customer</Button> : null}
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

      <Toolbar>
        <SearchInput
          placeholder="Search name, business, phone, GST, or code"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...customerStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Customer Subtype"
          value={filters.customerType}
          onChange={(customerType) =>
            setFilters((current) => ({ ...current, customerType }))
          }
          options={[
            { value: "", label: "All types" },
            ...customerTypeOptionsForSegment(segment).map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load customers" description={error} />
      ) : null}
      {!loading && !error && filteredCustomers.length === 0 ? (
        <EmptyState
          title="No customers found"
          description={
            segment === "b2b_direct"
              ? "Create a business customer before recording product sales without projects."
              : "Customers will appear here after an enquiry is converted in the enquiry workflow."
          }
          action={
            canCreateDirectly ? (
              <Button onClick={openCreateForm}>Add Business Customer</Button>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredCustomers.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">City</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedCustomers.map((customer) => (
                  <tr
                    key={customer.id}
                    className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName(segment === "b2b_direct" ? "b2bFlow" : "projectFlow")}`}
                    onClick={() => openCustomerDetail(customer.id)}
                    onKeyDown={(event) =>
                      handleCustomerRowKeyDown(event, customer.id)
                    }
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {customer.customer_code ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {customerName(customer, segment)}
                    </td>
                    <td className="px-4 py-3">{customer.phone}</td>
                    <td className="px-4 py-3">{customer.city ?? "-"}</td>
                    <td className="px-4 py-3">{labelize(customer.customer_type)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={customer.status} />
                    </td>
                    <td className="px-4 py-3">
                      {staffName(staff, customer.assigned_to)}
                    </td>
                    <td className="px-4 py-3">{formatDate(customer.created_at)}</td>
                    <td
                      className="px-4 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <CustomerNextStepActions
                        customer={customer}
                        projectId={projectIdsByCustomer.get(customer.id) ?? null}
                        canViewProjects={canViewProjects}
                        canCreateB2BSale={canCreateB2BSale}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {paginatedCustomers.map((customer) => (
              <article
                key={customer.id}
                className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName(segment === "b2b_direct" ? "b2bFlow" : "projectFlow")}`}
                onClick={() => openCustomerDetail(customer.id)}
                onKeyDown={(event) =>
                  handleCustomerRowKeyDown(event, customer.id)
                }
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {customer.customer_code ?? customerSegmentLabel(segment)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {customerName(customer, segment)}
                    </h2>
                  </div>
                  <StatusBadge value={customer.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Phone</dt>
                    <dd className="font-medium text-slate-900">{customer.phone}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">City</dt>
                    <dd className="font-medium text-slate-900">
                      {customer.city ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Type</dt>
                    <dd className="font-medium text-slate-900">
                      {labelize(customer.customer_type)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Assigned</dt>
                    <dd className="font-medium text-slate-900">
                      {staffName(staff, customer.assigned_to)}
                    </dd>
                  </div>
                </dl>
                <div
                  className="mt-4 space-y-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <NextStepLabel />
                  <CustomerNextStepActions
                    customer={customer}
                    projectId={projectIdsByCustomer.get(customer.id) ?? null}
                    canViewProjects={canViewProjects}
                    canCreateB2BSale={canCreateB2BSale}
                  />
                </div>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <ViewLink to={`/customers/${customer.id}`}>View</ViewLink>
                  {canUpdate ? (
                    <Button onClick={() => openEditForm(customer)} variant="secondary">
                      Edit
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <TablePagination label="customers" pagination={customerPagination} />
        </>
      ) : null}

      {formState ? (
        <CustomerFormModal
          title={formState.mode === "create" ? "Add Customer" : "Edit Customer"}
          segment={segment}
          source={formState.source}
          leadId={formState.leadId}
          leads={leads}
          values={formState.values}
          setLeadId={(leadId) =>
            setFormState((current) =>
              current
                ? {
                    ...current,
                    leadId,
                    values: leadToCustomerForm(
                      leads.find((lead) => lead.id === leadId),
                      current.values,
                    ),
                  }
                : current,
            )
          }
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

export function CustomerFormModal({
  title,
  segment,
  source,
  leadId,
  leads,
  values,
  setLeadId,
  setValues,
  errors,
  staff,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  segment: CustomerSegment;
  source: "direct" | "lead";
  leadId: string;
  leads: Lead[];
  values: CustomerFormValues;
  setLeadId: (leadId: string) => void;
  setValues: (values: CustomerFormValues) => void;
  errors: Record<string, string>;
  staff: StaffOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof CustomerFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Customer"
      submitting={saving}
    >
      {source === "lead" ? (
        <div className="md:col-span-2">
          <SelectInput
            label="Lead"
            value={leadId}
            onChange={setLeadId}
            options={[
              { value: "", label: "Select lead" },
              ...leads.map((lead) => ({
                value: lead.id,
                label: leadOptionLabel(lead),
              })),
            ]}
          />
          {errors.lead_id ? (
            <p className="-mt-3 text-xs text-rose-700">{errors.lead_id}</p>
          ) : null}
        </div>
      ) : null}
      {segment === "project_based" ? (
        <TextInput
          label="Full Name"
          value={values.full_name}
          onChange={(value) => update("full_name", value)}
          error={errors.full_name}
          required
        />
      ) : null}
      {segment === "b2b_direct" ? (
        <>
          <TextInput
            label="Business Name"
            value={values.business_name}
            onChange={(value) => update("business_name", value)}
            error={errors.business_name}
            required
          />
          <TextInput
            label="GST Number"
            value={values.gst_number}
            onChange={(value) => update("gst_number", value)}
          />
          <TextInput
            label="Contact Person"
            value={values.contact_person_name}
            onChange={(value) => update("contact_person_name", value)}
            error={errors.contact_person_name}
            required
          />
        </>
      ) : null}
      <TextInput
        label="Phone"
        value={values.phone}
        onChange={(value) => update("phone", value)}
        error={errors.phone}
        required
      />
      <TextInput
        label="Alternate Phone"
        value={values.alternate_phone}
        onChange={(value) => update("alternate_phone", value)}
      />
      <TextInput
        label="Email"
        value={values.email}
        onChange={(value) => update("email", value)}
        type="email"
      />
      <TextInput
        label="Address Line 1"
        value={values.address_line_1}
        onChange={(value) => update("address_line_1", value)}
      />
      <TextInput
        label="Address Line 2"
        value={values.address_line_2}
        onChange={(value) => update("address_line_2", value)}
      />
      <TextInput label="City" value={values.city} onChange={(value) => update("city", value)} />
      <TextInput
        label="District"
        value={values.district}
        onChange={(value) => update("district", value)}
      />
      <TextInput label="State" value={values.state} onChange={(value) => update("state", value)} />
      <TextInput
        label="Pincode"
        value={values.pincode}
        onChange={(value) => update("pincode", value)}
      />
      {segment === "project_based" ? (
        <SelectInput
          label="Customer Subtype"
          value={values.customer_type}
          onChange={(value) => update("customer_type", value)}
          options={customerTypeOptionsForSegment(segment).map((value) => ({ value, label: labelize(value) }))}
        />
      ) : null}
      {segment === "project_based" ? (
        <TextInput
          label="Lead Source"
          value={values.lead_source}
          onChange={(value) => update("lead_source", value)}
        />
      ) : null}
      {segment === "project_based" ? (
        <SelectInput
          label="Status"
          value={values.status}
          onChange={(value) => update("status", value)}
          options={customerStatusOptions.map((value) => ({ value, label: labelize(value) }))}
        />
      ) : null}
      {segment === "project_based" ? (
        <StaffSelect
          staff={staff}
          value={values.assigned_to}
          onChange={(value) => update("assigned_to", value)}
        />
      ) : null}
      <TextArea label="Notes" value={values.notes} onChange={(value) => update("notes", value)} />
    </Modal>
  );
}

function leadToCustomerForm(
  lead: Lead | undefined,
  currentValues: CustomerFormValues,
): CustomerFormValues {
  if (!lead) {
    return emptyCustomerForm();
  }

  return {
    ...currentValues,
      full_name: lead.full_name ?? "",
      customer_segment: "project_based",
      business_name: currentValues.business_name,
      gst_number: currentValues.gst_number,
      contact_person_name: currentValues.contact_person_name,
      phone: lead.phone ?? "",
    alternate_phone: lead.alternate_phone ?? "",
    email: lead.email ?? "",
    address_line_1: lead.address ?? "",
    address_line_2: currentValues.address_line_2,
    city: lead.city ?? "",
    district: lead.district ?? "",
    state: lead.state ?? "",
    pincode: lead.pincode ?? "",
    customer_type:
      customerTypeFromLead(lead) || currentValues.customer_type || "residential",
    lead_source: lead.lead_source ?? "",
    status: "active",
    assigned_to: lead.assigned_to ?? "",
    notes: "",
  };
}

function customerName(customer: Customer, segment: CustomerSegment) {
  if (segment === "b2b_direct") {
    return customer.business_name || customer.full_name;
  }

  return customer.full_name;
}

function CustomerNextStepActions({
  customer,
  projectId,
  canViewProjects,
  canCreateB2BSale,
}: {
  customer: Customer;
  projectId: string | null;
  canViewProjects: boolean;
  canCreateB2BSale: boolean;
}) {
  const actionClass =
    "inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 lg:w-auto";

  if (customer.customer_segment === "b2b_direct") {
    return canCreateB2BSale ? (
      <Link
        className={actionClass}
        onClick={(event) => event.stopPropagation()}
        to={`/b2b-sales?customerId=${customer.id}&new=1`}
      >
        Create Sale
      </Link>
    ) : (
      <PlaceholderAction>Create Sale</PlaceholderAction>
    );
  }

  if (projectId && canViewProjects) {
    return (
      <Link
        className={actionClass}
        onClick={(event) => event.stopPropagation()}
        to={`/projects/${projectId}`}
      >
        Go to Project
      </Link>
    );
  }

  return <PlaceholderAction>Go to Project</PlaceholderAction>;
}


function customerTypeFromLead(lead: Lead) {
  const text = `${lead.requirement_type ?? ""} ${lead.property_type ?? ""}`.toLowerCase();

  if (text.includes("industrial") || text.includes("factory")) {
    return "industrial";
  }

  if (text.includes("government")) {
    return "government";
  }

  if (
    text.includes("commercial") ||
    text.includes("shop") ||
    text.includes("office") ||
    text.includes("school") ||
    text.includes("hospital") ||
    text.includes("warehouse")
  ) {
    return "commercial";
  }

  if (
    text.includes("residential") ||
    text.includes("house") ||
    text.includes("home") ||
    text.includes("apartment")
  ) {
    return "residential";
  }

  return "";
}

function leadOptionLabel(lead: Lead) {
  return `${lead.lead_code ?? "Lead"} - ${lead.full_name} (${lead.phone})`;
}
