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
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import { InvoiceFormModal } from "../invoices/InvoiceComponents";
import {
  emptyInvoiceItemForm,
  lineGrossAmount,
  lineGstAmount,
} from "../invoices/invoiceUtils";
import type { InvoiceItem } from "../invoices/types";
import { PaymentStatusBadge } from "../payments/PaymentComponents";
import type { PaymentWithRelations } from "../payments/types";
import { buildProformaInvoicePdf } from "../documents/businessPdf";
import {
  buildProformaInvoicePdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import {
  createInvoiceFromProformaInvoice,
  createProformaInvoicePayment,
  deleteProformaInvoice,
  fetchProformaInvoice,
  fetchProformaInvoiceItems,
  fetchProformaInvoiceLinkOptions,
  fetchProformaInvoicePayments,
  markProformaInvoiceCancelled,
  markProformaInvoiceSent,
  recalculateProformaInvoiceTotals,
  updateProformaInvoice,
} from "./proformaInvoiceApi";
import {
  ProformaInvoiceStatusBadge,
  ProformaInvoiceTotalsCard,
  ProformaPaymentFormModal,
} from "./ProformaInvoiceComponents";
import {
  canCreateFinalInvoice,
  emptyProformaPaymentForm,
  proformaInvoiceContextDescription,
  proformaInvoiceItemToForm,
  proformaInvoiceToForm,
  validateProformaInvoiceForm,
  validateProformaPaymentForm,
} from "./proformaInvoiceUtils";
import type {
  ProformaInvoiceFormValues,
  ProformaInvoiceItem,
  ProformaInvoiceLinkOptions,
  ProformaInvoiceWithRelations,
  ProformaPaymentFormValues,
} from "./types";

type StatusAction = "sent" | "cancelled";

export function ProformaInvoiceDetailPage() {
  const { id } = useParams();
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [proformaInvoice, setProformaInvoice] =
    useState<ProformaInvoiceWithRelations | null>(null);
  const [items, setItems] = useState<ProformaInvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [options, setOptions] = useState<ProformaInvoiceLinkOptions>({
    customers: [],
    projects: [],
    quotations: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProformaInvoiceFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [paymentForm, setPaymentForm] =
    useState<ProformaPaymentFormValues | null>(null);
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [savingPayment, setSavingPayment] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusAction | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingFinalInvoice, setCreatingFinalInvoice] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const canView = hasPermission(profile, permissions, "invoices", "view");
  const canCreate = hasPermission(profile, permissions, "invoices", "create");
  const canUpdate = hasPermission(profile, permissions, "invoices", "update");
  const canDelete = hasPermission(profile, permissions, "invoices", "delete");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
  const canCreatePayments = hasPermission(profile, permissions, "payments", "create");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );

  async function loadProformaInvoice() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      if (canUpdate) {
        await recalculateProformaInvoiceTotals(id);
      }
      const [nextProformaInvoice, nextItems, nextOptions, nextPayments] =
        await Promise.all([
          fetchProformaInvoice(profile, id),
          fetchProformaInvoiceItems(profile, id),
          fetchProformaInvoiceLinkOptions(profile),
          canViewPayments ? fetchProformaInvoicePayments(profile, id) : [],
        ]);
      setProformaInvoice(nextProformaInvoice);
      setItems(nextItems);
      setOptions(nextOptions);
      setPayments(nextPayments);
      if (nextProformaInvoice && canCreateDocuments) {
        await loadPdfPreview(nextProformaInvoice);
      } else {
        setPdfPreviewUrl(null);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load proforma invoice.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProformaInvoice();
    // loadProformaInvoice closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPayments, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Proforma invoice details are not available"
        description="Your role needs invoices:view access to open proforma invoice details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!proformaInvoice || !editing) {
      return;
    }

    const nextErrors = validateProformaInvoiceForm(editing);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateProformaInvoice(proformaInvoice.id, editing, {
        deleteMissingItems: canDelete,
      });
      setEditing(null);
      showToast("Proforma invoice updated.", "success");
      await loadProformaInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!proformaInvoice || !paymentForm) {
      return;
    }

    const nextErrors = validateProformaPaymentForm(paymentForm);
    setPaymentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createProformaInvoicePayment(profile, proformaInvoice, paymentForm);
      setPaymentForm(null);
      showToast("Proforma payment recorded.", "success");
      await loadProformaInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment save failed.",
        "error",
      );
    } finally {
      setSavingPayment(false);
    }
  }

  async function confirmStatusAction() {
    if (!proformaInvoice || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      if (statusTarget === "sent") {
        await markProformaInvoiceSent(proformaInvoice.id);
      } else {
        await markProformaInvoiceCancelled(proformaInvoice.id);
      }
      showToast("Proforma invoice status updated.", "success");
      setStatusTarget(null);
      await loadProformaInvoice();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleCreateFinalInvoice() {
    if (!proformaInvoice) {
      return;
    }

    try {
      setCreatingFinalInvoice(true);
      const invoice = await createInvoiceFromProformaInvoice(proformaInvoice.id);
      showToast("Final invoice created.", "success");
      navigate(`/invoices/${invoice.id}`);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Final invoice creation failed.",
        "error",
      );
    } finally {
      setCreatingFinalInvoice(false);
    }
  }

  async function handleDelete() {
    if (!proformaInvoice) {
      return;
    }

    try {
      setDeleting(true);
      await deleteProformaInvoice(proformaInvoice.id);
      showToast("Proforma invoice deleted.", "success");
      navigate("/proforma-invoices");
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

  async function loadPdfPreview(targetProformaInvoice: ProformaInvoiceWithRelations) {
    try {
      const path = buildProformaInvoicePdfPath(
        targetProformaInvoice.organization_id,
        targetProformaInvoice.proforma_code,
        "PI",
        targetProformaInvoice.id,
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
    if (!proformaInvoice) {
      return;
    }

    if (!canCreateDocuments) {
      showToast("Your role needs documents:create access to store generated PDFs.", "error");
      return;
    }

    try {
      setGeneratingPdf(true);
      const settings = await fetchBusinessDocumentSettings();
      const filePath = buildProformaInvoicePdfPath(
        proformaInvoice.organization_id,
        proformaInvoice.proforma_code,
        "PI",
        proformaInvoice.id,
      );

      const pdfBlob = await buildProformaInvoicePdf(
        proformaInvoice,
        items,
        organization,
        settings,
      );
      const result = await uploadGeneratedPdf(
        profile,
        {
          document_type: "proforma_invoice_pdf",
          document_name: `${proformaInvoice.proforma_code ?? "Proforma Invoice"} PDF`,
          file_path: filePath,
          customer_id: proformaInvoice.customer_id,
          project_id: proformaInvoice.project_id,
          quotation_id: proformaInvoice.quotation_id,
          proforma_invoice_id: proformaInvoice.id,
          notes: "Generated proforma invoice PDF",
        },
        pdfBlob,
      );

      setPdfPreviewUrl(result.previewUrl);
      showToast("Proforma invoice PDF generated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice PDF generation failed.",
        "error",
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/proforma-invoices">
        Back to proforma invoices
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load proforma invoice" description={error} /> : null}
      {!loading && !error && !proformaInvoice ? (
        <EmptyState
          title="Proforma invoice not found"
          description="This proforma invoice may have been deleted or is outside your organization access."
        />
      ) : null}

      {proformaInvoice ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={proformaInvoice.proforma_code ?? "Proforma Invoice"}
              description={proformaInvoiceContextDescription(proformaInvoice)}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate && !["converted", "cancelled"].includes(proformaInvoice.status ?? "") ? (
                <>
                  <Button
                    onClick={() => {
                      setFormErrors({});
                      setEditing({
                        ...proformaInvoiceToForm(proformaInvoice),
                        items:
                          items.length > 0
                            ? items.map(proformaInvoiceItemToForm)
                            : [emptyInvoiceItemForm()],
                      });
                    }}
                    variant="secondary"
                  >
                    Edit Proforma
                  </Button>
                  <Button
                    onClick={() => setStatusTarget("sent")}
                    disabled={updatingStatus}
                    variant="secondary"
                  >
                    Mark Sent
                  </Button>
                  <Button
                    onClick={() => setStatusTarget("cancelled")}
                    disabled={updatingStatus}
                    variant="danger"
                  >
                    Cancel Proforma
                  </Button>
                </>
              ) : null}
              {canCreatePayments && !["converted", "cancelled"].includes(proformaInvoice.status ?? "") ? (
                <Button
                  onClick={() => {
                    setPaymentErrors({});
                    setPaymentForm(emptyProformaPaymentForm());
                  }}
                >
                  Record Payment
                </Button>
              ) : null}
              {canCreate ? (
                <Button
                  onClick={() => void handleCreateFinalInvoice()}
                  disabled={
                    creatingFinalInvoice || !canCreateFinalInvoice(proformaInvoice)
                  }
                  variant="secondary"
                >
                  {proformaInvoice.final_invoice_id
                    ? "Invoice Created"
                    : "Create Invoice"}
                </Button>
              ) : null}
              <Button
                onClick={() => void handleGeneratePdf()}
                disabled={generatingPdf || !canCreateDocuments}
                variant="secondary"
              >
                {generatingPdf ? "Generating..." : "Generate PI PDF"}
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
                  Delete Proforma
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Customer Details">
                <DetailItem label="Customer" value={customerLink(proformaInvoice)} />
                <DetailItem label="Phone" value={proformaInvoice.customer?.phone ?? "-"} />
                <DetailItem label="Email" value={proformaInvoice.customer?.email ?? "-"} />
                <DetailItem
                  label="GST Number"
                  value={
                    proformaInvoice.b2b_sale?.gst_number ||
                    proformaInvoice.customer?.gst_number ||
                    "-"
                  }
                />
                <DetailItem label="Billing Address" value={customerAddress(proformaInvoice)} />
                {proformaInvoice.b2b_sale?.delivery_address ? (
                  <DetailItem
                    label="Delivery Address"
                    value={proformaInvoice.b2b_sale.delivery_address}
                  />
                ) : null}
              </DetailSection>

              <DetailSection title="Proforma Context">
                <DetailItem label="Project" value={projectLink(proformaInvoice)} />
                <DetailItem label="Quotation" value={quotationLink(proformaInvoice)} />
                <DetailItem label="B2B Sale" value={b2bSaleLink(proformaInvoice)} />
                <DetailItem label="Final Invoice" value={finalInvoiceLink(proformaInvoice)} />
                <DetailItem label="PI Date" value={formatDate(proformaInvoice.proforma_date)} />
                <DetailItem label="Due Date" value={formatDate(proformaInvoice.due_date)} />
                <DetailItem label="Status" value={<ProformaInvoiceStatusBadge value={proformaInvoice.status} />} />
                <DetailItem label="Notes" value={proformaInvoice.notes ?? "-"} />
              </DetailSection>

              <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">
                  Proforma Items
                </h2>
                {items.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      title="No proforma items"
                      description="Edit this proforma invoice to add line items."
                    />
                  </div>
                ) : (
                  <ProformaItemsTable items={items} />
                )}
              </section>

              {canViewPayments ? <RelatedPaymentsSection payments={payments} /> : null}

              <DetailSection title="Status Timeline">
                <DetailItem label="Current Status" value={<ProformaInvoiceStatusBadge value={proformaInvoice.status} />} />
                <DetailItem label="Sent At" value={formatDateTime(proformaInvoice.sent_at)} />
                <DetailItem label="Paid At" value={formatDateTime(proformaInvoice.paid_at)} />
                <DetailItem label="Converted At" value={formatDateTime(proformaInvoice.converted_at)} />
                <DetailItem label="Created" value={formatDateTime(proformaInvoice.created_at)} />
                <DetailItem label="Updated" value={formatDateTime(proformaInvoice.updated_at)} />
                <DetailItem label="Created By" value={createdByName(proformaInvoice)} />
              </DetailSection>
            </div>

            <ProformaInvoiceTotalsCard proformaInvoice={proformaInvoice} />
          </div>
        </>
      ) : null}

      {editing ? (
        <InvoiceFormModal
          title="Edit Proforma Invoice"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          options={options}
          includeItems
          canAddItems={canCreate && canUpdate}
          canRemoveItems={canDelete && canUpdate}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {paymentForm ? (
        <ProformaPaymentFormModal
          values={paymentForm}
          setValues={setPaymentForm}
          errors={paymentErrors}
          onClose={() => setPaymentForm(null)}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
        />
      ) : null}

      {statusTarget && proformaInvoice ? (
        <ConfirmDialog
          title={
            statusTarget === "cancelled"
              ? "Cancel proforma invoice?"
              : "Update proforma status?"
          }
          description={`Set ${proformaInvoice.proforma_code ?? "this proforma invoice"} to ${labelize(statusTarget)}.`}
          confirming={updatingStatus}
          confirmLabel={
            statusTarget === "cancelled" ? "Cancel Proforma" : "Update Status"
          }
          confirmingLabel="Updating..."
          confirmVariant={statusTarget === "cancelled" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusAction}
        />
      ) : null}

      {confirmingDelete && proformaInvoice ? (
        <ConfirmDialog
          title="Delete proforma invoice?"
          description={`This will remove ${proformaInvoice.proforma_code ?? "this proforma invoice"} and its itemized bill.`}
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}

    </div>
  );
}

function ProformaItemsTable({ items }: { items: ProformaInvoiceItem[] }) {
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
                  {item.gst_percent ?? 0}% /{" "}
                  {formatMoney(lineGstAmount(item as unknown as InvoiceItem))}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-950">
                  {formatMoney(lineGrossAmount(item as unknown as InvoiceItem))}
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
                {formatMoney(lineGrossAmount(item as unknown as InvoiceItem))}
              </p>
            </div>
            {item.description ? (
              <p className="mt-3 text-sm text-slate-600">{item.description}</p>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function RelatedPaymentsSection({ payments }: { payments: PaymentWithRelations[] }) {
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
            title="No proforma payments"
            description="Payments recorded against this proforma invoice will appear here."
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
                    {labelize(payment.payment_mode)} /{" "}
                    {payment.reference_number ?? "No reference"}
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

function customerLink(proformaInvoice: ProformaInvoiceWithRelations) {
  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/customers/${proformaInvoice.customer_id}`}
    >
      {proformaInvoice.customer?.business_name ||
        proformaInvoice.customer?.full_name ||
        proformaInvoice.customer?.customer_code ||
        "Open customer"}
    </Link>
  );
}

function projectLink(proformaInvoice: ProformaInvoiceWithRelations) {
  if (!proformaInvoice.project_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/projects/${proformaInvoice.project_id}`}
    >
      {proformaInvoice.project?.project_code ??
        proformaInvoice.project?.project_name ??
        "Project"}
    </Link>
  );
}

function quotationLink(proformaInvoice: ProformaInvoiceWithRelations) {
  if (!proformaInvoice.quotation_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/quotations/${proformaInvoice.quotation_id}`}
    >
      {proformaInvoice.quotation?.quotation_code ?? "Quotation"}
    </Link>
  );
}

function b2bSaleLink(proformaInvoice: ProformaInvoiceWithRelations) {
  if (!proformaInvoice.b2b_sale_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/b2b-sales/${proformaInvoice.b2b_sale_id}`}
    >
      {proformaInvoice.b2b_sale?.sale_code ?? "B2B sale"}
    </Link>
  );
}

function finalInvoiceLink(proformaInvoice: ProformaInvoiceWithRelations) {
  if (!proformaInvoice.final_invoice_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/invoices/${proformaInvoice.final_invoice_id}`}
    >
      {proformaInvoice.final_invoice?.invoice_code ?? "Final invoice"}
    </Link>
  );
}

function customerAddress(proformaInvoice: ProformaInvoiceWithRelations) {
  if (proformaInvoice.b2b_sale?.billing_address) {
    return proformaInvoice.b2b_sale.billing_address;
  }

  return [
    proformaInvoice.customer?.address_line_1,
    proformaInvoice.customer?.address_line_2,
    proformaInvoice.customer?.city,
    proformaInvoice.customer?.district,
    proformaInvoice.customer?.state,
    proformaInvoice.customer?.pincode,
  ]
    .filter(Boolean)
    .join(", ") || "-";
}

function createdByName(proformaInvoice: ProformaInvoiceWithRelations) {
  return (
    proformaInvoice.created_by_profile?.full_name ??
    proformaInvoice.created_by_profile?.email ??
    proformaInvoice.created_by_profile?.phone ??
    "-"
  );
}
