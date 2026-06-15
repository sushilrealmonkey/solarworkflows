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
import {
  formatDate,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  createPayment,
  deletePayment,
  fetchPaymentProjects,
  fetchPayments,
  updatePayment,
} from "./paymentApi";
import { PaymentFormModal, PaymentStatusBadge } from "./PaymentComponents";
import {
  emptyPaymentForm,
  paymentModeOptions,
  paymentSourceOptions,
  paymentStatusOptions,
  paymentToForm,
  validatePaymentForm,
} from "./paymentUtils";
import type {
  PaymentFormValues,
  PaymentProjectOption,
  PaymentWithRelations,
} from "./types";

type PaymentFilters = {
  search: string;
  source: string;
  mode: string;
  status: string;
  date: string;
};

export function PaymentsPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [projects, setProjects] = useState<PaymentProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PaymentFilters>({
    search: "",
    source: "",
    mode: "",
    status: "",
    date: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    payment: PaymentWithRelations | null;
    values: PaymentFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PaymentWithRelations | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission(profile, permissions, "payments", "view");
  const canCreate = hasPermission(profile, permissions, "payments", "create");
  const canUpdate = hasPermission(profile, permissions, "payments", "update");
  const canDelete = hasPermission(profile, permissions, "payments", "delete");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextPayments, nextProjects] = await Promise.all([
        fetchPayments(profile),
        fetchPaymentProjects(profile),
      ]);
      setPayments(nextPayments);
      setProjects(nextProjects);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load payments.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over payment permissions and the active user profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  const filteredPayments = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesSearch =
        !search ||
        [
          payment.customer?.full_name,
          payment.customer?.business_name,
          payment.customer?.phone,
          payment.customer?.alternate_phone,
          payment.project?.project_code,
          payment.b2b_sale?.sale_code,
          payment.proforma_invoice?.proforma_code,
          payment.invoice?.invoice_code,
          payment.reference_number,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesSource =
        !filters.source || payment.payment_source === filters.source;
      const matchesMode = !filters.mode || payment.payment_mode === filters.mode;
      const matchesStatus = !filters.status || payment.status === filters.status;
      const matchesDate = !filters.date || payment.payment_date === filters.date;

      return (
        matchesSearch &&
        matchesSource &&
        matchesMode &&
        matchesStatus &&
        matchesDate
      );
    });
  }, [payments, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="Payments are not available"
        description="Your role needs payments:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      payment: null,
      values: emptyPaymentForm(),
    });
  }

  function openEditForm(payment: PaymentWithRelations) {
    setFormErrors({});
    setFormState({
      mode: "edit",
      payment,
      values: paymentToForm(payment),
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = validatePaymentForm(formState.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createPayment(profile, formState.values);
        showToast("Payment added.", "success");
      } else if (formState.payment) {
        await updatePayment(formState.payment.id, formState.values);
        showToast("Payment updated.", "success");
      }

      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment save failed.",
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
      await deletePayment(deleteTarget.id);
      setPayments((current) =>
        current.filter((payment) => payment.id !== deleteTarget.id),
      );
      showToast("Payment deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Payments"
          description="Track project receipts from customer payments and loan disbursements."
        />
        {canCreate ? <Button onClick={openCreateForm}>Add Payment</Button> : null}
      </div>

      <Toolbar className="md:grid-cols-4">
        <SearchInput
          className="md:col-span-4"
          placeholder="Search customer, phone, project, or reference"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Payment Source"
          value={filters.source}
          onChange={(source) => setFilters((current) => ({ ...current, source }))}
          options={[
            { value: "", label: "All sources" },
            ...paymentSourceOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Payment Mode"
          value={filters.mode}
          onChange={(mode) => setFilters((current) => ({ ...current, mode }))}
          options={[
            { value: "", label: "All modes" },
            ...paymentModeOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...paymentStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <TextInput
          label="Payment Date"
          type="date"
          value={filters.date}
          onChange={(date) => setFilters((current) => ({ ...current, date }))}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load payments" description={error} /> : null}
      {!loading && !error && filteredPayments.length === 0 ? (
        <EmptyState
          title="No payments found"
          description="Add a payment from a project or use the payment form once a project is ready for receipts."
          action={canCreate ? <Button onClick={openCreateForm}>Add Payment</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredPayments.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm 2xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Payment Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Context</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created By</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3">
                      {formatDate(payment.payment_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {payment.customer?.business_name ||
                          payment.customer?.full_name ||
                          "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {payment.customer?.phone ?? "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {paymentContextLabel(payment)}
                    </td>
                    <td className="px-4 py-3">{labelize(payment.payment_source)}</td>
                    <td className="px-4 py-3">{labelize(payment.payment_mode)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(payment.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {payment.reference_number ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentStatusBadge value={payment.status} />
                    </td>
                    <td className="px-4 py-3">{createdByName(payment)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ViewLink to={`/payments/${payment.id}`}>View</ViewLink>
                        {canUpdate && payment.project_id ? (
                          <Button
                            onClick={() => openEditForm(payment)}
                            variant="secondary"
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            onClick={() => setDeleteTarget(payment)}
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
            {filteredPayments.map((payment) => (
              <article
                key={payment.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(payment.payment_date)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {formatMoney(payment.amount)}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {payment.customer?.business_name ||
                        payment.customer?.full_name ||
                        "-"} / {paymentContextLabel(payment)}
                    </p>
                  </div>
                  <PaymentStatusBadge value={payment.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <PaymentCardItem
                    label="Source"
                    value={labelize(payment.payment_source)}
                  />
                  <PaymentCardItem
                    label="Mode"
                    value={labelize(payment.payment_mode)}
                  />
                  <PaymentCardItem
                    label="Reference"
                    value={payment.reference_number ?? "-"}
                  />
                  <PaymentCardItem label="Created By" value={createdByName(payment)} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ViewLink to={`/payments/${payment.id}`}>View</ViewLink>
                  {canUpdate && payment.project_id ? (
                    <Button onClick={() => openEditForm(payment)} variant="secondary">
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      onClick={() => setDeleteTarget(payment)}
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
        <PaymentFormModal
          title={formState.mode === "create" ? "Add Payment" : "Edit Payment"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          projects={projects}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete payment?"
          description={`This will remove the ${formatMoney(deleteTarget.amount)} payment from ${paymentContextLabel(deleteTarget)}.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
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
    "-"
  );
}

function PaymentCardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
