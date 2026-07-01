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
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
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
import {
  formatDate,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  recordPaletteCardClassName,
  recordPaletteTableRowClassName,
} from "../shared/recordOriginStyles";
import {
  createB2BSale,
  createB2BSalePayment,
  dispatchB2BSale,
  fetchB2BSaleOptions,
  fetchB2BSales,
} from "./b2bSalesApi";
import {
  B2BPaymentFormModal,
  B2BSaleFormModal,
  B2BSaleReviewModal,
  B2BSaleStatusBadge,
} from "./B2BSalesComponents";
import { createCustomer } from "../crm/crmApi";
import { CustomerFormModal } from "../crm/CustomersPage";
import {
  createProformaInvoiceFromB2BSale,
  fetchProformaInvoice,
  fetchProformaInvoiceItems,
} from "../proforma-invoices/proformaInvoiceApi";
import {
  fetchProformaInvoicePdfPreviewUrl,
  generateAndStoreProformaInvoicePdf,
} from "../proforma-invoices/proformaInvoicePdfWorkflow";
import {
  applyCustomerSnapshotToSaleForm,
  b2bSaleStatusOptions,
  emptyB2BPaymentForm,
  emptyB2BSaleForm,
  validateB2BPaymentForm,
  validateB2BSaleForm,
} from "./b2bSalesUtils";
import {
  emptyCustomerFormForSegment,
  normalizeCustomerSubmitValues,
  requiredError,
} from "../crm/crmUtils";
import type { CustomerFormValues } from "../crm/types";
import type {
  B2BPaymentFormValues,
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
  const { profile, permissions, roleNames, organization } = useAuth();
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
  const [reviewValues, setReviewValues] = useState<B2BSaleFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [generatingProforma, setGeneratingProforma] = useState(false);
  const [creatingProformaSaleId, setCreatingProformaSaleId] =
    useState<string | null>(null);
  const [dispatchingSaleId, setDispatchingSaleId] = useState<string | null>(null);
  const [preparingProformaId, setPreparingProformaId] = useState<string | null>(
    null,
  );
  const [paymentForm, setPaymentForm] = useState<{
    sale: B2BSaleWithRelations;
    values: B2BPaymentFormValues;
  } | null>(null);
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});
  const [savingPayment, setSavingPayment] = useState(false);
  const [proformaPdfUrls, setProformaPdfUrls] = useState<Record<string, string>>(
    {},
  );
  const [customerFormValues, setCustomerFormValues] =
    useState<CustomerFormValues | null>(null);
  const [customerFormErrors, setCustomerFormErrors] = useState<Record<string, string>>({});
  const [savingCustomer, setSavingCustomer] = useState(false);

  const canView = hasPermission(profile, permissions, "b2b_sales", "view");
  const canCreate = hasPermission(profile, permissions, "b2b_sales", "create");
  const canUpdate = hasPermission(profile, permissions, "b2b_sales", "update");
  const canCreateInvoices = hasPermission(profile, permissions, "invoices", "create");
  const canCreateDocuments = hasPermission(profile, permissions, "documents", "create");
  const canCreatePayments = hasPermission(profile, permissions, "payments", "create");
  const canDispatchInventory =
    hasPermission(profile, permissions, "inventory", "create") ||
    hasPermission(profile, permissions, "inventory", "update");
  const canCreateCustomers = hasPermission(
    profile,
    permissions,
    "customers",
    "create",
  );
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
    const customer = options.customers.find(
      (option) => option.id === linkedCustomerId,
    );
    const values = {
      ...emptyB2BSaleForm(),
      customer_id: linkedCustomerId,
    };

    setFormState({
      values: customer
        ? applyCustomerSnapshotToSaleForm(values, customer, { overwrite: true })
        : values,
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

  const salePagination = useTablePagination(filteredSales);
  const paginatedSales = salePagination.pageItems;

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

    try {
      const nextOptions = await refreshOptions();
      setFormState({
        values: saleFormForCustomerId(filters.customerId, nextOptions),
      });
    } catch (nextError) {
      setFormState({
        values: saleFormForCustomerId(filters.customerId, options),
      });
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

  function openBusinessCustomerForm() {
    setCustomerFormErrors({});
    setCustomerFormValues(emptyCustomerFormForSegment("b2b_direct"));
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = validateB2BSaleForm(formState.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    setReviewValues(formState.values);
    setFormState(null);
  }

  async function saveReviewedSale(values: B2BSaleFormValues) {
    const nextErrors = validateB2BSaleForm(values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setReviewValues(null);
      setFormState({ values });
      return null;
    }

    try {
      setSaving(true);
      const sale = await createB2BSale(profile, values);
      showToast("Sales order created.", "success");
      setReviewValues(null);
      await loadData();
      return sale;
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Sales order save failed.",
        "error",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    if (!reviewValues) {
      return;
    }

    await saveReviewedSale(reviewValues);
  }

  async function handleGenerateProforma() {
    if (!reviewValues) {
      return;
    }

    if (!canCreateInvoices) {
      showToast("Your role needs invoices:create access to generate a proforma invoice.", "error");
      return;
    }

    if (!canCreateDocuments) {
      showToast("Your role needs documents:create access to generate the proforma PDF.", "error");
      return;
    }

    try {
      setGeneratingProforma(true);
      const sale = await saveReviewedSale(reviewValues);

      if (!sale) {
        return;
      }

      const proformaSummary = await createProformaInvoiceFromB2BSale(sale.id);
      const [proformaInvoice, proformaItems] = await Promise.all([
        fetchProformaInvoice(profile, proformaSummary.id),
        fetchProformaInvoiceItems(profile, proformaSummary.id),
      ]);

      if (!proformaInvoice) {
        throw new Error("Proforma invoice was created but could not be loaded.");
      }

      await generateAndStoreProformaInvoicePdf(
        profile,
        organization,
        proformaInvoice,
        proformaItems,
      );

      showToast("Proforma invoice and PDF generated.", "success");
      navigate(`/proforma-invoices/${proformaInvoice.id}`);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice generation failed.",
        "error",
      );
    } finally {
      setGeneratingProforma(false);
    }
  }

  async function handleCreateProformaFromSale(sale: B2BSaleWithRelations) {
    if (!canCreateInvoices) {
      return;
    }

    try {
      setCreatingProformaSaleId(sale.id);
      const proformaSummary = await createProformaInvoiceFromB2BSale(sale.id);
      let pdfGenerated = false;

      if (canCreateDocuments) {
        try {
          await prepareProformaPdf(proformaSummary.id);
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
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Proforma invoice creation failed.",
        "error",
      );
    } finally {
      setCreatingProformaSaleId(null);
    }
  }

  async function handleDownloadProforma(sale: B2BSaleWithRelations) {
    if (!sale.proforma_invoice_id) {
      return;
    }

    const knownUrl = proformaPdfUrls[sale.proforma_invoice_id];
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
      setPreparingProformaId(sale.proforma_invoice_id);
      const previewUrl = await prepareProformaPdf(sale.proforma_invoice_id);
      if (previewUrl) {
        window.open(previewUrl, "_blank", "noreferrer");
      }
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

  async function prepareProformaPdf(proformaInvoiceId: string) {
    const proformaInvoice = await fetchProformaInvoice(profile, proformaInvoiceId);

    if (!proformaInvoice) {
      throw new Error("Proforma invoice could not be loaded.");
    }

    const existingUrl = await fetchProformaInvoicePdfPreviewUrl(proformaInvoice);
    if (existingUrl) {
      setProformaPdfUrls((current) => ({
        ...current,
        [proformaInvoice.id]: existingUrl,
      }));
      return existingUrl;
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
    return result.previewUrl;
  }

  async function handleDispatchStock(sale: B2BSaleWithRelations) {
    try {
      setDispatchingSaleId(sale.id);
      await dispatchB2BSale(sale.id);
      showToast("Sales order stock dispatched.", "success");
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Stock dispatch failed.",
        "error",
      );
    } finally {
      setDispatchingSaleId(null);
    }
  }

  function openPaymentForm(sale: B2BSaleWithRelations) {
    setPaymentErrors({});
    setPaymentForm({
      sale,
      values: emptyB2BPaymentForm(),
    });
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!paymentForm) {
      return;
    }

    const nextErrors = validateB2BPaymentForm(paymentForm.values);
    setPaymentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createB2BSalePayment(profile, paymentForm.sale, paymentForm.values);
      setPaymentForm(null);
      showToast("Payment added.", "success");
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

  async function handleBusinessCustomerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerFormValues) {
      return;
    }

    const nextErrors = {
      business_name: requiredError(customerFormValues.business_name, "Business name"),
      contact_person_name: requiredError(
        customerFormValues.contact_person_name,
        "Contact person",
      ),
      phone: requiredError(customerFormValues.phone, "Phone"),
    };
    setCustomerFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingCustomer(true);
      const createdCustomer = await createCustomer(
        profile,
        normalizeCustomerSubmitValues(customerFormValues, "b2b_direct"),
      );

      setOptions((current) => ({
        ...current,
        customers: current.customers.some(
          (customer) => customer.id === createdCustomer.id,
        )
          ? current.customers
          : [createdCustomer, ...current.customers],
      }));
      setFormState((current) =>
        current
          ? {
              ...current,
              values: applyCustomerSnapshotToSaleForm(
                current.values,
                createdCustomer,
                { overwrite: true },
              ),
            }
          : current,
      );
      setFilters((current) => ({ ...current, customerId: createdCustomer.id }));
      setCustomerFormValues(null);
      showToast("Business customer created.", "success");

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
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Business customer save failed.",
        "error",
      );
    } finally {
      setSavingCustomer(false);
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
                  <th className="px-4 py-3 text-right">Next Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className={`cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteTableRowClassName("b2bFlow")}`}
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
                    <td className="px-4 py-3">
                      <B2BSaleNextStepActions
                        canAddPayment={
                          canCreatePayments && canAddB2BPayment(sale)
                        }
                        canCreateProforma={canCreateInvoices}
                        canDispatch={
                          canUpdate &&
                          canDispatchInventory &&
                          sale.status !== "dispatched" &&
                          sale.status !== "cancelled"
                        }
                        creatingProforma={creatingProformaSaleId === sale.id}
                        dispatching={dispatchingSaleId === sale.id}
                        downloadUrl={
                          sale.proforma_invoice_id
                            ? proformaPdfUrls[sale.proforma_invoice_id]
                            : undefined
                        }
                        hasProforma={Boolean(sale.proforma_invoice_id)}
                        preparing={
                          Boolean(sale.proforma_invoice_id) &&
                          preparingProformaId === sale.proforma_invoice_id
                        }
                        onAddPayment={() => openPaymentForm(sale)}
                        onCreateProforma={() => void handleCreateProformaFromSale(sale)}
                        onDispatch={() => void handleDispatchStock(sale)}
                        onDownload={() => void handleDownloadProforma(sale)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedSales.map((sale) => (
              <article
                key={sale.id}
                className={`cursor-pointer rounded-xl border p-4 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${recordPaletteCardClassName("b2bFlow")}`}
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
                <div className="mt-4">
                  <B2BSaleNextStepActions
                    canAddPayment={canCreatePayments && canAddB2BPayment(sale)}
                    canCreateProforma={canCreateInvoices}
                    canDispatch={
                      canUpdate &&
                      canDispatchInventory &&
                      sale.status !== "dispatched" &&
                      sale.status !== "cancelled"
                    }
                    creatingProforma={creatingProformaSaleId === sale.id}
                    dispatching={dispatchingSaleId === sale.id}
                    downloadUrl={
                      sale.proforma_invoice_id
                        ? proformaPdfUrls[sale.proforma_invoice_id]
                        : undefined
                    }
                    hasProforma={Boolean(sale.proforma_invoice_id)}
                    preparing={
                      Boolean(sale.proforma_invoice_id) &&
                      preparingProformaId === sale.proforma_invoice_id
                    }
                    onAddPayment={() => openPaymentForm(sale)}
                    onCreateProforma={() => void handleCreateProformaFromSale(sale)}
                    onDispatch={() => void handleDispatchStock(sale)}
                    onDownload={() => void handleDownloadProforma(sale)}
                  />
                </div>
              </article>
            ))}
          </div>
          <TablePagination label="sales orders" pagination={salePagination} />
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
          onCreateBusinessCustomer={
            canCreateCustomers ? openBusinessCustomerForm : undefined
          }
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
          submitLabel="Review Sales Order"
        />
      ) : null}

      {reviewValues ? (
        <B2BSaleReviewModal
          values={reviewValues}
          options={options}
          onEdit={() => {
            setFormState({ values: reviewValues });
            setReviewValues(null);
          }}
          onClose={() => setReviewValues(null)}
          onSaveDraft={() => void handleSaveDraft()}
          onGenerateProforma={() => void handleGenerateProforma()}
          saving={saving}
          generating={generatingProforma}
        />
      ) : null}

      {customerFormValues ? (
        <CustomerFormModal
          title="Add Business Customer"
          segment="b2b_direct"
          source="direct"
          leadId=""
          leads={[]}
          values={customerFormValues}
          setLeadId={() => undefined}
          setValues={setCustomerFormValues}
          errors={customerFormErrors}
          staff={[]}
          onClose={() => setCustomerFormValues(null)}
          onSubmit={handleBusinessCustomerSubmit}
          saving={savingCustomer}
        />
      ) : null}

      {paymentForm ? (
        <B2BPaymentFormModal
          values={paymentForm.values}
          setValues={(values) =>
            setPaymentForm((current) => (current ? { ...current, values } : current))
          }
          errors={paymentErrors}
          onClose={() => setPaymentForm(null)}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
        />
      ) : null}
    </div>
  );
}

function saleFormForCustomerId(
  customerId: string,
  options: B2BSaleOptions,
): B2BSaleFormValues {
  const values = {
    ...emptyB2BSaleForm(),
    customer_id: customerId,
  };
  const customer = options.customers.find((option) => option.id === customerId);

  return customer
    ? applyCustomerSnapshotToSaleForm(values, customer, { overwrite: true })
    : values;
}

function CardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function B2BSaleNextStepActions({
  canAddPayment,
  canCreateProforma,
  canDispatch,
  creatingProforma,
  dispatching,
  downloadUrl,
  hasProforma,
  preparing,
  onAddPayment,
  onCreateProforma,
  onDispatch,
  onDownload,
}: {
  canAddPayment: boolean;
  canCreateProforma: boolean;
  canDispatch: boolean;
  creatingProforma: boolean;
  dispatching: boolean;
  downloadUrl: string | undefined;
  hasProforma: boolean;
  preparing: boolean;
  onAddPayment: () => void;
  onCreateProforma: () => void;
  onDispatch: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className="flex flex-col items-stretch gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {!hasProforma && canCreateProforma ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={creatingProforma}
          onClick={onCreateProforma}
          type="button"
        >
          {creatingProforma ? "Creating Proforma" : "Create Proforma"}
        </button>
      ) : hasProforma && downloadUrl ? (
        <a
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
          download
          href={downloadUrl}
          rel="noreferrer"
          target="_blank"
        >
          Download Proforma
        </a>
      ) : hasProforma && canCreateProforma ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={preparing}
          onClick={onDownload}
          type="button"
        >
          {preparing ? "Preparing Proforma" : "Download Proforma"}
        </button>
      ) : (
        <PlaceholderAction>Create Proforma</PlaceholderAction>
      )}

      {canAddPayment ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
          onClick={onAddPayment}
          type="button"
        >
          Add Payment
        </button>
      ) : null}

      {canDispatch ? (
        <button
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={dispatching}
          onClick={onDispatch}
          type="button"
        >
          {dispatching ? "Dispatching Stock" : "Dispatch Stock"}
        </button>
      ) : (
        <PlaceholderAction>Dispatch Stock</PlaceholderAction>
      )}
    </div>
  );
}

function canAddB2BPayment(sale: B2BSaleWithRelations) {
  return (
    Boolean(sale.proforma_invoice_id) &&
    !sale.invoice_id &&
    sale.status !== "cancelled" &&
    Number(sale.proforma_invoice?.balance_due ?? 0) > 0
  );
}
