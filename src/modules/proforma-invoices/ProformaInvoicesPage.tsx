import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
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
import type { QuotationItem } from "../quotations/types";
import { InvoiceFormModal } from "../invoices/InvoiceComponents";
import {
  emptyInvoiceForm,
  emptyInvoiceItemForm,
} from "../invoices/invoiceUtils";
import {
  recordPaletteCardClassName,
  recordPaletteTableRowClassName,
} from "../shared/recordOriginStyles";
import type {
  InvoiceCreationMode,
  InvoiceQuotationSummary,
} from "../invoices/types";
import {
  createProformaInvoicePayment,
  createProformaInvoice,
  fetchProformaInvoiceItems,
  fetchProformaInvoiceLinkOptions,
  fetchProformaInvoices,
  fetchQuotationItemsForProformaInvoice,
  markProformaInvoiceSent,
  updateProformaInvoice,
} from "./proformaInvoiceApi";
import {
  ProformaInvoiceStatusBadge,
  ProformaPaymentFormModal,
} from "./ProformaInvoiceComponents";
import {
  emptyProformaPaymentForm,
  proformaInvoiceContextLabel,
  proformaInvoiceStatusOptions,
  validateProformaInvoiceForm,
  validateProformaPaymentForm,
} from "./proformaInvoiceUtils";
import type {
  ProformaInvoiceFormValues,
  ProformaInvoiceLinkOptions,
  ProformaInvoiceWithRelations,
  ProformaPaymentFormValues,
} from "./types";
import {
  fetchProformaInvoicePdfPreviewUrl,
  generateAndStoreProformaInvoicePdf,
} from "./proformaInvoicePdfWorkflow";

type ProformaFilters = {
  search: string;
  status: string;
  date: string;
  dueDate: string;
};

export function ProformaInvoicesPage() {
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [proformaInvoices, setProformaInvoices] = useState<
    ProformaInvoiceWithRelations[]
  >([]);
  const [proformaPdfUrls, setProformaPdfUrls] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<ProformaInvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
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
  const [sendingProformaId, setSendingProformaId] = useState<string | null>(null);
  const [preparingProformaId, setPreparingProformaId] = useState<string | null>(
    null,
  );
  const [paymentTarget, setPaymentTarget] =
    useState<ProformaInvoiceWithRelations | null>(null);
  const [paymentForm, setPaymentForm] =
    useState<ProformaPaymentFormValues | null>(null);
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [savingPayment, setSavingPayment] = useState(false);

  const canView = hasPermission(profile, permissions, "invoices", "view");
  const canCreate = hasPermission(profile, permissions, "invoices", "create");
  const canUpdate = hasPermission(profile, permissions, "invoices", "update");
  const canDelete = hasPermission(profile, permissions, "invoices", "delete");
  const canCreatePayments = hasPermission(profile, permissions, "payments", "create");
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
      const [nextProformaInvoices, nextOptions] = await Promise.all([
        fetchProformaInvoices(profile, archiveScope),
        fetchProformaInvoiceLinkOptions(profile),
      ]);
      setProformaInvoices(nextProformaInvoices);
      setOptions(nextOptions);
      if (canCreateDocuments && nextProformaInvoices.length > 0) {
        const pdfEntries = await Promise.all(
          nextProformaInvoices.map(async (proformaInvoice) => {
            try {
              return [
                proformaInvoice.id,
                await fetchProformaInvoicePdfPreviewUrl(proformaInvoice),
              ] as const;
            } catch {
              return [proformaInvoice.id, null] as const;
            }
          }),
        );
        setProformaPdfUrls(
          Object.fromEntries(
            pdfEntries.filter(
              (entry): entry is readonly [string, string] => Boolean(entry[1]),
            ),
          ),
        );
      } else {
        setProformaPdfUrls({});
      }
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
  }, [archiveScope, canView, profile?.id]);

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

  const proformaPagination = useTablePagination(filteredProformaInvoices);
  const paginatedProformaInvoices = proformaPagination.pageItems;

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

  function openProformaDetail(proformaInvoiceId: string) {
    navigate(`/proforma-invoices/${proformaInvoiceId}`);
  }

  function handleProformaRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    proformaInvoiceId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProformaDetail(proformaInvoiceId);
    }
  }

  async function handleMarkSent(proformaInvoice: ProformaInvoiceWithRelations) {
    try {
      setSendingProformaId(proformaInvoice.id);
      await markProformaInvoiceSent(proformaInvoice.id);
      showToast("Proforma invoice marked sent.", "success");
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice status update failed.",
        "error",
      );
    } finally {
      setSendingProformaId(null);
    }
  }

  async function handleDownloadProforma(
    proformaInvoice: ProformaInvoiceWithRelations,
  ) {
    const knownUrl = proformaPdfUrls[proformaInvoice.id];
    if (knownUrl) {
      window.open(knownUrl, "_blank", "noreferrer");
      return;
    }

    if (!canCreateDocuments) {
      showToast(
        "Download needs documents:create access for generated proforma PDFs.",
        "error",
      );
      return;
    }

    try {
      setPreparingProformaId(proformaInvoice.id);
      const existingUrl = await fetchProformaInvoicePdfPreviewUrl(proformaInvoice);
      if (existingUrl) {
        setProformaPdfUrls((current) => ({
          ...current,
          [proformaInvoice.id]: existingUrl,
        }));
        window.open(existingUrl, "_blank", "noreferrer");
        return;
      }

      const proformaItems = await fetchProformaInvoiceItems(
        profile,
        proformaInvoice.id,
      );
      const result = await generateAndStoreProformaInvoicePdf(
        profile,
        organization,
        proformaInvoice,
        proformaItems,
      );
      setProformaPdfUrls((current) => ({
        ...current,
        [proformaInvoice.id]: result.previewUrl,
      }));
      window.open(result.previewUrl, "_blank", "noreferrer");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma PDF download failed.",
        "error",
      );
    } finally {
      setPreparingProformaId(null);
    }
  }

  function openPaymentForm(proformaInvoice: ProformaInvoiceWithRelations) {
    setPaymentErrors({});
    setPaymentTarget(proformaInvoice);
    setPaymentForm(emptyProformaPaymentForm());
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

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!paymentTarget || !paymentForm) {
      return;
    }

    const nextErrors = validateProformaPaymentForm(paymentForm);
    setPaymentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createProformaInvoicePayment(profile, paymentTarget, paymentForm);
      setPaymentForm(null);
      setPaymentTarget(null);
      showToast("Proforma payment recorded.", "success");
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

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

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
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Proforma</th>
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
                {paginatedProformaInvoices.map((proformaInvoice) => (
                  <tr
                    className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName("b2bFlow")}`}
                    key={proformaInvoice.id}
                    onClick={() => openProformaDetail(proformaInvoice.id)}
                    onKeyDown={(event) =>
                      handleProformaRowKeyDown(event, proformaInvoice.id)
                    }
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {proformaInvoice.proforma_code ?? "Proforma Invoice"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {proformaInvoice.customer?.business_name ||
                          proformaInvoice.customer?.full_name ||
                          "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {proformaInvoice.customer?.phone ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {proformaInvoiceContextLabel(proformaInvoice)}
                    </td>
                    <td className="px-4 py-3">{formatDate(proformaInvoice.due_date)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(proformaInvoice.total_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <ProformaInvoiceStatusBadge value={proformaInvoice.status} />
                    </td>
                    <td className="w-52 px-4 py-3">
                      <ProformaNextStepActions
                        canCreateDocuments={canCreateDocuments}
                        canMarkSent={canUpdate && canMarkProformaSent(proformaInvoice)}
                        canRecordPayment={
                          canCreatePayments && canRecordProformaPayment(proformaInvoice)
                        }
                        downloadUrl={proformaPdfUrls[proformaInvoice.id]}
                        preparing={preparingProformaId === proformaInvoice.id}
                        sending={sendingProformaId === proformaInvoice.id}
                        onDownload={() => void handleDownloadProforma(proformaInvoice)}
                        onMarkSent={() => void handleMarkSent(proformaInvoice)}
                        onRecordPayment={() => openPaymentForm(proformaInvoice)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedProformaInvoices.map((proformaInvoice) => (
              <article
                key={proformaInvoice.id}
                className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName("b2bFlow")}`}
                onClick={() => openProformaDetail(proformaInvoice.id)}
                onKeyDown={(event) =>
                  handleProformaRowKeyDown(event, proformaInvoice.id)
                }
                role="link"
                tabIndex={0}
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
                <div
                  className="mt-4"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <ProformaNextStepActions
                    canCreateDocuments={canCreateDocuments}
                    canMarkSent={canUpdate && canMarkProformaSent(proformaInvoice)}
                    canRecordPayment={
                      canCreatePayments && canRecordProformaPayment(proformaInvoice)
                    }
                    downloadUrl={proformaPdfUrls[proformaInvoice.id]}
                    preparing={preparingProformaId === proformaInvoice.id}
                    sending={sendingProformaId === proformaInvoice.id}
                    onDownload={() => void handleDownloadProforma(proformaInvoice)}
                    onMarkSent={() => void handleMarkSent(proformaInvoice)}
                    onRecordPayment={() => openPaymentForm(proformaInvoice)}
                  />
                </div>
              </article>
            ))}
          </div>
          <TablePagination
            label="proforma invoices"
            pagination={proformaPagination}
          />
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

      {paymentForm ? (
        <ProformaPaymentFormModal
          values={paymentForm}
          setValues={setPaymentForm}
          errors={paymentErrors}
          onClose={() => {
            setPaymentForm(null);
            setPaymentTarget(null);
          }}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
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

function canMarkProformaSent(proformaInvoice: ProformaInvoiceWithRelations) {
  return ![
    "sent",
    "partially_paid",
    "paid",
    "converted",
    "cancelled",
  ].includes(proformaInvoice.status ?? "");
}

function canRecordProformaPayment(
  proformaInvoice: ProformaInvoiceWithRelations,
) {
  return (
    ["sent", "partially_paid"].includes(proformaInvoice.status ?? "") &&
    Number(proformaInvoice.balance_due ?? 0) > 0
  );
}

function ProformaNextStepActions({
  canCreateDocuments,
  canMarkSent,
  canRecordPayment,
  downloadUrl,
  preparing,
  sending,
  onDownload,
  onMarkSent,
  onRecordPayment,
}: {
  canCreateDocuments: boolean;
  canMarkSent: boolean;
  canRecordPayment: boolean;
  downloadUrl: string | undefined;
  preparing: boolean;
  sending: boolean;
  onDownload: () => void;
  onMarkSent: () => void;
  onRecordPayment: () => void;
}) {
  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {canMarkSent ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={sending}
          onClick={onMarkSent}
          type="button"
        >
          {sending ? "Marking Sent" : "Mark Sent"}
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
          Download Proforma
        </a>
      ) : canCreateDocuments ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={preparing}
          onClick={onDownload}
          type="button"
        >
          {preparing ? "Preparing Proforma" : "Download Proforma"}
        </button>
      ) : (
        <PlaceholderAction>Download Proforma</PlaceholderAction>
      )}
      {canRecordPayment ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-stone-50"
          onClick={onRecordPayment}
          type="button"
        >
          Record Payment
        </button>
      ) : null}
    </div>
  );
}
