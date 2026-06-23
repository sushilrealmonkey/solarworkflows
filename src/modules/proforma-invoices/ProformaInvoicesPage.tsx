import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
  TextInput,
  Toolbar,
  ViewLink,
} from "../crm/CrmComponents";
import { formatDate, hasPermission, labelize } from "../crm/crmUtils";
import { formatMoney, numberToInput } from "../quotations/quotationUtils";
import type { QuotationItem } from "../quotations/types";
import { InvoiceFormModal } from "../invoices/InvoiceComponents";
import {
  emptyInvoiceForm,
  emptyInvoiceItemForm,
} from "../invoices/invoiceUtils";
import type {
  InvoiceCreationMode,
  InvoiceQuotationSummary,
} from "../invoices/types";
import {
  createProformaInvoice,
  deleteProformaInvoice,
  fetchProformaInvoiceItems,
  fetchProformaInvoiceLinkOptions,
  fetchProformaInvoices,
  fetchQuotationItemsForProformaInvoice,
  updateProformaInvoice,
} from "./proformaInvoiceApi";
import { ProformaInvoiceStatusBadge } from "./ProformaInvoiceComponents";
import {
  proformaInvoiceContextLabel,
  proformaInvoiceItemToForm,
  proformaInvoiceStatusOptions,
  proformaInvoiceToForm,
  validateProformaInvoiceForm,
} from "./proformaInvoiceUtils";
import type {
  ProformaInvoiceFormValues,
  ProformaInvoiceLinkOptions,
  ProformaInvoiceWithRelations,
} from "./types";

type ProformaFilters = {
  search: string;
  status: string;
  date: string;
  dueDate: string;
};

export function ProformaInvoicesPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [proformaInvoices, setProformaInvoices] = useState<
    ProformaInvoiceWithRelations[]
  >([]);
  const [options, setOptions] = useState<ProformaInvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProformaFilters>({
    search: "",
    status: "",
    date: "",
    dueDate: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    proformaInvoice: ProformaInvoiceWithRelations | null;
    values: ProformaInvoiceFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<ProformaInvoiceWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission(profile, permissions, "invoices", "view");
  const canCreate = hasPermission(profile, permissions, "invoices", "create");
  const canUpdate = hasPermission(profile, permissions, "invoices", "update");
  const canDelete = hasPermission(profile, permissions, "invoices", "delete");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextProformaInvoices, nextOptions] = await Promise.all([
        fetchProformaInvoices(profile),
        fetchProformaInvoiceLinkOptions(profile),
      ]);
      setProformaInvoices(nextProformaInvoices);
      setOptions(nextOptions);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load proforma invoices.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over permissions and active user profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  const filteredProformaInvoices = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return proformaInvoices.filter((proformaInvoice) => {
      const matchesSearch =
        !search ||
        [
          proformaInvoice.proforma_code,
          proformaInvoice.customer?.business_name,
          proformaInvoice.customer?.full_name,
          proformaInvoice.customer?.phone,
          proformaInvoice.project?.project_code,
          proformaInvoice.b2b_sale?.sale_code,
          proformaInvoice.final_invoice?.invoice_code,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus =
        !filters.status || proformaInvoice.status === filters.status;
      const matchesDate =
        !filters.date || proformaInvoice.proforma_date === filters.date;
      const matchesDueDate =
        !filters.dueDate || proformaInvoice.due_date === filters.dueDate;

      return matchesSearch && matchesStatus && matchesDate && matchesDueDate;
    });
  }, [proformaInvoices, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="Proforma invoices are not available"
        description="Your role needs invoices:view access to open proforma invoices."
      />
    );
  }

  async function openCreateForm() {
    try {
      const nextOptions = await fetchProformaInvoiceLinkOptions(profile);
      setOptions(nextOptions);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to refresh proforma invoice projects and customers.",
        "error",
      );
    }

    setFormErrors({});
    setFormState({
      mode: "create",
      proformaInvoice: null,
      values: emptyInvoiceForm(null, "manual"),
    });
  }

  async function openEditForm(proformaInvoice: ProformaInvoiceWithRelations) {
    try {
      const proformaItems = await fetchProformaInvoiceItems(
        profile,
        proformaInvoice.id,
      );
      setFormErrors({});
      setFormState({
        mode: "edit",
        proformaInvoice,
        values: {
          ...proformaInvoiceToForm(proformaInvoice),
          items:
            proformaItems.length > 0
              ? proformaItems.map(proformaInvoiceItemToForm)
              : [emptyInvoiceItemForm()],
        },
      });
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load proforma invoice items.",
        "error",
      );
    }
  }

  function handleCreationModeChange(creationMode: InvoiceCreationMode) {
    setFormErrors({});
    setFormState((current) => {
      if (!current || current.mode !== "create") {
        return current;
      }

      return {
        ...current,
        values: {
          ...emptyInvoiceForm(null, creationMode),
          invoice_date: current.values.invoice_date,
          due_date: current.values.due_date,
          notes: current.values.notes,
        },
      };
    });
  }

  async function handleCreateProjectChange(projectId: string) {
    const project = options.projects.find((option) => option.id === projectId);
    const items = project?.quotation_id
      ? await prefillItemsFromQuotation(project.quotation)
      : [emptyInvoiceItemForm()];

    setFormErrors({});
    setFormState((current) => {
      if (!current || current.mode !== "create") {
        return current;
      }

      return {
        ...current,
        values: {
          ...current.values,
          creation_mode: "project",
          project_id: projectId,
          customer_id: project?.customer_id ?? "",
          quotation_id: project?.quotation_id ?? "",
          discount_amount:
            project?.quotation?.discount_amount === null ||
            project?.quotation?.discount_amount === undefined
              ? current.values.discount_amount
              : String(project.quotation.discount_amount),
          items,
        },
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = validateProformaInvoiceForm(formState.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createProformaInvoice(profile, formState.values);
        showToast("Proforma invoice created.", "success");
      } else if (formState.proformaInvoice) {
        await updateProformaInvoice(
          formState.proformaInvoice.id,
          formState.values,
          {
            deleteMissingItems: canDelete,
          },
        );
        showToast("Proforma invoice updated.", "success");
      }

      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice save failed.",
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
      await deleteProformaInvoice(deleteTarget.id);
      setProformaInvoices((current) =>
        current.filter((proformaInvoice) => proformaInvoice.id !== deleteTarget.id),
      );
      showToast("Proforma invoice deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function prefillItemsFromQuotation(
    quotation: InvoiceQuotationSummary | null | undefined,
  ) {
    if (!quotation) {
      return [emptyInvoiceItemForm()];
    }

    const quotationItems = await fetchQuotationItemsForProformaInvoice(
      profile,
      quotation.id,
    );
    if (quotationItems.length > 0) {
      return quotationItems.map(quotationItemToProformaItem);
    }

    const gstPercent =
      Number(quotation.base_amount ?? 0) > 0
        ? (Number(quotation.gst_amount ?? 0) / Number(quotation.base_amount ?? 1)) *
          100
        : 0;

    return [
      {
        inventory_item_id: "",
        item_name: "Solar project proforma invoice",
        description: quotation.quotation_code ?? "",
        quantity: "1",
        unit: "project",
        unit_price: numberToInput(quotation.base_amount ?? quotation.total_amount),
        gst_percent: numberToInput(gstPercent),
      },
    ];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Proforma Invoices"
          description="Create payment requests before issuing final invoices."
        />
        {canCreate ? (
          <Button onClick={() => void openCreateForm()}>Create Proforma</Button>
        ) : null}
      </div>

      <Toolbar className="md:grid-cols-3">
        <SearchInput
          className="md:col-span-3"
          placeholder="Search PI, customer, phone, project, B2B sale, or invoice"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...proformaInvoiceStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <TextInput
          label="PI Date"
          type="date"
          value={filters.date}
          onChange={(date) => setFilters((current) => ({ ...current, date }))}
        />
        <TextInput
          label="Due Date"
          type="date"
          value={filters.dueDate}
          onChange={(dueDate) =>
            setFilters((current) => ({ ...current, dueDate }))
          }
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load proforma invoices" description={error} /> : null}
      {!loading && !error && filteredProformaInvoices.length === 0 ? (
        <EmptyState
          title="No proforma invoices found"
          description="Create a proforma invoice before collecting payment and issuing the final invoice."
          action={
            canCreate ? (
              <Button onClick={() => void openCreateForm()}>Create Proforma</Button>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredProformaInvoices.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm 2xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Proforma</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">PI Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredProformaInvoices.map((proformaInvoice) => (
                  <tr key={proformaInvoice.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {proformaInvoice.proforma_code ?? "Proforma Invoice"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {proformaInvoice.customer?.business_name ||
                          proformaInvoice.customer?.full_name ||
                          "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {proformaInvoice.customer?.phone ?? "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {proformaInvoiceContextLabel(proformaInvoice)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(proformaInvoice.proforma_date)}
                    </td>
                    <td className="px-4 py-3">{formatDate(proformaInvoice.due_date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(proformaInvoice.total_amount)}
                    </td>
                    <td className="px-4 py-3">
                      {formatMoney(proformaInvoice.amount_paid)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(proformaInvoice.balance_due)}
                    </td>
                    <td className="px-4 py-3">
                      <ProformaInvoiceStatusBadge value={proformaInvoice.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ViewLink to={`/proforma-invoices/${proformaInvoice.id}`}>
                          View
                        </ViewLink>
                        {canUpdate && !["converted", "cancelled"].includes(proformaInvoice.status ?? "") ? (
                          <Button
                            onClick={() => void openEditForm(proformaInvoice)}
                            variant="secondary"
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            onClick={() => setDeleteTarget(proformaInvoice)}
                            variant="danger"
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 2xl:hidden">
            {filteredProformaInvoices.map((proformaInvoice) => (
              <article
                key={proformaInvoice.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(proformaInvoice.proforma_date)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {proformaInvoice.proforma_code ?? "Proforma Invoice"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {proformaInvoice.customer?.business_name ||
                        proformaInvoice.customer?.full_name ||
                        "-"} / {proformaInvoiceContextLabel(proformaInvoice)}
                    </p>
                  </div>
                  <ProformaInvoiceStatusBadge value={proformaInvoice.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <CardItem label="Total" value={formatMoney(proformaInvoice.total_amount)} />
                  <CardItem label="Paid" value={formatMoney(proformaInvoice.amount_paid)} />
                  <CardItem label="Balance" value={formatMoney(proformaInvoice.balance_due)} />
                  <CardItem label="Due" value={formatDate(proformaInvoice.due_date)} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ViewLink to={`/proforma-invoices/${proformaInvoice.id}`}>
                    View
                  </ViewLink>
                  {canUpdate && !["converted", "cancelled"].includes(proformaInvoice.status ?? "") ? (
                    <Button
                      onClick={() => void openEditForm(proformaInvoice)}
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      onClick={() => setDeleteTarget(proformaInvoice)}
                      variant="danger"
                    >
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
        <InvoiceFormModal
          title={
            formState.mode === "create"
              ? "Create Proforma Invoice"
              : "Edit Proforma Invoice"
          }
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          options={options}
          includeItems
          canAddItems={formState.mode === "create" || (canCreate && canUpdate)}
          canRemoveItems={formState.mode === "create" || (canDelete && canUpdate)}
          creationMode={formState.values.creation_mode}
          onCreationModeChange={
            formState.mode === "create" ? handleCreationModeChange : undefined
          }
          onProjectChange={
            formState.mode === "create"
              ? (projectId) => void handleCreateProjectChange(projectId)
              : undefined
          }
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete proforma invoice?"
          description={`This will remove ${deleteTarget.proforma_code ?? "this proforma invoice"} and its itemized bill.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function quotationItemToProformaItem(item: QuotationItem) {
  return {
    inventory_item_id: "",
    item_name: item.item_name ?? "",
    description: item.description ?? "",
    quantity: numberToInput(item.quantity) || "1",
    unit: item.unit ?? "",
    unit_price: numberToInput(item.unit_price),
    gst_percent: numberToInput(item.gst_percent) || "0",
  };
}

function CardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
