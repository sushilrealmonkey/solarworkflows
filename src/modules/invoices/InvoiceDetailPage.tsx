import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
  requiredError,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import { PaymentStatusBadge } from "../payments/PaymentComponents";
import type { PaymentWithRelations } from "../payments/types";
import {
  createInvoiceItem,
  deleteInvoice,
  deleteInvoiceItem,
  fetchInvoice,
  fetchInvoiceItems,
  fetchInvoiceLinkOptions,
  fetchInvoicePayments,
  fetchProjectInvoicePayments,
  markInvoiceCancelled,
  markInvoiceSent,
  recalculateInvoiceTotals,
  updateInvoice,
  updateInvoiceItem,
} from "./invoiceApi";
import {
  InvoiceFormModal,
  InvoiceStatusBadge,
  InvoiceTotalsCard,
} from "./InvoiceComponents";
import {
  emptyInvoiceItemForm,
  inventoryItemToInvoiceItemForm,
  invoiceContextDescription,
  invoiceInventoryItemLabel,
  invoiceItemToForm,
  invoiceToForm,
  lineGrossAmount,
  lineGstAmount,
  validateInvoiceForm,
} from "./invoiceUtils";
import type {
  InvoiceFormValues,
  InvoiceItem,
  InvoiceItemFormValues,
  InvoiceLinkOptions,
  InvoiceWithRelations,
} from "./types";
import { buildInvoicePdf } from "../documents/businessPdf";
import {
  buildInvoicePdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";

type StatusAction = "sent" | "cancelled";

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceWithRelations | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [options, setOptions] = useState<InvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InvoiceFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [itemForm, setItemForm] = useState<{
    mode: "create" | "edit";
    item: InvoiceItem | null;
    values: InvoiceItemFormValues;
  } | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [savingItem, setSavingItem] = useState(false);
  const [deleteItemTarget, setDeleteItemTarget] = useState<InvoiceItem | null>(
    null,
  );
  const [deletingItem, setDeletingItem] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusAction | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const canView = hasPermission(profile, permissions, "invoices", "view");
  const canCreate = hasPermission(profile, permissions, "invoices", "create");
  const canUpdate = hasPermission(profile, permissions, "invoices", "update");
  const canDelete = hasPermission(profile, permissions, "invoices", "delete");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canAddItems = canCreate && canUpdate;
  const canDeleteItems = canDelete && canUpdate;

  async function loadInvoice() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      if (canUpdate) {
        await recalculateInvoiceTotals(id);
      }
      const [nextInvoice, nextItems, nextOptions] = await Promise.all([
        fetchInvoice(profile, id),
        fetchInvoiceItems(profile, id),
        fetchInvoiceLinkOptions(profile),
      ]);
      setInvoice(nextInvoice);
      setItems(nextItems);
      setOptions(nextOptions);
      if (nextInvoice?.project_id && canViewPayments) {
        setPayments(await fetchProjectInvoicePayments(profile, nextInvoice.project_id));
      } else if (nextInvoice?.b2b_sale_id && canViewPayments) {
        setPayments(await fetchInvoicePayments(profile, nextInvoice.id));
      } else {
        setPayments([]);
      }
      if (nextInvoice && canCreateDocuments) {
        await loadPdfPreview(nextInvoice);
      } else {
        setPdfPreviewUrl(null);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load invoice.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoice();
    // loadInvoice closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Invoice details are not available"
        description="Your role needs invoices:view access to open invoice details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!invoice || !editing) {
      return;
    }

    const nextErrors = validateInvoiceForm(editing, { includeItems: true });
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateInvoice(invoice.id, editing, {
        includeItems: true,
        deleteMissingItems: canDeleteItems,
      });
      setEditing(null);
      showToast("Invoice updated.", "success");
      await loadInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Invoice update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!invoice || !itemForm) {
      return;
    }

    const nextErrors = {
      inventory_item_id: itemForm.values.item_name
        ? ""
        : requiredError(itemForm.values.inventory_item_id, "Inventory item"),
    };
    setItemErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingItem(true);
      if (itemForm.mode === "create") {
        await createInvoiceItem(invoice.id, itemForm.values, items.length + 1);
        showToast("Invoice item added.", "success");
      } else if (itemForm.item) {
        await updateInvoiceItem(invoice.id, itemForm.item.id, itemForm.values);
        showToast("Invoice item updated.", "success");
      }
      setItemForm(null);
      await loadInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Invoice item save failed.",
        "error",
      );
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmItemDelete() {
    if (!invoice || !deleteItemTarget) {
      return;
    }

    try {
      setDeletingItem(true);
      await deleteInvoiceItem(invoice.id, deleteItemTarget.id);
      showToast("Invoice item deleted.", "success");
      setDeleteItemTarget(null);
      await loadInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Invoice item delete failed.",
        "error",
      );
    } finally {
      setDeletingItem(false);
    }
  }

  async function handleDelete() {
    if (!invoice) {
      return;
    }

    try {
      setDeleting(true);
      await deleteInvoice(invoice.id);
      showToast("Invoice deleted.", "success");
      navigate("/invoices");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Invoice delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function confirmStatusAction() {
    if (!invoice || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      if (statusTarget === "sent") {
        await markInvoiceSent(invoice.id);
      } else {
        await markInvoiceCancelled(invoice.id);
      }
      showToast("Invoice status updated.", "success");
      setStatusTarget(null);
      await loadInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Invoice status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function loadPdfPreview(targetInvoice: InvoiceWithRelations) {
    if (!profile?.organization_id) {
      return;
    }

    try {
      const settings = await fetchBusinessDocumentSettings();
      const path = buildInvoicePdfPath(
        profile.organization_id,
        targetInvoice.invoice_code,
        settings.invoice_prefix ?? "INV",
        targetInvoice.id,
      );
      const document = await fetchGeneratedDocument(path);

      if (document) {
        setPdfPreviewUrl(await createGeneratedPdfPreviewUrl(document.file_path));
      } else {
        setPdfPreviewUrl(null);
      }
    } catch {
      setPdfPreviewUrl(null);
    }
  }

  async function handleGeneratePdf() {
    if (!invoice) {
      return;
    }

    if (!canCreateDocuments) {
      showToast("Your role needs documents:create access to store generated PDFs.", "error");
      return;
    }

    try {
      setGeneratingPdf(true);
      const settings = await fetchBusinessDocumentSettings();
      const filePath = buildInvoicePdfPath(
        invoice.organization_id,
        invoice.invoice_code,
        settings.invoice_prefix ?? "INV",
        invoice.id,
      );

      const pdfBlob = await buildInvoicePdf(invoice, items, organization, settings);
      const result = await uploadGeneratedPdf(
        profile,
        {
          document_type: "invoice_pdf",
          document_name: `${invoice.invoice_code ?? "Invoice"} PDF`,
          file_path: filePath,
          customer_id: invoice.customer_id,
          project_id: invoice.project_id,
          quotation_id: invoice.quotation_id,
          invoice_id: invoice.id,
          notes: "Generated invoice PDF",
        },
        pdfBlob,
      );

      setPdfPreviewUrl(result.previewUrl);
      showToast("Invoice PDF generated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Invoice PDF generation failed.",
        "error",
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/invoices">
        Back to invoices
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load invoice" description={error} /> : null}
      {!loading && !error && !invoice ? (
        <EmptyState
          title="Invoice not found"
          description="This invoice may have been deleted or is outside your organization access."
        />
      ) : null}

      {invoice ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={invoice.invoice_code ?? "Invoice"}
              description={invoiceContextDescription(invoice)}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate ? (
                <>
                  <Button
                    onClick={() => {
                      setFormErrors({});
                      setEditing({
                        ...invoiceToForm(invoice),
                        items:
                          items.length > 0
                            ? items.map(invoiceItemToForm)
                            : [emptyInvoiceItemForm()],
                      });
                    }}
                    variant="secondary"
                  >
                    Edit Invoice
                  </Button>
                  <Button
                    onClick={() => setStatusTarget("sent")}
                    disabled={updatingStatus || invoice.status === "cancelled"}
                    variant="secondary"
                  >
                    Mark Sent
                  </Button>
                  <Button
                    onClick={() => setStatusTarget("cancelled")}
                    disabled={updatingStatus || invoice.status === "cancelled"}
                    variant="danger"
                  >
                    Cancel Invoice
                  </Button>
                </>
              ) : null}
              <Button
                onClick={() => void handleGeneratePdf()}
                disabled={generatingPdf || !canCreateDocuments}
                variant="secondary"
              >
                {generatingPdf ? "Generating..." : "Generate PDF"}
              </Button>
              {pdfPreviewUrl ? (
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                  href={pdfPreviewUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open PDF
                </a>
              ) : null}
              {canDelete ? (
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Invoice
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Customer Details">
                <DetailItem label="Customer" value={customerLink(invoice)} />
                <DetailItem label="Phone" value={invoice.customer?.phone ?? "-"} />
                <DetailItem label="Email" value={invoice.customer?.email ?? "-"} />
                <DetailItem label="Address" value={customerAddress(invoice)} />
              </DetailSection>

              <DetailSection title="Invoice Context">
                <DetailItem label="Project" value={projectLink(invoice)} />
                <DetailItem label="Quotation" value={quotationLink(invoice)} />
                <DetailItem label="B2B Sale" value={b2bSaleLink(invoice)} />
                <DetailItem label="Proforma Invoice" value={proformaInvoiceLink(invoice)} />
                <DetailItem
                  label="Invoice Date"
                  value={formatDate(invoice.invoice_date)}
                />
                <DetailItem label="Due Date" value={formatDate(invoice.due_date)} />
                <DetailItem
                  label="Status"
                  value={<InvoiceStatusBadge value={invoice.status} />}
                />
                <DetailItem label="Notes" value={invoice.notes ?? "-"} />
              </DetailSection>

              <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-slate-950">
                    Itemized Bill
                  </h2>
                  {canAddItems ? (
                    <Button
                      onClick={() => {
                        setItemErrors({});
                        setItemForm({
                          mode: "create",
                          item: null,
                          values: emptyInvoiceItemForm(),
                        });
                      }}
                    >
                      Add Item
                    </Button>
                  ) : null}
                </div>

                {items.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      title="No invoice items"
                      description="Add invoice lines before sending this bill."
                      action={
                        canAddItems ? (
                          <Button
                            onClick={() =>
                              setItemForm({
                                mode: "create",
                                item: null,
                                values: emptyInvoiceItemForm(),
                              })
                            }
                          >
                            Add Item
                          </Button>
                        ) : null
                      }
                    />
                  </div>
                ) : (
                  <InvoiceItemsTable
                    items={items}
                    canUpdate={canUpdate}
                    canDelete={canDeleteItems}
                    onEdit={(item) => {
                      setItemErrors({});
                      setItemForm({
                        mode: "edit",
                        item,
                        values: invoiceItemToForm(item),
                      });
                    }}
                    onDelete={setDeleteItemTarget}
                  />
                )}
              </section>

              {canViewPayments ? (
                <RelatedPaymentsSection payments={payments} />
              ) : null}

              <DetailSection title="Status Timeline">
                <DetailItem
                  label="Current Status"
                  value={<InvoiceStatusBadge value={invoice.status} />}
                />
                <DetailItem label="Sent At" value={formatDateTime(invoice.sent_at)} />
                <DetailItem label="Paid At" value={formatDateTime(invoice.paid_at)} />
                <DetailItem label="Created" value={formatDateTime(invoice.created_at)} />
                <DetailItem label="Updated" value={formatDateTime(invoice.updated_at)} />
                <DetailItem label="Created By" value={createdByName(invoice)} />
              </DetailSection>
            </div>

            <InvoiceTotalsCard invoice={invoice} />
          </div>
        </>
      ) : null}

      {editing ? (
        <InvoiceFormModal
          title="Edit Invoice"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          options={options}
          includeItems
          canAddItems={canAddItems}
          canRemoveItems={canDeleteItems}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {itemForm ? (
        <InvoiceItemModal
          title={itemForm.mode === "create" ? "Add Invoice Item" : "Edit Invoice Item"}
          values={itemForm.values}
          inventoryItems={options.inventoryItems}
          setValues={(values) =>
            setItemForm((current) => (current ? { ...current, values } : current))
          }
          errors={itemErrors}
          onClose={() => setItemForm(null)}
          onSubmit={handleItemSubmit}
          saving={savingItem}
        />
      ) : null}

      {deleteItemTarget ? (
        <ConfirmDialog
          title="Delete invoice item?"
          description={`This will remove ${deleteItemTarget.item_name} and recalculate the invoice totals.`}
          confirming={deletingItem}
          onCancel={() => setDeleteItemTarget(null)}
          onConfirm={confirmItemDelete}
        />
      ) : null}

      {confirmingDelete && invoice ? (
        <ConfirmDialog
          title="Delete invoice?"
          description={`This will remove ${invoice.invoice_code ?? "this invoice"} and its itemized bill.`}
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}

      {statusTarget && invoice ? (
        <ConfirmDialog
          title={
            statusTarget === "cancelled"
              ? "Cancel invoice?"
              : "Update invoice status?"
          }
          description={`Set ${invoice.invoice_code ?? "this invoice"} to ${labelize(statusTarget)}.`}
          confirming={updatingStatus}
          confirmLabel={
            statusTarget === "cancelled" ? "Cancel Invoice" : "Update Status"
          }
          confirmingLabel="Updating..."
          confirmVariant={statusTarget === "cancelled" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusAction}
        />
      ) : null}

    </div>
  );
}

function InvoiceItemsTable({
  items,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  items: InvoiceItem[];
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (item: InvoiceItem) => void;
  onDelete: (item: InvoiceItem) => void;
}) {
  return (
    <>
      <div className="mt-4 hidden overflow-hidden rounded-xl border border-stone-200 md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Unit Price</th>
              <th className="px-4 py-3">GST</th>
              <th className="px-4 py-3">Line Total</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-950">
                    {item.item_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {item.description ?? "-"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {item.quantity ?? 0} {item.unit ?? ""}
                </td>
                <td className="px-4 py-3">{formatMoney(item.unit_price)}</td>
                <td className="px-4 py-3">
                  {item.gst_percent ?? 0}% / {formatMoney(lineGstAmount(item))}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-950">
                  {formatMoney(lineGrossAmount(item))}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {canUpdate ? (
                      <Button onClick={() => onEdit(item)} variant="secondary">
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button onClick={() => onDelete(item)} variant="danger">
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
      <div className="mt-4 grid gap-3 md:hidden">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-stone-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.quantity ?? 0} {item.unit ?? ""}
                </p>
                <h3 className="mt-1 font-semibold text-slate-950">
                  {item.item_name}
                </h3>
              </div>
              <p className="font-semibold text-slate-950">
                {formatMoney(lineGrossAmount(item))}
              </p>
            </div>
            {item.description ? (
              <p className="mt-3 text-sm text-slate-600">{item.description}</p>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Unit Price</dt>
                <dd className="font-medium text-slate-900">
                  {formatMoney(item.unit_price)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">GST</dt>
                <dd className="font-medium text-slate-900">
                  {item.gst_percent ?? 0}%
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {canUpdate ? (
                <Button onClick={() => onEdit(item)} variant="secondary">
                  Edit
                </Button>
              ) : null}
              {canDelete ? (
                <Button onClick={() => onDelete(item)} variant="danger">
                  Delete
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function RelatedPaymentsSection({
  payments,
}: {
  payments: PaymentWithRelations[];
}) {
  const receivedAmount = payments
    .filter((payment) => payment.status === "received")
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Related Payments
        </h2>
        <p className="text-sm font-semibold text-slate-700">
          Received {formatMoney(receivedAmount)}
        </p>
      </div>
      {payments.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No related payments"
            description="Received project or B2B invoice payments will appear here."
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {payments.map((payment) => (
            <article
              key={payment.id}
              className="rounded-lg border border-stone-200 bg-stone-50 p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {formatDate(payment.payment_date)}
                  </p>
                  <Link
                    className="mt-1 block font-semibold text-[#06173f]"
                    to={`/payments/${payment.id}`}
                  >
                    {formatMoney(payment.amount)}
                  </Link>
                  <p className="mt-1 text-sm text-slate-600">
                    {labelize(payment.payment_source)} /{" "}
                    {labelize(payment.payment_mode)}
                  </p>
                </div>
                <PaymentStatusBadge value={payment.status} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function InvoiceItemModal({
  title,
  values,
  inventoryItems,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: InvoiceItemFormValues;
  inventoryItems: InvoiceLinkOptions["inventoryItems"];
  setValues: (values: InvoiceItemFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof InvoiceItemFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const selectedInventoryItem = inventoryItems.find(
    (option) => option.id === values.inventory_item_id,
  );
  const selectedItemLabel =
    selectedInventoryItem ? invoiceInventoryItemLabel(selectedInventoryItem) : values.item_name;

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Item"
      submitting={saving}
    >
      <SelectInput
        label="Inventory Item"
        value={values.inventory_item_id}
        onChange={(inventoryItemId) => {
          const nextInventoryItem = inventoryItems.find(
            (option) => option.id === inventoryItemId,
          );
          setValues(
            nextInventoryItem
              ? inventoryItemToInvoiceItemForm(nextInventoryItem, values)
              : { ...values, inventory_item_id: "", item_name: "" },
          );
        }}
        options={[
          {
            value: "",
            label: selectedItemLabel || "Select inventory item",
          },
          ...inventoryItems.map((option) => ({
            value: option.id,
            label: invoiceInventoryItemLabel(option),
          })),
        ]}
      />
      {errors.inventory_item_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.inventory_item_id}</p>
      ) : null}
      <TextInput
        label="Quantity"
        value={values.quantity}
        onChange={(value) => update("quantity", value)}
        type="number"
      />
      <TextInput
        label="Unit"
        value={values.unit}
        onChange={(value) => update("unit", value)}
      />
      <TextInput
        label="Unit Price"
        value={values.unit_price}
        onChange={(value) => update("unit_price", value)}
        type="number"
      />
      <TextInput
        label="GST Percent"
        value={values.gst_percent}
        onChange={(value) => update("gst_percent", value)}
        type="number"
      />
      <TextArea
        label="Description"
        value={values.description}
        onChange={(value) => update("description", value)}
      />
    </Modal>
  );
}

function customerLink(invoice: InvoiceWithRelations) {
  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/customers/${invoice.customer_id}`}
    >
      {invoice.customer?.customer_code ??
        invoice.customer?.full_name ??
        "Open customer"}
    </Link>
  );
}

function projectLink(invoice: InvoiceWithRelations) {
  if (!invoice.project_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/projects/${invoice.project_id}`}
    >
      {invoice.project?.project_code ?? invoice.project?.project_name ?? "Project"}
    </Link>
  );
}

function quotationLink(invoice: InvoiceWithRelations) {
  if (!invoice.quotation_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/quotations/${invoice.quotation_id}`}
    >
      {invoice.quotation?.quotation_code ?? "Quotation"}
    </Link>
  );
}

function b2bSaleLink(invoice: InvoiceWithRelations) {
  if (!invoice.b2b_sale_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/b2b-sales/${invoice.b2b_sale_id}`}
    >
      {invoice.b2b_sale?.sale_code ?? "B2B sale"}
    </Link>
  );
}

function proformaInvoiceLink(invoice: InvoiceWithRelations) {
  if (!invoice.proforma_invoice_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/proforma-invoices/${invoice.proforma_invoice_id}`}
    >
      {invoice.proforma_invoice?.proforma_code ?? "Proforma invoice"}
    </Link>
  );
}

function customerAddress(invoice: InvoiceWithRelations) {
  return [
    invoice.customer?.address_line_1,
    invoice.customer?.address_line_2,
    invoice.customer?.city,
    invoice.customer?.district,
    invoice.customer?.state,
    invoice.customer?.pincode,
  ]
    .filter(Boolean)
    .join(", ") || "-";
}

function createdByName(invoice: InvoiceWithRelations) {
  return (
    invoice.created_by_profile?.full_name ??
    invoice.created_by_profile?.email ??
    invoice.created_by_profile?.phone ??
    "-"
  );
}
