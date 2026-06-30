import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  PencilIcon,
  PlaceholderAction,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import { PaymentStatusBadge } from "../payments/PaymentComponents";
import type { PaymentWithRelations } from "../payments/types";
import {
  createB2BSalePayment,
  dispatchB2BSale,
  fetchB2BSale,
  fetchB2BSaleItems,
  fetchB2BSaleOptions,
  fetchB2BSalePayments,
  updateB2BSale,
} from "./b2bSalesApi";
import {
  createInvoiceFromProformaInvoice,
  fetchProformaInvoice,
  fetchProformaInvoiceItems,
  createProformaInvoiceFromB2BSale,
} from "../proforma-invoices/proformaInvoiceApi";
import {
  fetchProformaInvoicePdfPreviewUrl,
  generateAndStoreProformaInvoicePdf,
} from "../proforma-invoices/proformaInvoicePdfWorkflow";
import { fetchInvoice, fetchInvoiceItems } from "../invoices/invoiceApi";
import { generateAndStoreInvoicePdf } from "../invoices/invoicePdfWorkflow";
import {
  B2BPaymentFormModal,
  B2BSaleFormModal,
  B2BSaleStatusBadge,
  B2BSaleTotalsCard,
} from "./B2BSalesComponents";
import {
  emptyB2BPaymentForm,
  saleToForm,
  validateB2BPaymentForm,
  validateB2BSaleForm,
  lineGrossAmount,
  lineGstAmount,
} from "./b2bSalesUtils";
import type {
  B2BPaymentFormValues,
  B2BSaleFormValues,
  B2BSaleItem,
  B2BSaleOptions,
  B2BSaleWithRelations,
} from "./types";

export function B2BSaleDetailPage() {
  const { id } = useParams();
  const { profile, permissions, roleNames, organization } = useAuth();
  const { showToast } = useToast();
  const [sale, setSale] = useState<B2BSaleWithRelations | null>(null);
  const [items, setItems] = useState<B2BSaleItem[]>([]);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [options, setOptions] = useState<B2BSaleOptions>({
    customers: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<B2BSaleFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDispatch, setConfirmingDispatch] = useState(false);
  const [dispatchingStock, setDispatchingStock] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingProforma, setCreatingProforma] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [paymentForm, setPaymentForm] = useState<B2BPaymentFormValues | null>(
    null,
  );
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [savingPayment, setSavingPayment] = useState(false);

  const canView = hasPermission(profile, permissions, "b2b_sales", "view");
  const canUpdate = hasPermission(profile, permissions, "b2b_sales", "update");
  const canDelete = hasPermission(profile, permissions, "b2b_sales", "delete");
  const canCreateInvoice = hasPermission(profile, permissions, "invoices", "create");
  const canViewInvoices = hasPermission(profile, permissions, "invoices", "view");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canCreatePayments = hasPermission(profile, permissions, "payments", "create");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
  const canDispatchInventory =
    hasPermission(profile, permissions, "inventory", "create") ||
    hasPermission(profile, permissions, "inventory", "update");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );

  async function loadSale() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextSale, nextItems, nextOptions, nextPayments] = await Promise.all([
        fetchB2BSale(profile, id),
        fetchB2BSaleItems(profile, id),
        fetchB2BSaleOptions(profile, canViewPricing),
        canViewPayments ? fetchB2BSalePayments(profile, id) : [],
      ]);
      setSale(nextSale);
      setItems(nextItems);
      setOptions(nextOptions);
      setPayments(nextPayments);
      if (nextSale?.proforma_invoice_id) {
        await loadProformaPdfPreview(nextSale.proforma_invoice_id);
      } else {
        setPdfPreviewUrl(null);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load sales order.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSale();
    // loadSale closes over the current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, canViewPayments, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Sales order details are not available"
        description="Your role needs b2b_sales:view access to open sales orders."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sale || !editing) {
      return;
    }

    const nextErrors = validateB2BSaleForm(editing);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateB2BSale(sale.id, editing, {
        deleteMissingItems: canDelete,
      });
      setEditing(null);
      showToast("Sales order updated.", "success");
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Sales order update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDispatchStock() {
    if (!sale) {
      return;
    }

    try {
      setDispatchingStock(true);
      await dispatchB2BSale(sale.id);
      showToast("Sales order stock dispatched.", "success");
      setConfirmingDispatch(false);
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Stock dispatch failed.",
        "error",
      );
    } finally {
      setDispatchingStock(false);
    }
  }

  async function handleCreateProformaInvoice() {
    if (!sale) {
      return;
    }

    try {
      setCreatingProforma(true);
      const proformaInvoice = await createProformaInvoiceFromB2BSale(sale.id);
      let pdfGenerated = false;

      if (canCreateDocuments) {
        try {
          await prepareProformaPdf(proformaInvoice.id);
          pdfGenerated = true;
        } catch (pdfError) {
          showToast(
            pdfError instanceof Error
              ? `Proforma created, but PDF generation failed: ${pdfError.message}`
              : "Proforma created, but PDF generation failed.",
            "error",
          );
        }
      }

      showToast(
        pdfGenerated
          ? "Proforma invoice created and PDF generated."
          : "Proforma invoice created.",
        "success",
      );
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice creation failed.",
        "error",
      );
    } finally {
      setCreatingProforma(false);
    }
  }

  async function handleCreateInvoice() {
    if (!sale?.proforma_invoice_id) {
      return;
    }

    try {
      setCreatingInvoice(true);
      const invoice = await createInvoiceFromProformaInvoice(sale.proforma_invoice_id);
      let pdfGenerated = false;

      if (canCreateDocuments) {
        try {
          const [invoiceForPdf, invoiceItems] = await Promise.all([
            fetchInvoice(profile, invoice.id),
            fetchInvoiceItems(profile, invoice.id),
          ]);

          if (invoiceForPdf) {
            await generateAndStoreInvoicePdf(
              profile,
              organization,
              invoiceForPdf,
              invoiceItems,
            );
            pdfGenerated = true;
          }
        } catch (pdfError) {
          showToast(
            pdfError instanceof Error
              ? `Final invoice created, but PDF generation failed: ${pdfError.message}`
              : "Final invoice created, but PDF generation failed.",
            "error",
          );
        }
      }

      showToast(
        pdfGenerated
          ? "Final invoice created and PDF generated."
          : "Final invoice created from paid proforma invoice.",
        "success",
      );
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Final invoice creation failed.",
        "error",
      );
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sale || !paymentForm) {
      return;
    }

    const nextErrors = validateB2BPaymentForm(paymentForm);
    setPaymentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createB2BSalePayment(profile, sale, paymentForm);
      setPaymentForm(null);
      showToast("Business payment recorded.", "success");
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment save failed.",
        "error",
      );
    } finally {
      setSavingPayment(false);
    }
  }

  function openEditForm() {
    if (!sale) {
      return;
    }

    setFormErrors({});
    setEditing(saleToForm(sale, items));
  }

  function openPaymentForm() {
    setPaymentErrors({});
    setPaymentForm(emptyB2BPaymentForm());
  }

  async function prepareProformaPdf(proformaInvoiceId: string) {
    if (!canCreateDocuments) {
      setPdfPreviewUrl(null);
      return;
    }

    try {
      setPreparingPdf(true);
      const proformaInvoice = await fetchProformaInvoice(profile, proformaInvoiceId);

      if (!proformaInvoice) {
        throw new Error("Proforma invoice was created but could not be loaded.");
      }

      const existingPreviewUrl =
        await fetchProformaInvoicePdfPreviewUrl(proformaInvoice);
      if (existingPreviewUrl) {
        setPdfPreviewUrl(existingPreviewUrl);
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
      setPdfPreviewUrl(result.previewUrl);
    } finally {
      setPreparingPdf(false);
    }
  }

  async function loadProformaPdfPreview(proformaInvoiceId: string) {
    try {
      setPreparingPdf(true);
      const proformaInvoice = await fetchProformaInvoice(profile, proformaInvoiceId);

      if (!proformaInvoice) {
        setPdfPreviewUrl(null);
        return;
      }

      const existingPreviewUrl =
        await fetchProformaInvoicePdfPreviewUrl(proformaInvoice);
      if (existingPreviewUrl) {
        setPdfPreviewUrl(existingPreviewUrl);
        return;
      }

      if (!canCreateDocuments) {
        setPdfPreviewUrl(null);
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
      setPdfPreviewUrl(result.previewUrl);
    } catch {
      setPdfPreviewUrl(null);
    } finally {
      setPreparingPdf(false);
    }
  }

  const hasProforma = Boolean(sale?.proforma_invoice_id);
  const hasInvoice = Boolean(sale?.invoice_id);
  const canRecordPayment =
    canCreatePayments &&
    hasProforma &&
    !hasInvoice &&
    sale?.status !== "cancelled" &&
    Number(sale?.proforma_invoice?.balance_due ?? 0) > 0;
  const canCreateFinalInvoice =
    canCreateInvoice &&
    hasProforma &&
    !hasInvoice &&
    sale?.proforma_invoice?.status === "paid";
  const canDispatch =
    canUpdate &&
    canDispatchInventory &&
    sale?.status !== "dispatched" &&
    sale?.status !== "cancelled";

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/b2b-sales">
        Back to sales orders
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load sales order" description={error} /> : null}
      {!loading && !error && !sale ? (
        <EmptyState
          title="Sales order not found"
          description="This sale may have been deleted or is outside your organization access."
        />
      ) : null}

      {sale ? (
        <>
          <div className="border-b border-stone-200 pb-5">
            <RecordTitle
              recordType="Sales Order"
              name={sale.sale_code ?? "Sales Order"}
              action={
                canUpdate && sale.status !== "dispatched" && sale.status !== "cancelled" ? (
                  <button
                    aria-label="Edit sales order"
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-stone-50 hover:text-slate-950"
                    onClick={openEditForm}
                    title="Edit sales order"
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                ) : null
              }
              meta={[
                sale.customer?.business_name || sale.customer?.full_name || "Customer",
                labelize(sale.status),
                formatDate(sale.sale_date),
                formatMoney(sale.total_amount),
              ]}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Customer">
                <DetailItem
                  label="Customer"
                  value={
                    <Link
                      className="font-semibold text-[#06173f]"
                      to={`/customers/${sale.customer_id}`}
                    >
                      {sale.customer?.business_name ||
                        sale.customer?.full_name ||
                        "Open customer"}
                    </Link>
                  }
                />
                <DetailItem label="Contact Person" value={sale.customer?.contact_person_name ?? "-"} />
                <DetailItem label="Phone" value={sale.customer?.phone ?? "-"} />
                <DetailItem label="GST Number" value={sale.gst_number || sale.customer?.gst_number || "-"} />
                <DetailItem label="Billing Address" value={sale.billing_address ?? "-"} />
                <DetailItem label="Delivery Address" value={sale.delivery_address ?? "-"} />
              </DetailSection>

              <DetailSection title="Sale Details">
                <DetailItem label="Sale Date" value={formatDate(sale.sale_date)} />
                <DetailItem
                  label="Dispatch Date"
                  value={formatDate(sale.dispatch_date)}
                />
                <DetailItem label="Status" value={<B2BSaleStatusBadge value={sale.status} />} />
                <DetailItem label="Proforma Invoice" value={proformaInvoiceLink(sale, canViewInvoices)} />
                <DetailItem label="Invoice" value={invoiceLink(sale, canViewInvoices)} />
                <DetailItem label="Notes" value={sale.notes ?? "-"} />
                <DetailItem label="Created" value={formatDateTime(sale.created_at)} />
              </DetailSection>

              <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">
                  Sale Items
                </h2>
                {items.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      title="No sale items"
                      description="Add product line items before dispatching this sales order."
                    />
                  </div>
                ) : (
                  <SaleItemsTable items={items} />
                )}
              </section>

              {canViewPayments ? (
                <RelatedPaymentsSection
                  payments={payments}
                  canCreatePayment={canRecordPayment}
                  onAddPayment={openPaymentForm}
                />
              ) : null}
            </div>

            <aside className="space-y-6">
              <B2BSaleNextStepSection
                canCreateInvoice={canCreateInvoice}
                canCreateFinalInvoice={canCreateFinalInvoice}
                canDispatch={canDispatch}
                canRecordPayment={canRecordPayment}
                creatingInvoice={creatingInvoice}
                creatingProforma={creatingProforma}
                dispatchingStock={dispatchingStock}
                hasInvoice={hasInvoice}
                hasProforma={hasProforma}
                preparingPdf={preparingPdf}
                proformaDownloadUrl={pdfPreviewUrl}
                onCreateInvoice={() => void handleCreateInvoice()}
                onCreateProforma={() => void handleCreateProformaInvoice()}
                onDispatch={() => setConfirmingDispatch(true)}
                onRecordPayment={openPaymentForm}
              />
              <B2BSaleTotalsCard sale={sale} />
            </aside>
          </div>
        </>
      ) : null}

      {sale && editing ? (
        <B2BSaleFormModal
          title="Edit Sales Order"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          options={options}
          canRemoveItems={canDelete}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {paymentForm ? (
        <B2BPaymentFormModal
          values={paymentForm}
          setValues={setPaymentForm}
          errors={paymentErrors}
          onClose={() => setPaymentForm(null)}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
        />
      ) : null}

      {confirmingDispatch && sale ? (
        <ConfirmDialog
          title="Dispatch sales order?"
          description={`This will reduce inventory stock for ${sale.sale_code ?? "this sales order"}.`}
          confirmLabel="Dispatch Stock"
          confirmingLabel="Dispatching..."
          confirmVariant="primary"
          confirming={dispatchingStock}
          onCancel={() => setConfirmingDispatch(false)}
          onConfirm={confirmDispatchStock}
        />
      ) : null}
    </div>
  );
}

function SaleItemsTable({ items }: { items: B2BSaleItem[] }) {
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
                  {item.gst_percent ?? 0}% / {formatMoney(lineGstAmount(item))}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-950">
                  {formatMoney(lineGrossAmount(item))}
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
          </article>
        ))}
      </div>
    </>
  );
}

function RelatedPaymentsSection({
  payments,
  canCreatePayment,
  onAddPayment,
}: {
  payments: PaymentWithRelations[];
  canCreatePayment: boolean;
  onAddPayment: () => void;
}) {
  const receivedAmount = payments
    .filter((payment) => payment.status === "received")
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Related Payments
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            Received {formatMoney(receivedAmount)}
          </p>
        </div>
        {canCreatePayment ? <Button onClick={onAddPayment}>Add Payment</Button> : null}
      </div>

      {payments.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No business payments"
            description="Record payment after creating the linked proforma invoice."
            action={canCreatePayment ? <Button onClick={onAddPayment}>Add Payment</Button> : null}
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
                  <p className="mt-1 font-semibold text-slate-950">
                    {formatMoney(payment.amount)}
                  </p>
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

function B2BSaleNextStepSection({
  canCreateInvoice,
  canCreateFinalInvoice,
  canDispatch,
  canRecordPayment,
  creatingInvoice,
  creatingProforma,
  dispatchingStock,
  hasInvoice,
  hasProforma,
  preparingPdf,
  proformaDownloadUrl,
  onCreateInvoice,
  onCreateProforma,
  onDispatch,
  onRecordPayment,
}: {
  canCreateInvoice: boolean;
  canCreateFinalInvoice: boolean;
  canDispatch: boolean;
  canRecordPayment: boolean;
  creatingInvoice: boolean;
  creatingProforma: boolean;
  dispatchingStock: boolean;
  hasInvoice: boolean;
  hasProforma: boolean;
  preparingPdf: boolean;
  proformaDownloadUrl: string | null;
  onCreateInvoice: () => void;
  onCreateProforma: () => void;
  onDispatch: () => void;
  onRecordPayment: () => void;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Next Step</h2>
      <div className="mt-4 grid gap-2">
        {canCreateInvoice && !hasProforma ? (
          <Button disabled={creatingProforma} onClick={onCreateProforma}>
            {creatingProforma ? "Creating Proforma" : "Create Proforma"}
          </Button>
        ) : null}
        {hasProforma ? (
          <DownloadProformaAction preparing={preparingPdf} url={proformaDownloadUrl} />
        ) : null}
        {canRecordPayment ? (
          <Button onClick={onRecordPayment} variant="secondary">
            Add Payment
          </Button>
        ) : null}
        {hasProforma && !hasInvoice ? (
          <Button
            disabled={!canCreateFinalInvoice || creatingInvoice}
            onClick={onCreateInvoice}
            variant="secondary"
          >
            {creatingInvoice ? "Creating Invoice" : "Create Invoice"}
          </Button>
        ) : null}
        {canDispatch ? (
          <Button
            disabled={dispatchingStock}
            onClick={onDispatch}
            variant="secondary"
          >
            {dispatchingStock ? "Dispatching Stock" : "Dispatch Stock"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DownloadProformaAction({
  url,
  preparing,
}: {
  url: string | null;
  preparing: boolean;
}) {
  if (!url) {
    return (
      <PlaceholderAction>
        {preparing ? "Preparing Proforma" : "Download Proforma"}
      </PlaceholderAction>
    );
  }

  return (
    <a
      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
      download
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      Download Proforma
    </a>
  );
}

function invoiceLink(sale: B2BSaleWithRelations, canViewInvoices: boolean) {
  if (!sale.invoice_id) {
    return "-";
  }

  if (!canViewInvoices) {
    return sale.invoice?.invoice_code ?? "Invoice created";
  }

  return (
    <Link className="font-semibold text-[#06173f]" to={`/invoices/${sale.invoice_id}`}>
      {sale.invoice?.invoice_code ?? "Open invoice"}
    </Link>
  );
}

function proformaInvoiceLink(sale: B2BSaleWithRelations, canViewInvoices: boolean) {
  if (!sale.proforma_invoice_id) {
    return "-";
  }

  if (!canViewInvoices) {
    return sale.proforma_invoice?.proforma_code ?? "Proforma created";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/proforma-invoices/${sale.proforma_invoice_id}`}
    >
      {sale.proforma_invoice?.proforma_code ?? "Open proforma"}
    </Link>
  );
}
