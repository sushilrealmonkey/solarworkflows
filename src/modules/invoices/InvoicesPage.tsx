import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
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
import {
  createInvoice,
  deleteInvoice,
  fetchInvoiceItems,
  fetchInvoiceLinkOptions,
  fetchInvoices,
  fetchQuotationItemsForInvoice,
  updateInvoice,
} from "./invoiceApi";
import { InvoiceFormModal, InvoiceStatusBadge } from "./InvoiceComponents";
import {
  emptyInvoiceForm,
  emptyInvoiceItemForm,
  invoiceContextLabel,
  invoiceItemToForm,
  inventoryItemToInvoiceItemForm,
  isActiveInvoice,
  invoiceStatusOptions,
  invoiceToForm,
  validateInvoiceForm,
} from "./invoiceUtils";
import type {
  InvoiceCreationMode,
  InvoiceFormValues,
  InvoiceLinkOptions,
  InvoiceProjectOption,
  InvoiceQuotationSummary,
  InvoiceWithRelations,
} from "./types";

type InvoiceFilters = {
  search: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
};

type InvoiceItemPrefill = {
  inventoryItemId?: string;
  quantity?: string;
};

export function InvoicesPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [options, setOptions] = useState<InvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<InvoiceFilters>({
    search: "",
    status: "",
    invoiceDate: "",
    dueDate: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    invoice: InvoiceWithRelations | null;
    values: InvoiceFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceWithRelations | null>(
    null,
  );
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
      const [nextInvoices, nextOptions] = await Promise.all([
        fetchInvoices(profile),
        fetchInvoiceLinkOptions(profile),
      ]);
      setInvoices(nextInvoices);
      setOptions(nextOptions);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load invoices.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over invoice permissions and the active user profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  useEffect(() => {
    const projectId = searchParams.get("projectId");
    if (!projectId || loading || !canCreate || formState) {
      return;
    }

    const project = options.projects.find((option) => option.id === projectId);
    if (!project) {
      return;
    }

    void openCreateForm(project, {
      inventoryItemId: searchParams.get("inventoryItemId") ?? undefined,
      quantity: searchParams.get("quantity") ?? undefined,
    });
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, canCreate, options.projects.length]);

  const filteredInvoices = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return invoices.filter((invoice) => {
      const matchesSearch =
        !search ||
        [
          invoice.invoice_code,
          invoice.customer?.business_name,
          invoice.customer?.full_name,
          invoice.customer?.phone,
          invoice.customer?.alternate_phone,
          invoice.project?.project_code,
          invoice.b2b_sale?.sale_code,
          invoice.proforma_invoice?.proforma_code,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || invoice.status === filters.status;
      const matchesInvoiceDate =
        !filters.invoiceDate || invoice.invoice_date === filters.invoiceDate;
      const matchesDueDate = !filters.dueDate || invoice.due_date === filters.dueDate;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesInvoiceDate &&
        matchesDueDate
      );
    });
  }, [invoices, filters]);

  const duplicateProjectInvoice = useMemo(() => {
    if (formState?.mode !== "create" || !formState.values.project_id) {
      return null;
    }

    return (
      invoices.find(
        (invoice) =>
          invoice.project_id === formState.values.project_id &&
          isActiveInvoice(invoice),
      ) ?? null
    );
  }, [formState, invoices]);

  if (!canView) {
    return (
      <AccessDenied
        title="Tax invoices are not available"
        description="Your role needs invoices:view access to open this module."
      />
    );
  }

  async function openCreateForm(
    project?: InvoiceProjectOption,
    itemPrefill?: InvoiceItemPrefill,
  ) {
    let currentProject = project;
    let currentOptions = options;

    try {
      const nextOptions = await fetchInvoiceLinkOptions(profile);
      setOptions(nextOptions);
      currentOptions = nextOptions;
      currentProject = project
        ? nextOptions.projects.find((option) => option.id === project.id) ?? project
        : undefined;
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to refresh invoice projects and customers.",
        "error",
      );
    }

    const values = emptyInvoiceForm(currentProject, "project");
    const prefilledInventoryItem = prefillItemFromInventory(
      currentOptions,
      itemPrefill,
    );

    if (prefilledInventoryItem) {
      values.items = [prefilledInventoryItem];
    } else if (currentProject?.quotation_id) {
      values.items = await prefillItemsFromQuotation(currentProject.quotation);
    }

    setFormErrors({});
    setFormState({
      mode: "create",
      invoice: null,
      values,
    });
  }

  async function openEditForm(invoice: InvoiceWithRelations) {
    try {
      const invoiceItems = await fetchInvoiceItems(profile, invoice.id);
      setFormErrors({});
      setFormState({
        mode: "edit",
        invoice,
        values: {
          ...invoiceToForm(invoice),
          items:
            invoiceItems.length > 0
              ? invoiceItems.map(invoiceItemToForm)
              : [emptyInvoiceItemForm()],
        },
      });
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load invoice items.",
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

    const includeItems = true;
    const nextErrors = validateInvoiceForm(formState.values, {
      includeItems,
      requireProject:
        formState.mode === "create" &&
        formState.values.creation_mode === "project",
    });
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createInvoice(profile, formState.values);
        showToast("Invoice created.", "success");
      } else if (formState.invoice) {
        await updateInvoice(formState.invoice.id, formState.values, {
          includeItems: true,
          deleteMissingItems: canDelete,
        });
        showToast("Invoice updated.", "success");
      }

      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Invoice save failed.",
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
      await deleteInvoice(deleteTarget.id);
      setInvoices((current) =>
        current.filter((invoice) => invoice.id !== deleteTarget.id),
      );
      showToast("Invoice deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Invoice delete failed.",
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

    const quotationItems = await fetchQuotationItemsForInvoice(profile, quotation.id);
    if (quotationItems.length > 0) {
      return quotationItems.map(quotationItemToInvoiceItem);
    }

    const gstPercent =
      Number(quotation.base_amount ?? 0) > 0
        ? (Number(quotation.gst_amount ?? 0) / Number(quotation.base_amount ?? 1)) *
          100
        : 0;

    return [
      {
        inventory_item_id: "",
        item_name: "Solar project invoice",
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
          title="Tax Invoices"
          description="Create project-first tax invoices, with manual item tax invoices available for customer-only billing."
        />
        {canCreate ? (
          <Button onClick={() => void openCreateForm()}>
            Create Project Invoice
          </Button>
        ) : null}
      </div>

      <Toolbar className="md:grid-cols-3">
        <SearchInput
          className="md:col-span-3"
          placeholder="Search invoice, customer, phone, or project"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...invoiceStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <TextInput
          label="Invoice Date"
          type="date"
          value={filters.invoiceDate}
          onChange={(invoiceDate) =>
            setFilters((current) => ({ ...current, invoiceDate }))
          }
        />
        <TextInput
          label="Due Date"
          type="date"
          value={filters.dueDate}
          onChange={(dueDate) => setFilters((current) => ({ ...current, dueDate }))}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load tax invoices" description={error} /> : null}
      {!loading && !error && filteredInvoices.length === 0 ? (
        <EmptyState
          title="No tax invoices found"
          description="Create a project tax invoice first, or use a manual item tax invoice for customer-only billing."
          action={
            canCreate ? (
              <Button onClick={() => void openCreateForm()}>
                Create Project Invoice
              </Button>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredInvoices.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm 2xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">Invoice Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {invoice.invoice_code ?? "Invoice"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {invoice.customer?.business_name ||
                          invoice.customer?.full_name ||
                          "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {invoice.customer?.phone ?? "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {invoiceContextLabel(invoice)}
                    </td>
                    <td className="px-4 py-3">{formatDate(invoice.invoice_date)}</td>
                    <td className="px-4 py-3">{formatDate(invoice.due_date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(invoice.total_amount)}
                    </td>
                    <td className="px-4 py-3">{formatMoney(invoice.amount_paid)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(invoice.balance_due)}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge value={invoice.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ViewLink to={`/invoices/${invoice.id}`}>View</ViewLink>
                        {canUpdate ? (
                          <Button
                            onClick={() => void openEditForm(invoice)}
                            variant="secondary"
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            onClick={() => setDeleteTarget(invoice)}
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
            {filteredInvoices.map((invoice) => (
              <article
                key={invoice.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(invoice.invoice_date)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {invoice.invoice_code ?? "Invoice"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {invoice.customer?.business_name ||
                        invoice.customer?.full_name ||
                        "-"} /{" "}
                      {invoiceContextLabel(invoice)}
                    </p>
                  </div>
                  <InvoiceStatusBadge value={invoice.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <InvoiceCardItem
                    label="Total"
                    value={formatMoney(invoice.total_amount)}
                  />
                  <InvoiceCardItem
                    label="Paid"
                    value={formatMoney(invoice.amount_paid)}
                  />
                  <InvoiceCardItem
                    label="Balance"
                    value={formatMoney(invoice.balance_due)}
                  />
                  <InvoiceCardItem
                    label="Due"
                    value={formatDate(invoice.due_date)}
                  />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ViewLink to={`/invoices/${invoice.id}`}>View</ViewLink>
                  {canUpdate ? (
                    <Button
                      onClick={() => void openEditForm(invoice)}
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      onClick={() => setDeleteTarget(invoice)}
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
            formState.mode === "create" &&
            formState.values.creation_mode === "manual"
              ? "Create Manual Item Invoice"
              : formState.mode === "create"
                ? "Create Project Invoice"
                : "Edit Invoice"
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
          duplicateProjectInvoice={duplicateProjectInvoice}
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
          title="Delete invoice?"
          description={`This will remove ${deleteTarget.invoice_code ?? "this invoice"} and its itemized bill.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function quotationItemToInvoiceItem(item: QuotationItem) {
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

function prefillItemFromInventory(
  options: InvoiceLinkOptions,
  itemPrefill: InvoiceItemPrefill | undefined,
) {
  if (!itemPrefill?.inventoryItemId) {
    return null;
  }

  const inventoryItem = options.inventoryItems.find(
    (item) => item.id === itemPrefill.inventoryItemId,
  );

  if (!inventoryItem) {
    return null;
  }

  const quantity = Number(itemPrefill.quantity);
  return {
    ...inventoryItemToInvoiceItemForm(inventoryItem, emptyInvoiceItemForm()),
    quantity: Number.isFinite(quantity) && quantity > 0 ? String(quantity) : "1",
  };
}

function InvoiceCardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
