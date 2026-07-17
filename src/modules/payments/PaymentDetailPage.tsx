import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  PencilIcon,
  TextArea,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  fetchPayment,
  fetchPaymentProjects,
  updatePayment,
} from "./paymentApi";
import { PaymentFormModal, PaymentStatusBadge } from "./PaymentComponents";
import { paymentToForm, validatePaymentForm } from "./paymentUtils";
import type {
  PaymentFormValues,
  PaymentProjectOption,
  PaymentWithRelations,
} from "./types";
import { cancelPaymentRecord } from "../lifecycle/lifecycleApi";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";

export function PaymentDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [payment, setPayment] = useState<PaymentWithRelations | null>(null);
  const [projects, setProjects] = useState<PaymentProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PaymentFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "payments", "view");
  const canUpdate = hasPermission(profile, permissions, "payments", "update");

  async function loadPayment() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextPayment, nextProjects] = await Promise.all([
        fetchPayment(profile, id),
        fetchPaymentProjects(profile),
      ]);
      setPayment(nextPayment);
      setProjects(nextProjects);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load payment.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayment();
    // loadPayment closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Payment details are not available"
        description="Your role needs payments:view access to open payment details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!payment || !editing) {
      return;
    }

    const nextErrors = validatePaymentForm(editing);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updatePayment(payment.id, editing);
      setEditing(null);
      showToast("Payment updated.", "success");
      await loadPayment();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function openEditForm() {
    if (!payment) {
      return;
    }

    setFormErrors({});
    setEditing(paymentToForm(payment));
  }

  async function handleCancelPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment || !cancelReason?.trim()) return;
    try {
      setCancelling(true);
      await cancelPaymentRecord(payment.id, cancelReason);
      setCancelReason(null);
      showToast("Payment cancelled; linked totals were recalculated.", "success");
      await loadPayment();
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : "Payment cancellation failed.", "error");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/payments">
        Back to payments
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load payment" description={error} /> : null}
      {!loading && !error && !payment ? (
        <EmptyState
          title="Payment not found"
          description="This payment may have been deleted or is outside your organization access."
        />
      ) : null}

      {payment ? (
        <>
          <div className="border-b border-stone-200 pb-5">
            <RecordTitle
              recordType="Payment"
              name={formatMoney(payment.amount)}
              action={
                canUpdate && payment.status === "failed" && !payment.archived_at ? (
                  <button
                    aria-label="Edit payment"
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-stone-50 hover:text-slate-950"
                    onClick={openEditForm}
                    title="Edit payment"
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                ) : null
              }
              meta={[
                paymentContextLabel(payment),
                payment.customer?.business_name ||
                  payment.customer?.full_name ||
                  "Customer",
                labelize(payment.status),
                formatDate(payment.payment_date),
              ]}
            />
          </div>

          <DetailSection title="Payment Details">
            <DetailItem label="Payment Date" value={formatDate(payment.payment_date)} />
            <DetailItem label="Amount" value={formatMoney(payment.amount)} />
            <DetailItem
              label="Payment Source"
              value={labelize(payment.payment_source)}
            />
            <DetailItem label="Payment Mode" value={labelize(payment.payment_mode)} />
            <DetailItem
              label="Status"
              value={<PaymentStatusBadge value={payment.status} />}
            />
            <DetailItem
              label="Reference Number"
              value={payment.reference_number ?? "-"}
            />
          </DetailSection>

          <DetailSection title="Linked Record">
            <DetailItem
              label="Project"
              value={
                payment.project_id ? (
                <Link
                  className="font-semibold text-[#06173f]"
                  to={`/projects/${payment.project_id}`}
                >
                  {payment.project?.project_code ??
                    payment.project?.project_name ??
                    "Open project"}
                </Link>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem
              label="B2B Sale"
              value={
                payment.b2b_sale_id ? (
                  <Link
                    className="font-semibold text-[#06173f]"
                    to={`/b2b-sales/${payment.b2b_sale_id}`}
                  >
                    {payment.b2b_sale?.sale_code ?? "Open B2B sale"}
                  </Link>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem
              label="Proforma Invoice"
              value={
                payment.proforma_invoice_id ? (
                  <Link
                    className="font-semibold text-[#06173f]"
                    to={`/proforma-invoices/${payment.proforma_invoice_id}`}
                  >
                    {payment.proforma_invoice?.proforma_code ??
                      "Open proforma invoice"}
                  </Link>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem
              label="Invoice"
              value={
                payment.invoice_id ? (
                  <Link
                    className="font-semibold text-[#06173f]"
                    to={`/invoices/${payment.invoice_id}`}
                  >
                    {payment.invoice?.invoice_code ?? "Open invoice"}
                  </Link>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem
              label="Customer"
              value={
                <Link
                  className="font-semibold text-[#06173f]"
                  to={`/customers/${payment.customer_id}`}
                >
                  {payment.customer?.business_name ??
                    payment.customer?.full_name ??
                    payment.customer?.customer_code ??
                    "Open customer"}
                </Link>
              }
            />
            <DetailItem
              label="Quotation"
              value={
                payment.quotation_id ? (
                  <Link
                    className="font-semibold text-[#06173f]"
                    to={`/quotations/${payment.quotation_id}`}
                  >
                    {payment.quotation?.quotation_code ?? "Open quotation"}
                  </Link>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem label="Created By" value={createdByName(payment)} />
          </DetailSection>

          <DetailSection title="Bank And Receipt">
            <DetailItem label="Bank Name" value={payment.bank_name ?? "-"} />
            <DetailItem
              label="Loan Account Number"
              value={payment.loan_account_number ?? "-"}
            />
            <DetailItem
              label="Receipt URL"
              value={
                payment.receipt_url ? (
                  <a
                    className="font-semibold text-[#06173f]"
                    href={payment.receipt_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open receipt
                  </a>
                ) : (
                  "-"
                )
              }
            />
            <DetailItem label="Created" value={formatDateTime(payment.created_at)} />
            <DetailItem label="Updated" value={formatDateTime(payment.updated_at)} />
            <DetailItem label="Notes" value={payment.notes ?? "-"} />
          </DetailSection>

          {canUpdate && payment.status === "received" && !payment.archived_at ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-amber-950">Incorrect received payment?</h2>
                  <p className="mt-1 text-sm text-amber-800">Cancel it with a reason. The original record remains immutable and linked totals are recalculated.</p>
                </div>
                <Button onClick={() => setCancelReason("")} variant="danger">Cancel Payment</Button>
              </div>
            </section>
          ) : null}

          <RecordLifecyclePanel
            archiveReason={payment.archive_reason}
            archivedAt={payment.archived_at}
            canDelete={false}
            canUpdate={canUpdate}
            moduleKey="payments"
            onChanged={async (action) => {
              showToast(action === "archive" ? "Payment archived." : "Payment restored.", "success");
              await loadPayment();
            }}
            recordId={payment.id}
            recordLabel={payment.reference_number || `Payment ${payment.id.slice(0, 8)}`}
          />
        </>
      ) : null}

      {editing ? (
        <PaymentFormModal
          title="Edit Payment"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          projects={projects}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {cancelReason !== null ? (
        <Modal
          maxWidthClass="sm:max-w-lg"
          noValidate
          onClose={() => setCancelReason(null)}
          onSubmit={handleCancelPayment}
          submitDisabled={!cancelReason.trim()}
          submitLabel="Cancel Payment"
          submitting={cancelling}
          title="Cancel received payment"
        >
          <div className="md:col-span-2">
            <TextArea className="block" label="Cancellation reason *" onChange={setCancelReason} value={cancelReason} />
            <p className="mt-2 text-xs text-slate-600">This does not delete the payment. Create a new payment if a correction is required.</p>
          </div>
        </Modal>
      ) : null}

    </div>
  );
}

function createdByName(payment: PaymentWithRelations) {
  return (
    payment.created_by_profile?.full_name ??
    payment.created_by_profile?.email ??
    payment.created_by_profile?.phone ??
    "-"
  );
}

function paymentContextLabel(payment: PaymentWithRelations) {
  return (
    payment.project?.project_code ??
    payment.project?.project_name ??
    payment.b2b_sale?.sale_code ??
    payment.proforma_invoice?.proforma_code ??
    payment.invoice?.invoice_code ??
    "Payment"
  );
}
