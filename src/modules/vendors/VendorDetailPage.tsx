import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Badge,
  Button,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import {
  createVendorCategory,
  fetchVendor,
  fetchVendorCategories,
  updateVendor,
} from "./vendorApi";
import {
  formatVendorAddress,
  validateVendorForm,
  vendorToForm,
} from "./vendorUtils";
import { VendorFormModal, VendorStatusBadge } from "./VendorsPage";
import type { Vendor, VendorCategory, VendorFormValues } from "./types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import { fetchExpenses } from "../expenses/expenseApi";
import type { VendorExpenseWithRelations } from "../expenses/types";
import { formatExpenseCurrency, todayInputValue } from "../expenses/expenseUtils";

export function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const listPath = "/vendors";
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [expenses, setExpenses] = useState<VendorExpenseWithRelations[]>([]);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VendorFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");
  const canDelete = hasPermission(profile, permissions, "vendors", "delete");
  const canViewExpenses = hasPermission(profile, permissions, "expenses", "view");

  async function loadVendor() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextVendor, nextExpenses, nextCategories] = await Promise.all([
        fetchVendor(profile, id),
        canViewExpenses ? fetchExpenses(profile, { vendorId: id }) : Promise.resolve([]),
        fetchVendorCategories(profile),
      ]);
      setVendor(nextVendor);
      setExpenses(nextExpenses);
      setCategories(nextCategories);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load vendor.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVendor();
    // loadVendor closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewExpenses, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Vendor details are not available"
        description="Your role needs vendors:view access to open vendor details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!vendor || !editing) {
      return;
    }

    const nextErrors = validateVendorForm(editing);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateVendor(vendor.id, editing);
      setEditing(null);
      showToast("Vendor updated.", "success");
      await loadVendor();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Vendor update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to={listPath}>
        Back to vendors
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load vendor" description={error} /> : null}
      {!loading && !error && !vendor ? (
        <EmptyState
          title="Vendor not found"
          description="This vendor may have been deleted or is outside your company access."
        />
      ) : null}

      {vendor ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={vendor.vendor_name}
              description={`${vendor.vendor_code ?? "Vendor"} / ${vendor.category?.name ?? "Uncategorized"}`}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate && !vendor.archived_at ? (
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(vendorToForm(vendor));
                  }}
                  variant="secondary"
                >
                  Edit Vendor
                </Button>
              ) : null}
            </div>
          </div>

          <DetailSection title="Vendor Details">
            <DetailItem label="Vendor Code" value={vendor.vendor_code ?? "-"} />
            <DetailItem label="Status" value={<VendorStatusBadge value={vendor.status} />} />
            <DetailItem label="Category" value={vendor.category?.name ?? "-"} />
            <DetailItem label="Preferred Payment" value={labelize(vendor.preferred_payment_method)} />
            <DetailItem label="Payment Terms" value={vendor.payment_terms_days == null ? "-" : `${vendor.payment_terms_days} days`} />
            <DetailItem label="Created" value={formatDate(vendor.created_at)} />
            <DetailItem label="Notes" value={vendor.notes ?? "-"} />
          </DetailSection>

          {canViewExpenses ? (
            <VendorExpensesSection
              currency={organization.currency}
              expenses={expenses}
            />
          ) : null}

          <DetailSection title="Contact">
            <DetailItem label="Contact Person" value={vendor.contact_person ?? "-"} />
            <DetailItem label="Phone" value={vendor.phone ?? "-"} />
            <DetailItem label="Alternate Phone" value={vendor.alternate_phone ?? "-"} />
            <DetailItem label="Email" value={vendor.email ?? "-"} />
          </DetailSection>

          <DetailSection title="Tax And Address">
            <DetailItem label="GST Number" value={vendor.gst_number ?? "-"} />
            <DetailItem label="PAN Number" value={vendor.pan_number ?? "-"} />
            <DetailItem
              label="Address"
              value={formatVendorAddress(vendor) || "-"}
            />
          </DetailSection>

          <RecordLifecyclePanel
            archiveReason={vendor.archive_reason}
            archivedAt={vendor.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="vendors"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Vendor permanently deleted.", "success");
                navigate(listPath);
                return;
              }
              showToast(action === "archive" ? "Vendor archived." : "Vendor restored.", "success");
              await loadVendor();
            }}
            recordId={vendor.id}
            recordLabel={vendor.vendor_code || vendor.vendor_name}
          />
        </>
      ) : null}

      {editing ? (
        <VendorFormModal
          title="Edit Vendor"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
          categories={categories}
          onCreateCategory={async (name) => {
            const category = await createVendorCategory(profile, name);
            setCategories((current) =>
              [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
            );
            return category;
          }}
        />
      ) : null}

    </div>
  );
}

function VendorExpensesSection({
  expenses,
  currency,
}: {
  expenses: VendorExpenseWithRelations[];
  currency: string;
}) {
  const paid = expenses
    .filter((expense) => expense.payment_status === "paid")
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const due = expenses
    .filter((expense) => expense.payment_status === "due")
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Expense History</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paid {formatExpenseCurrency(paid, currency)} · Outstanding {formatExpenseCurrency(due, currency)}
          </p>
        </div>
        <Link className="text-sm font-semibold text-[#06173f]" to="/expenses">
          Open expenses
        </Link>
      </div>
      {expenses.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No expenses recorded for this vendor.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Purpose</th><th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Status</th><th className="py-2">Due / Paid</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {expenses.slice(0, 10).map((expense) => {
                const overdue = expense.payment_status === "due" && Boolean(expense.due_date && expense.due_date < todayInputValue());
                return (
                  <tr key={expense.id}>
                    <td className="whitespace-nowrap py-3 pr-4">{formatDate(expense.expense_date)}</td>
                    <td className="py-3 pr-4">{expense.description}</td>
                    <td className="whitespace-nowrap py-3 pr-4 font-semibold">{formatExpenseCurrency(expense.amount, currency)}</td>
                    <td className="py-3 pr-4"><Badge tone={expense.payment_status === "paid" ? "green" : overdue ? "red" : "amber"}>{overdue ? "Overdue" : labelize(expense.payment_status)}</Badge></td>
                    <td className="whitespace-nowrap py-3">{formatDate(expense.payment_status === "paid" ? expense.paid_date : expense.due_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
