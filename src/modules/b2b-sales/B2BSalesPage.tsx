import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
  TextInput,
  Toolbar,
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
  fetchB2BSaleOptions,
  fetchB2BSales,
} from "./b2bSalesApi";
import { B2BSaleFormModal, B2BSaleStatusBadge } from "./B2BSalesComponents";
import {
  b2bSaleStatusOptions,
  emptyB2BSaleForm,
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
  const navigate = useNavigate();
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
    values: B2BSaleFormValues;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "b2b_sales", "view");
  const canCreate = hasPermission(profile, permissions, "b2b_sales", "create");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );
  const linkedCustomerId = searchParams.get("customerId") ?? "";
  const shouldOpenNewSale = searchParams.get("new") === "1";

  async function refreshOptions() {
    const nextOptions = await fetchB2BSaleOptions(profile, canViewPricing);
    setOptions(nextOptions);
    return nextOptions;
  }

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
          : "Unable to load sales orders.",
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
        title="Sales orders are not available"
        description="Your role needs b2b_sales:view access to open this module."
      />
    );
  }

  async function openCreateForm() {
    setFormErrors({});
    setFormState({
      values: {
        ...emptyB2BSaleForm(),
        customer_id: filters.customerId,
      },
    });

    try {
      await refreshOptions();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to refresh business customers.",
        "error",
      );
    }
  }

  function openSaleDetail(saleId: string) {
    navigate(`/b2b-sales/${saleId}`);
  }

  function handleSaleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    saleId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSaleDetail(saleId);
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
      await createB2BSale(profile, formState.values);
      showToast("Sales order created.", "success");
      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Sales order save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Sales Orders"
          description="Sell individual or bulk products to business customers without creating a project."
        />
        {canCreate ? <Button onClick={openCreateForm}>Create Sales Order</Button> : null}
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
      {error ? <EmptyState title="Could not load sales orders" description={error} /> : null}
      {!loading && !error && filteredSales.length === 0 ? (
        <EmptyState
          title="No sales orders found"
          description="Create a sales order for an active business customer, then add product line items."
          action={
            canCreate ? <Button onClick={openCreateForm}>Create Sales Order</Button> : null
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
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                    onClick={() => openSaleDetail(sale.id)}
                    onKeyDown={(event) => handleSaleRowKeyDown(event, sale.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {sale.sale_code ?? "Sales Order"}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {filteredSales.map((sale) => (
              <article
                key={sale.id}
                className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                onClick={() => openSaleDetail(sale.id)}
                onKeyDown={(event) => handleSaleRowKeyDown(event, sale.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(sale.sale_date)}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {sale.sale_code ?? "Sales Order"}
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
              </article>
            ))}
          </div>
        </>
      ) : null}

      {formState ? (
        <B2BSaleFormModal
          title="Create Sales Order"
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          options={options}
          canRemoveItems
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
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
