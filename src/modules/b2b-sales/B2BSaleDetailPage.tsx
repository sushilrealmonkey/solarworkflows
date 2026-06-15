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
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import { PaymentStatusBadge } from "../payments/PaymentComponents";
import type { PaymentWithRelations } from "../payments/types";
import {
  cancelB2BSale,
  confirmB2BSale,
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
  createProformaInvoiceFromB2BSale,
} from "../proforma-invoices/proformaInvoiceApi";
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

type StatusAction = "confirm" | "dispatch" | "cancel";

export function B2BSaleDetailPage() {
  const { id } = useParams();
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
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
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingProforma, setCreatingProforma] = useState(false);
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
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load B2B/Direct sale.",
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
        title="B2B/Direct sale details are not available"
        description="Your role needs b2b_sales:view access to open B2B/Direct sales."
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
      showToast("B2B/Direct sale updated.", "success");
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "B2B/Direct sale update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusAction() {
    if (!sale || !statusAction) {
      return;
    }

    try {
      setUpdatingStatus(true);
      if (statusAction === "confirm") {
        await confirmB2BSale(sale.id);
      } else if (statusAction === "dispatch") {
        await dispatchB2BSale(sale.id);
      } else {
        await cancelB2BSale(sale.id);
      }
      showToast("B2B/Direct sale status updated.", "success");
      setStatusAction(null);
      await loadSale();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "B2B/Direct sale status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleCreateProformaInvoice() {
    if (!sale) {
      return;
    }

    try {
      setCreatingProforma(true);
      const proformaInvoice = await createProformaInvoiceFromB2BSale(sale.id);
      showToast("Proforma invoice created from B2B/Direct sale.", "success");
      await loadSale();
      navigate(`/proforma-invoices/${proformaInvoice.id}`);
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
      showToast("Final invoice created from paid proforma invoice.", "success");
      await loadSale();
      navigate(`/invoices/${invoice.id}`);
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
      showToast("B2B/Direct payment recorded.", "success");
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

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-brand-700" to="/b2b-sales">
        Back to B2B/Direct sales
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load B2B/Direct sale" description={error} /> : null}
      {!loading && !error && !sale ? (
        <EmptyState
          title="B2B/Direct sale not found"
          description="This sale may have been deleted or is outside your organization access."
        />
      ) : null}

      {sale ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={sale.sale_code ?? "B2B/Direct Sale"}
              description={`${sale.customer?.business_name || sale.customer?.full_name || "Customer"} / ${formatDate(sale.sale_date)}`}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate && sale.status !== "dispatched" && sale.status !== "cancelled" ? (
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(saleToForm(sale, items));
                  }}
                  variant="secondary"
                >
                  Edit Sale
                </Button>
              ) : null}
              {canUpdate && sale.status === "draft" ? (
                <Button onClick={() => setStatusAction("confirm")} variant="secondary">
                  Confirm Sale
                </Button>
              ) : null}
              {canCreateInvoice ? (
                <Button
                  onClick={() => void handleCreateProformaInvoice()}
                  disabled={creatingProforma || Boolean(sale.proforma_invoice_id)}
                  variant="secondary"
                >
                  {sale.proforma_invoice_id ? "Proforma Created" : "Create Proforma"}
                </Button>
              ) : null}
              {canCreateInvoice ? (
                <Button
                  onClick={() => void handleCreateInvoice()}
                  disabled={
                    creatingInvoice ||
                    Boolean(sale.invoice_id) ||
                    sale.proforma_invoice?.status !== "paid"
                  }
                  variant="secondary"
                >
                  {sale.invoice_id ? "Invoice Created" : "Create Invoice"}
                </Button>
              ) : null}
              {canUpdate &&
              canDispatchInventory &&
              sale.status === "confirmed" ? (
                <Button onClick={() => setStatusAction("dispatch")}>
                  Dispatch Stock
                </Button>
              ) : null}
              {canUpdate && sale.status !== "dispatched" && sale.status !== "cancelled" ? (
                <Button onClick={() => setStatusAction("cancel")} variant="danger">
                  Cancel Sale
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Customer">
                <DetailItem
                  label="Customer"
                  value={
                    <Link
                      className="font-semibold text-brand-700"
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
                <DetailItem label="GST Number" value={sale.customer?.gst_number ?? "-"} />
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
                      description="Add product line items before confirming this B2B/Direct sale."
                    />
                  </div>
                ) : (
                  <SaleItemsTable items={items} />
                )}
              </section>

              {canViewPayments ? (
                <RelatedPaymentsSection
                  payments={payments}
                  canCreatePayment={
                    canCreatePayments &&
                    Boolean(sale.proforma_invoice_id) &&
                    !sale.invoice_id &&
                    sale.status !== "cancelled"
                  }
                  onAddPayment={() => {
                    setPaymentErrors({});
                    setPaymentForm(emptyB2BPaymentForm());
                  }}
                />
              ) : null}
            </div>

            <B2BSaleTotalsCard sale={sale} />
          </div>
        </>
      ) : null}

      {sale && editing ? (
        <B2BSaleFormModal
          title="Edit B2B/Direct Sale"
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

      {statusAction && sale ? (
        <ConfirmDialog
          title={statusTitle(statusAction)}
          description={statusDescription(statusAction, sale.sale_code)}
          confirmLabel={statusConfirmLabel(statusAction)}
          confirmingLabel="Updating..."
          confirmVariant={statusAction === "cancel" ? "danger" : "primary"}
          confirming={updatingStatus}
          onCancel={() => setStatusAction(null)}
          onConfirm={confirmStatusAction}
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
            title="No B2B/Direct payments"
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

function invoiceLink(sale: B2BSaleWithRelations, canViewInvoices: boolean) {
  if (!sale.invoice_id) {
    return "-";
  }

  if (!canViewInvoices) {
    return sale.invoice?.invoice_code ?? "Invoice created";
  }

  return (
    <Link className="font-semibold text-brand-700" to={`/invoices/${sale.invoice_id}`}>
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
      className="font-semibold text-brand-700"
      to={`/proforma-invoices/${sale.proforma_invoice_id}`}
    >
      {sale.proforma_invoice?.proforma_code ?? "Open proforma"}
    </Link>
  );
}

function statusTitle(action: StatusAction) {
  if (action === "dispatch") {
    return "Dispatch B2B/Direct sale?";
  }

  if (action === "cancel") {
    return "Cancel B2B/Direct sale?";
  }

  return "Confirm B2B/Direct sale?";
}

function statusDescription(action: StatusAction, code: string | null) {
  if (action === "dispatch") {
    return `This will reduce inventory stock for ${code ?? "this B2B/Direct sale"}.`;
  }

  if (action === "cancel") {
    return `This will cancel ${code ?? "this B2B/Direct sale"} before dispatch.`;
  }

  return `This will lock ${code ?? "this B2B/Direct sale"} for invoice and dispatch steps.`;
}

function statusConfirmLabel(action: StatusAction) {
  if (action === "dispatch") {
    return "Dispatch Stock";
  }

  if (action === "cancel") {
    return "Cancel Sale";
  }

  return "Confirm Sale";
}
