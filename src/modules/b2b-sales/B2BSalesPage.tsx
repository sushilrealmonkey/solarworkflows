import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import {
  formatDate,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  createB2BSale,
  deleteB2BSale,
  fetchB2BSaleItems,
  fetchB2BSaleOptions,
  fetchB2BSales,
  updateB2BSale,
} from "./b2bSalesApi";
import { B2BSaleFormModal, B2BSaleStatusBadge } from "./B2BSalesComponents";
import {
  b2bSaleStatusOptions,
  emptyB2BSaleForm,
  saleToForm,
  validateB2BSaleForm,
} from "./b2bSalesUtils";
import type {
  B2BSaleFormValues,
  B2BSaleOptions,
  B2BSaleWithRelations,
} from "./types";

type B2BSaleFilters = {
  search: string;
  status: string;
  customerId: string;
  saleDate: string;
};

export function B2BSalesPage() {
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const handledCreateParamRef = useRef("");
  const [sales, setSales] = useState<B2BSaleWithRelations[]>([]);
  const [options, setOptions] = useState<B2BSaleOptions>({
    customers: [],
    inventoryItems: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<B2BSaleFilters>({
    search: "",
    status: "",
    customerId: "",
    saleDate: "",
  });
  const [formState, setFormState] = useState<{
    mode: "create" | "edit";
    sale: B2BSaleWithRelations | null;
    values: B2BSaleFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<B2BSaleWithRelations | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission(profile, permissions, "b2b_sales", "view");
  const canCreate = hasPermission(profile, permissions, "b2b_sales", "create");
  const canUpdate = hasPermission(profile, permissions, "b2b_sales", "update");
  const canDelete = hasPermission(profile, permissions, "b2b_sales", "delete");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );
  const linkedCustomerId = searchParams.get("customerId") ?? "";
  const shouldOpenNewSale = searchParams.get("new") === "1";

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextSales, nextOptions] = await Promise.all([
        fetchB2BSales(profile),
        fetchB2BSaleOptions(profile, canViewPricing),
      ]);
      setSales(nextSales);
      setOptions(nextOptions);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load B2B/Direct sales.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over permissions, role names, and the active profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, profile?.id]);

  useEffect(() => {
    if (!linkedCustomerId) {
      return;
    }

    setFilters((current) =>
      current.customerId === linkedCustomerId
        ? current
        : { ...current, customerId: linkedCustomerId },
    );
  }, [linkedCustomerId]);

  useEffect(() => {
    if (!shouldOpenNewSale || !linkedCustomerId || !canCreate) {
      return;
    }

    const createKey = `${linkedCustomerId}:${profile?.id ?? "anonymous"}`;

    if (handledCreateParamRef.current === createKey) {
      return;
    }

    const customerExists = options.customers.some(
      (customer) => customer.id === linkedCustomerId,
    );

    if (!customerExists) {
      return;
    }

    handledCreateParamRef.current = createKey;
    setFormErrors({});
    setFormState({
      mode: "create",
      sale: null,
      values: {
        ...emptyB2BSaleForm(),
        customer_id: linkedCustomerId,
      },
    });
  }, [
    canCreate,
    linkedCustomerId,
    options.customers,
    profile?.id,
    shouldOpenNewSale,
  ]);

  const filteredSales = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return sales.filter((sale) => {
      const customerName =
        sale.customer?.business_name || sale.customer?.full_name || "";
      const matchesSearch =
        !search ||
        [
          sale.sale_code,
          customerName,
          sale.customer?.phone,
          sale.proforma_invoice?.proforma_code,
          sale.invoice?.invoice_code,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || sale.status === filters.status;
      const matchesCustomer =
        !filters.customerId || sale.customer_id === filters.customerId;
      const matchesSaleDate =
        !filters.saleDate || sale.sale_date === filters.saleDate;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesCustomer &&
        matchesSaleDate
      );
    });
  }, [sales, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="B2B/Direct sales are not available"
        description="Your role needs b2b_sales:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      sale: null,
      values: {
        ...emptyB2BSaleForm(),
        customer_id: filters.customerId,
      },
    });
  }

  async function openEditForm(sale: B2BSaleWithRelations) {
    try {
      const items = await fetchB2BSaleItems(profile, sale.id);
      setFormErrors({});
      setFormState({
        mode: "edit",
        sale,
        values: saleToForm(sale, items),
      });
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load sale items.",
        "error",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = validateB2BSaleForm(formState.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createB2BSale(profile, formState.values);
        showToast("B2B/Direct sale created.", "success");
      } else if (formState.sale) {
        await updateB2BSale(formState.sale.id, formState.values, {
          deleteMissingItems: canDelete,
        });
        showToast("B2B/Direct sale updated.", "success");
      }

      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "B2B/Direct sale save failed.",
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
      await deleteB2BSale(deleteTarget.id);
      setSales((current) => current.filter((sale) => sale.id !== deleteTarget.id));
      showToast("B2B/Direct sale deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "B2B/Direct sale delete failed.",
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
          title="B2B/Direct Sales"
          description="Sell individual or bulk products to B2B/Direct customers without creating a project."
        />
        {canCreate ? <Button onClick={openCreateForm}>Create B2B/Direct Sale</Button> : null}
      </div>

      <Toolbar className="md:grid-cols-4">
        <SearchInput
          className="md:col-span-4"
          placeholder="Search sale, customer, phone, or invoice"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...b2bSaleStatusOptions.map((status) => ({
              value: status,
              label: labelize(status),
            })),
          ]}
        />
        <SelectInput
          label="Customer"
          value={filters.customerId}
          onChange={(customerId) =>
            setFilters((current) => ({ ...current, customerId }))
          }
          options={[
            { value: "", label: "All customers" },
            ...options.customers.map((customer) => ({
              value: customer.id,
              label: customer.business_name || customer.full_name,
            })),
          ]}
        />
        <TextInput
          label="Sale Date"
          type="date"
          value={filters.saleDate}
          onChange={(saleDate) =>
            setFilters((current) => ({ ...current, saleDate }))
          }
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load B2B/Direct sales" description={error} /> : null}
      {!loading && !error && filteredSales.length === 0 ? (
        <EmptyState
          title="No B2B/Direct sales found"
          description="Create a sale for an active B2B/Direct customer, then add product line items."
          action={
            canCreate ? <Button onClick={openCreateForm}>Create B2B/Direct Sale</Button> : null
          }
        />
      ) : null}

      {!loading && !error && filteredSales.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Sale</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Sale Date</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Final Invoice</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredSales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {sale.sale_code ?? "B2B/Direct Sale"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {sale.customer?.business_name ||
                          sale.customer?.full_name ||
                          "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {sale.customer?.phone ?? "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3">{formatDate(sale.sale_date)}</td>
                    <td className="px-4 py-3">
                      {sale.proforma_invoice?.proforma_code ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {sale.invoice?.invoice_code ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatMoney(sale.total_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <B2BSaleStatusBadge value={sale.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ViewLink to={`/b2b-sales/${sale.id}`}>View</ViewLink>
                        {canUpdate && sale.status !== "dispatched" ? (
                          <Button
                            onClick={() => void openEditForm(sale)}
                            variant="secondary"
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete && sale.status !== "dispatched" ? (
                          <Button
                            onClick={() => setDeleteTarget(sale)}
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

          <div className="grid gap-3 xl:hidden">
            {filteredSales.map((sale) => (
              <article
                key={sale.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(sale.sale_date)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {sale.sale_code ?? "B2B/Direct Sale"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {sale.customer?.business_name ||
                        sale.customer?.full_name ||
                        "-"}
                    </p>
                  </div>
                  <B2BSaleStatusBadge value={sale.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <CardItem label="Total" value={formatMoney(sale.total_amount)} />
                  <CardItem
                    label="Proforma"
                    value={sale.proforma_invoice?.proforma_code ?? "-"}
                  />
                  <CardItem
                    label="Invoice"
                    value={sale.invoice?.invoice_code ?? "-"}
                  />
                  <CardItem label="Phone" value={sale.customer?.phone ?? "-"} />
                  <CardItem
                    label="Dispatch"
                    value={formatDate(sale.dispatch_date)}
                  />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ViewLink to={`/b2b-sales/${sale.id}`}>View</ViewLink>
                  {canUpdate && sale.status !== "dispatched" ? (
                    <Button
                      onClick={() => void openEditForm(sale)}
                      variant="secondary"
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDelete && sale.status !== "dispatched" ? (
                    <Button onClick={() => setDeleteTarget(sale)} variant="danger">
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
        <B2BSaleFormModal
          title={formState.mode === "create" ? "Create B2B/Direct Sale" : "Edit B2B/Direct Sale"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          options={options}
          canRemoveItems={formState.mode === "create" || canDelete}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete B2B/Direct sale?"
          description={`This will remove ${deleteTarget.sale_code ?? "this B2B/Direct sale"} and its item rows.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function CardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
