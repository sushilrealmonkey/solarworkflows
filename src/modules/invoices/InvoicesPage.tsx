import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  AccessDenied,
  Button,
  EmptyState,
  LoadingSkeleton,
  PlaceholderAction,
  SearchInput,
  SelectInput,
  TextInput,
  Toolbar,
} from "../crm/CrmComponents";
import { formatDate, hasPermission, labelize } from "../crm/crmUtils";
import { formatMoney, numberToInput } from "../quotations/quotationUtils";
import {
  createInvoice,
  createInvoicePayment,
  fetchActiveProjectInvoice,
  fetchInvoice,
  fetchInvoiceItems,
  fetchInvoiceLinkOptions,
  fetchInvoices,
  updateInvoice,
} from "./invoiceApi";
import {
  InvoiceFormModal,
  InvoicePaymentFormModal,
  InvoiceStatusBadge,
} from "./InvoiceComponents";
import {
  emptyInvoicePaymentForm,
  emptyInvoiceForm,
  emptyInvoiceItemForm,
  invoiceContextLabel,
  inventoryItemToInvoiceItemForm,
  isActiveInvoice,
  invoiceStatusOptions,
  validateInvoicePaymentForm,
  validateInvoiceForm,
} from "./invoiceUtils";
import {
  recordOriginCardClassName,
  recordOriginFromLinks,
  recordOriginTableRowClassName,
} from "../shared/recordOriginStyles";
import {
  fetchInvoicePdfPreviewUrl,
  generateAndStoreInvoicePdf,
} from "./invoicePdfWorkflow";
import {
  createInvoiceFromProformaInvoice,
  fetchProformaInvoiceItems,
} from "../proforma-invoices/proformaInvoiceApi";
import type { ProformaInvoiceItem } from "../proforma-invoices/types";
import type {
  InvoiceCreationMode,
  InvoiceFormValues,
  InvoiceLinkOptions,
  InvoicePaymentFormValues,
  InvoiceProformaOption,
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
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [invoicePdfUrls, setInvoicePdfUrls] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<InvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
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
  const [paymentForm, setPaymentForm] = useState<{
    invoice: InvoiceWithRelations;
    values: InvoicePaymentFormValues;
  } | null>(null);
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [savingPayment, setSavingPayment] = useState(false);
  const [preparingInvoiceId, setPreparingInvoiceId] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "invoices", "view");
  const canCreate = hasPermission(profile, permissions, "invoices", "create");
  const canUpdate = hasPermission(profile, permissions, "invoices", "update");
  const canDelete = hasPermission(profile, permissions, "invoices", "delete");
  const canCreatePayment = hasPermission(
    profile,
    permissions,
    "payments",
    "create",
  );
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
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
      const [nextInvoices, nextOptions] = await Promise.all([
        fetchInvoices(profile, archiveScope),
        fetchInvoiceLinkOptions(profile),
      ]);
      setInvoices(nextInvoices);
      setOptions(nextOptions);
      if (canCreateDocuments && nextInvoices.length > 0) {
        const pdfEntries = await Promise.all(
          nextInvoices.map(async (invoice) => {
            try {
              return [invoice.id, await fetchInvoicePdfPreviewUrl(invoice)] as const;
            } catch {
              return [invoice.id, null] as const;
            }
          }),
        );
        setInvoicePdfUrls(
          Object.fromEntries(
            pdfEntries.filter(
              (entry): entry is readonly [string, string] => Boolean(entry[1]),
            ),
          ),
        );
      } else {
        setInvoicePdfUrls({});
      }
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
  }, [archiveScope, canView, profile?.id]);

  useEffect(() => {
    const projectId = searchParams.get("projectId");
    const proformaInvoiceId = searchParams.get("proformaInvoiceId");
    if (
      (!projectId && !proformaInvoiceId) ||
      loading ||
      !canCreate ||
      formState
    ) {
      return;
    }

    const proformaInvoice = proformaInvoiceId
      ? options.proformaInvoices?.find(
          (option) => option.id === proformaInvoiceId,
        )
      : undefined;
    if (proformaInvoiceId && !proformaInvoice) {
      return;
    }

    const project = projectId
      ? options.projects.find((option) => option.id === projectId)
      : proformaInvoice?.project_id
        ? options.projects.find(
            (option) => option.id === proformaInvoice.project_id,
          )
        : undefined;
    if (projectId && !project) {
      return;
    }

    const creationMode: InvoiceCreationMode =
      proformaInvoice?.project_id || project ? "project" : "manual";
    void openCreateForm(
      creationMode,
      project,
      {
        inventoryItemId: searchParams.get("inventoryItemId") ?? undefined,
        quantity: searchParams.get("quantity") ?? undefined,
      },
      proformaInvoiceId ?? undefined,
    );
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchParams,
    loading,
    canCreate,
    options.projects.length,
    options.proformaInvoices?.length,
  ]);

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

  const invoicePagination = useTablePagination(filteredInvoices);
  const paginatedInvoices = invoicePagination.pageItems;

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
    creationMode: InvoiceCreationMode,
    project?: InvoiceProjectOption,
    itemPrefill?: InvoiceItemPrefill,
    proformaInvoiceId?: string,
  ) {
    let currentProject = project;
    let currentOptions = options;

    try {
      const nextOptions = await fetchInvoiceLinkOptions(
        profile,
        creationMode === "project" ? "project_based" : "b2b_direct",
      );
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

    let values = emptyInvoiceForm(currentProject, creationMode);
    const prefilledInventoryItem = prefillItemFromInventory(
      currentOptions,
      itemPrefill,
    );
    const selectedProformaInvoice = proformaInvoiceId
      ? currentOptions.proformaInvoices?.find((option) => option.id === proformaInvoiceId)
      : undefined;


    if (selectedProformaInvoice) {
      values = await prefillFormFromProforma(selectedProformaInvoice);
    } else if (prefilledInventoryItem) {
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

  function openInvoiceDetail(invoiceId: string) {
    navigate(`/invoices/${invoiceId}`);
  }

  function handleInvoiceRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    invoiceId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openInvoiceDetail(invoiceId);
    }
  }

  async function handleDownloadInvoice(invoice: InvoiceWithRelations) {
    const knownUrl = invoicePdfUrls[invoice.id];
    if (knownUrl) {
      window.open(knownUrl, "_blank", "noreferrer");
      return;
    }

    if (!canCreateDocuments) {
      showToast("Download needs documents:create access for generated PDFs.", "error");
      return;
    }

    try {
      setPreparingInvoiceId(invoice.id);
      const existingUrl = await fetchInvoicePdfPreviewUrl(invoice);
      if (existingUrl) {
        setInvoicePdfUrls((current) => ({
          ...current,
          [invoice.id]: existingUrl,
        }));
        window.open(existingUrl, "_blank", "noreferrer");
        return;
      }

      const invoiceItems = await fetchInvoiceItems(profile, invoice.id);
      const result = await generateAndStoreInvoicePdf(
        profile,
        organization,
        invoice,
        invoiceItems,
      );
      setInvoicePdfUrls((current) => ({
        ...current,
        [invoice.id]: result.previewUrl,
      }));
      window.open(result.previewUrl, "_blank", "noreferrer");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Invoice PDF download failed.",
        "error",
      );
    } finally {
      setPreparingInvoiceId(null);
    }
  }

  function openPaymentForm(invoice: InvoiceWithRelations) {
    setPaymentErrors({});
    setPaymentForm({
      invoice,
      values: emptyInvoicePaymentForm(),
    });
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!paymentForm) {
      return;
    }

    const nextErrors = validateInvoicePaymentForm(paymentForm.values);
    setPaymentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createInvoicePayment(profile, paymentForm.invoice, paymentForm.values);
      setPaymentForm(null);
      showToast("Payment added.", "success");
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment save failed.",
        "error",
      );
    } finally {
      setSavingPayment(false);
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

  async function handleProformaChange(proformaInvoiceId: string) {
    if (!formState || formState.mode !== "create") {
      return;
    }

    if (!proformaInvoiceId) {
      const creationMode = formState.values.creation_mode;
      setFormErrors({});
      setFormState({
        ...formState,
        values: emptyInvoiceForm(null, creationMode),
      });
      return;
    }

    const proformaInvoice = options.proformaInvoices?.find(
      (option) => option.id === proformaInvoiceId,
    );
    if (!proformaInvoice) {
      showToast("The selected proforma invoice is no longer available.", "error");
      return;
    }

    try {
      const values = await prefillFormFromProforma(proformaInvoice);
      setFormErrors({});
      setFormState((current) =>
        current?.mode === "create" ? { ...current, values } : current,
      );
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to copy the proforma invoice details.",
        "error",
      );
    }
  }

  async function prefillFormFromProforma(
    proformaInvoice: InvoiceProformaOption,
  ) {
    const creationMode: InvoiceCreationMode = proformaInvoice.project_id
      ? "project"
      : "manual";
    const project = proformaInvoice.project_id
      ? options.projects.find((option) => option.id === proformaInvoice.project_id)
      : null;
    const proformaItems = await fetchProformaInvoiceItems(
      profile,
      proformaInvoice.id,
    );
    const values = emptyInvoiceForm(project, creationMode);

    return {
      ...values,
      proforma_invoice_id: proformaInvoice.id,
      customer_id: proformaInvoice.customer_id,
      project_id: proformaInvoice.project_id ?? "",
      quotation_id: proformaInvoice.quotation_id ?? "",
      due_date: proformaInvoice.due_date ?? values.due_date,
      notes: proformaInvoice.notes ?? "",
      items: proformaItems.map(proformaItemToInvoiceForm),
    };
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
          proforma_invoice_id: "",
          project_id: projectId,
          customer_id: project?.customer_id ?? "",
          quotation_id: project?.quotation_id ?? "",
          discount_amount: "",
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

    if (formState.mode === "create" && formState.values.project_id) {
      try {
        const existingInvoice =
          duplicateProjectInvoice ??
          (await fetchActiveProjectInvoice(profile, formState.values.project_id));

        if (existingInvoice) {
          setFormErrors({
            project_id: `An active invoice already exists for this project: ${
              existingInvoice.invoice_code ?? "open invoice"
            }.`,
          });
          showToast(
            `Invoice already exists for this project: ${
              existingInvoice.invoice_code ?? "open invoice"
            }.`,
            "error",
          );
          return;
        }
      } catch (nextError) {
        showToast(
          nextError instanceof Error
            ? nextError.message
            : "Unable to verify project invoice status.",
          "error",
        );
        return;
      }
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
        const createdInvoice = formState.values.proforma_invoice_id
          ? await createInvoiceFromProformaInvoice(
              formState.values.proforma_invoice_id,
            )
          : await createInvoice(profile, formState.values);
        let pdfGenerated = false;
        let pdfGenerationFailed = false;

        if (canCreateDocuments) {
          try {
            const [invoiceForPdf, itemsForPdf] = await Promise.all([
              fetchInvoice(profile, createdInvoice.id),
              fetchInvoiceItems(profile, createdInvoice.id),
            ]);

            if (invoiceForPdf) {
              await generateAndStoreInvoicePdf(
                profile,
                organization,
                invoiceForPdf,
                itemsForPdf,
              );
              pdfGenerated = true;
            }
          } catch (pdfError) {
            pdfGenerationFailed = true;
            showToast(
              pdfError instanceof Error
                ? `Invoice created, but PDF generation failed: ${pdfError.message}`
                : "Invoice created, but PDF generation failed.",
              "error",
            );
          }
        }

        if (pdfGenerated) {
          showToast("Invoice created and PDF generated.", "success");
        } else if (!canCreateDocuments) {
          showToast("Invoice created. PDF generation needs documents:create access.", "success");
        } else if (!pdfGenerationFailed) {
          showToast("Invoice created.", "success");
        }
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

  async function prefillItemsFromQuotation(
    quotation: InvoiceQuotationSummary | null | undefined,
  ) {
    if (!quotation) {
      return [emptyInvoiceItemForm()];
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
        unit_price: numberToInput(
          quotation.base_amount ?? quotation.total_amount ?? quotation.net_payable_amount,
        ),
        gst_percent: numberToInput(gstPercent),
      },
    ];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Tax Invoices"
          description="Create separate B2B and project tax invoices, or copy a paid proforma invoice."
        />
        {canCreate ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => void openCreateForm("manual")}>
              Create for B2B
            </Button>
            <Button
              onClick={() => void openCreateForm("project")}
              variant="secondary"
            >
              Create for Project
            </Button>
          </div>
        ) : null}
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

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
          description="Create a B2B or project tax invoice, with optional proforma invoice prefill."
          action={
            canCreate ? (
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Button onClick={() => void openCreateForm("manual")}>
                  Create for B2B
                </Button>
                <Button
                  onClick={() => void openCreateForm("project")}
                  variant="secondary"
                >
                  Create for Project
                </Button>
              </div>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredInvoices.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedInvoices.map((invoice) => {
                  const origin = recordOriginFromLinks(invoice);

                  return (
                    <tr
                      className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordOriginTableRowClassName(origin)}`}
                      key={invoice.id}
                      onClick={() => openInvoiceDetail(invoice.id)}
                      onKeyDown={(event) => handleInvoiceRowKeyDown(event, invoice.id)}
                      role="link"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {invoice.invoice_code ?? "Invoice"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {invoice.customer?.business_name ||
                            invoice.customer?.full_name ||
                            "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">{invoice.customer?.phone ?? "-"}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {invoiceContextLabel(invoice)}
                      </td>
                      <td className="px-4 py-3">{formatDate(invoice.due_date)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-950">
                        {formatMoney(invoice.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge value={invoice.status} />
                      </td>
                      <td className="w-48 px-4 py-3">
                        <InvoiceNextStepActions
                          canAddPayment={
                            canCreatePayment && canAddInvoicePayment(invoice)
                          }
                          canCreateDocuments={canCreateDocuments}
                          downloadUrl={invoicePdfUrls[invoice.id]}
                          preparing={preparingInvoiceId === invoice.id}
                          onAddPayment={() => openPaymentForm(invoice)}
                          onDownload={() => void handleDownloadInvoice(invoice)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedInvoices.map((invoice) => {
              const origin = recordOriginFromLinks(invoice);

              return (
                <article
                  key={invoice.id}
                  className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordOriginCardClassName(origin)}`}
                  onClick={() => openInvoiceDetail(invoice.id)}
                  onKeyDown={(event) => handleInvoiceRowKeyDown(event, invoice.id)}
                  role="link"
                  tabIndex={0}
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
                  <div
                    className="mt-4"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <InvoiceNextStepActions
                      canAddPayment={canCreatePayment && canAddInvoicePayment(invoice)}
                      canCreateDocuments={canCreateDocuments}
                      downloadUrl={invoicePdfUrls[invoice.id]}
                      preparing={preparingInvoiceId === invoice.id}
                      onAddPayment={() => openPaymentForm(invoice)}
                      onDownload={() => void handleDownloadInvoice(invoice)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
          <TablePagination label="tax invoices" pagination={invoicePagination} />
        </>
      ) : null}

      {formState ? (
        <InvoiceFormModal
          title={
            formState.mode === "create" &&
            formState.values.creation_mode === "manual"
              ? "Create B2B Tax Invoice"
              : formState.mode === "create"
                ? "Create Project Tax Invoice"
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
          creationModeLocked={formState.mode === "create"}
          showProjectCustomerSelect={
            formState.mode === "create" &&
            formState.values.creation_mode === "project"
          }
          showProformaSelect={formState.mode === "create"}
          proformaPrefillLocked={Boolean(
            formState.values.proforma_invoice_id,
          )}
          customerLabel={
            formState.values.creation_mode === "project"
              ? "Project Customer"
              : "B2B Customer"
          }
          onProformaChange={
            formState.mode === "create"
              ? (proformaInvoiceId) => void handleProformaChange(proformaInvoiceId)
              : undefined
          }
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

      {paymentForm ? (
        <InvoicePaymentFormModal
          values={paymentForm.values}
          setValues={(values) =>
            setPaymentForm((current) => (current ? { ...current, values } : current))
          }
          errors={paymentErrors}
          onClose={() => setPaymentForm(null)}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
        />
      ) : null}

    </div>
  );
}

function proformaItemToInvoiceForm(item: ProformaInvoiceItem) {
  return {
    inventory_item_id: item.inventory_item_id ?? "",
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

function canAddInvoicePayment(invoice: InvoiceWithRelations) {
  return (
    ["sent", "partially_paid", "overdue"].includes(invoice.status ?? "") &&
    Number(invoice.balance_due ?? 0) > 0
  );
}

function InvoiceNextStepActions({
  canAddPayment,
  canCreateDocuments,
  downloadUrl,
  preparing,
  onAddPayment,
  onDownload,
}: {
  canAddPayment: boolean;
  canCreateDocuments: boolean;
  downloadUrl: string | undefined;
  preparing: boolean;
  onAddPayment: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {canAddPayment ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onAddPayment}
          type="button"
        >
          Add Payment
        </button>
      ) : null}
      {downloadUrl ? (
        <a
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
          download
          href={downloadUrl}
          rel="noreferrer"
          target="_blank"
        >
          Download Invoice
        </a>
      ) : canCreateDocuments ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={preparing}
          onClick={onDownload}
          type="button"
        >
          {preparing ? "Preparing Invoice" : "Download Invoice"}
        </button>
      ) : (
        <PlaceholderAction>Download Invoice</PlaceholderAction>
      )}
    </div>
  );
}
