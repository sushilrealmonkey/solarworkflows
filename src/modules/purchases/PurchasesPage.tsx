import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  PlaceholderAction,
  SearchInput,
  SelectInput,
  TextArea,
  TextInput,
  Toolbar,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { fetchInventoryItems } from "../inventory/inventoryApi";
import {
  formatCurrency,
  formatStock,
  inventoryProductName,
} from "../inventory/inventoryUtils";
import type { InventoryItem } from "../inventory/types";
import type { Vendor } from "../vendors/types";
import {
  createPurchaseOrder,
  fetchPurchaseOrder,
  fetchPurchasePriceDefaults,
  fetchPurchaseVendorOptions,
  fetchPurchaseOrders,
  receivePurchaseOrderItems,
} from "./purchaseApi";
import {
  calculatePurchaseItemTotal,
  calculatePurchaseTotals,
  emptyPurchaseItemForm,
  emptyPurchaseOrderForm,
  emptyPurchaseReceiveForm,
  formatPurchaseCode,
  hasPurchaseOrderFormErrors,
  hasPurchaseReceiveFormErrors,
  purchaseStatusOptions,
  validatePurchaseOrderForm,
  validatePurchaseReceiveForm,
} from "./purchaseUtils";
import {
  fetchPurchaseOrderPdfPreviewUrl,
  generateAndStorePurchaseOrderPdf,
} from "./purchasePdfWorkflow";
import type {
  PurchaseOrderFormValues,
  PurchaseOrderItemFormValues,
  PurchaseReceiveFormValues,
  PurchaseReceiveItemFormValues,
  PurchaseOrderWithRelations,
  PurchaseStatus,
} from "./types";

type PurchaseFilters = {
  search: string;
  status: string;
  vendorId: string;
  pendingReceive: boolean;
};

type PurchaseFormErrors = ReturnType<typeof validatePurchaseOrderForm>;
type PurchaseReceiveFormErrors = ReturnType<typeof validatePurchaseReceiveForm>;
type PurchaseVendorOption = Pick<
  Vendor,
  "id" | "vendor_code" | "vendor_name" | "contact_person" | "phone"
>;

export function PurchasesPage() {
  const { profile, permissions, roleNames, organization } = useAuth();
  const { showToast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrderWithRelations[]>([]);
  const [purchasePdfUrls, setPurchasePdfUrls] = useState<Record<string, string>>({});
  const [vendors, setVendors] = useState<PurchaseVendorOption[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [priceDefaults, setPriceDefaults] = useState(
    new Map<string, { current_purchase_price: number | null; gst_percent: number | null }>(),
  );
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PurchaseFilters>({
    search: "",
    status: "",
    vendorId: "",
    pendingReceive: false,
  });
  const [form, setForm] = useState<PurchaseOrderFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<PurchaseFormErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiveTarget, setReceiveTarget] =
    useState<PurchaseOrderWithRelations | null>(null);
  const [receiveForm, setReceiveForm] = useState<PurchaseReceiveFormValues | null>(
    null,
  );
  const [receiveFormErrors, setReceiveFormErrors] =
    useState<PurchaseReceiveFormErrors | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [preparingPurchasePdfId, setPreparingPurchasePdfId] = useState<string | null>(
    null,
  );

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );
  const canCreatePricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "create",
  );
  const canCreateItems = hasPermission(
    profile,
    permissions,
    "inventory",
    "create",
  );
  const canCreate = canCreateItems && canCreatePricing;
  const canDelete = hasPermission(
    profile,
    permissions,
    "inventory",
    "delete",
  );
  const canReceive =
    hasPermission(profile, permissions, "inventory", "create") &&
    hasPermission(profile, permissions, "inventory", "update");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canDownloadPurchasePdf = canCreateDocuments && canViewPricing;

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextOrders, nextVendors, nextItems] = await Promise.all([
        fetchPurchaseOrders(profile, undefined, { includePricing: canViewPricing, archiveScope }),
        fetchPurchaseVendorOptions(),
        fetchInventoryItems(profile),
      ]);
      setOrders(nextOrders);
      setVendors(nextVendors);
      setItems(nextItems);
      if (canDownloadPurchasePdf && nextOrders.length > 0) {
        const pdfEntries = await Promise.all(
          nextOrders.map(async (order) => {
            try {
              return [order.id, await fetchPurchaseOrderPdfPreviewUrl(order)] as const;
            } catch {
              return [order.id, null] as const;
            }
          }),
        );
        setPurchasePdfUrls(
          Object.fromEntries(
            pdfEntries.filter(
              (entry): entry is readonly [string, string] => Boolean(entry[1]),
            ),
          ),
        );
      } else {
        setPurchasePdfUrls({});
      }
      setPriceDefaults(
        canViewPricing ? await fetchPurchasePriceDefaults(nextItems) : new Map(),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load purchase orders.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveScope, canView, canViewPricing, profile?.id]);

  const filteredOrders = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return orders.filter((order) => {
      const matchesPendingReceive =
        !filters.pendingReceive || isReceivablePurchaseOrder(order);
      const matchesSearch =
        !search ||
        [
          order.purchase_code,
          order.vendor?.vendor_name,
          order.vendor?.vendor_code,
          order.vendor?.phone,
          ...(order.items ?? []).map((item) => item.item?.item_name),
          ...(order.items ?? []).map((item) => item.item?.item_code),
          ...(order.items ?? []).map((item) => item.item?.brand),
          ...(order.items ?? []).map((item) => item.item?.model),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || order.status === filters.status;
      const matchesVendor = !filters.vendorId || order.vendor_id === filters.vendorId;

      return matchesPendingReceive && matchesSearch && matchesStatus && matchesVendor;
    });
  }, [orders, filters]);

  const pendingReceiveCount = useMemo(
    () => orders.filter(isReceivablePurchaseOrder).length,
    [orders],
  );

  if (!canView) {
    return (
      <AccessDenied
        title="Purchase orders are not available"
        description="Your role needs inventory:view access to open purchase order tracking."
      />
    );
  }

  async function openCreateForm() {
    try {
      setVendors(await fetchPurchaseVendorOptions());
      setFormErrors(null);
      setForm(emptyPurchaseOrderForm());
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load the latest suppliers.",
        "error",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form) {
      return;
    }

    const nextErrors = validatePurchaseOrderForm(form);
    setFormErrors(nextErrors);

    if (hasPurchaseOrderFormErrors(nextErrors)) {
      return;
    }

    try {
      setSaving(true);
      const createdOrder = await createPurchaseOrder(profile, form);
      let pdfGenerated = false;
      let pdfGenerationFailed = false;

      if (canDownloadPurchasePdf) {
        try {
          const orderForPdf = await fetchPurchaseOrder(profile, createdOrder.id);
          await generateAndStorePurchaseOrderPdf(
            profile,
            organization,
            orderForPdf,
          );
          pdfGenerated = true;
        } catch (pdfError) {
          pdfGenerationFailed = true;
          showToast(
            pdfError instanceof Error
              ? `Purchase order created, but PDF generation failed: ${pdfError.message}`
              : "Purchase order created, but PDF generation failed.",
            "error",
          );
        }
      }

      setForm(null);
      if (pdfGenerated) {
        showToast("Purchase order created and PDF generated.", "success");
      } else if (!canDownloadPurchasePdf) {
        showToast("Purchase order created. PDF generation needs documents:create and purchase pricing access.", "success");
      } else if (!pdfGenerationFailed) {
        showToast("Purchase order created.", "success");
      }
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase order save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function openReceiveForm(order: PurchaseOrderWithRelations) {
    const nextForm = emptyPurchaseReceiveForm(order);
    setReceiveTarget(order);
    setReceiveForm(nextForm);
    setReceiveFormErrors(null);
  }

  async function handleReceiveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!receiveTarget || !receiveForm) {
      return;
    }

    const nextErrors = validatePurchaseReceiveForm(receiveForm);
    setReceiveFormErrors(nextErrors);

    if (hasPurchaseReceiveFormErrors(nextErrors)) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await receivePurchaseOrderItems(receiveTarget.id, receiveForm);
      showToast("Material received and stock updated.", "success");
      setReceiveTarget(null);
      setReceiveForm(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Material receive failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDownloadPurchaseOrder(order: PurchaseOrderWithRelations) {
    const knownUrl = purchasePdfUrls[order.id];
    if (knownUrl) {
      window.open(knownUrl, "_blank", "noreferrer");
      return;
    }

    if (!canDownloadPurchasePdf) {
      showToast(
        "Download needs documents:create access and purchase pricing access.",
        "error",
      );
      return;
    }

    try {
      setPreparingPurchasePdfId(order.id);
      const existingUrl = await fetchPurchaseOrderPdfPreviewUrl(order);
      if (existingUrl) {
        setPurchasePdfUrls((current) => ({
          ...current,
          [order.id]: existingUrl,
        }));
        window.open(existingUrl, "_blank", "noreferrer");
        return;
      }

      const result = await generateAndStorePurchaseOrderPdf(
        profile,
        organization,
        order,
      );
      setPurchasePdfUrls((current) => ({
        ...current,
        [order.id]: result.previewUrl,
      }));
      window.open(result.previewUrl, "_blank", "noreferrer");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase order PDF download failed.",
        "error",
      );
    } finally {
      setPreparingPurchasePdfId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Purchase Orders"
          description="Create purchase orders and receive stock into inventory."
        />
        {canCreate ? <Button onClick={openCreateForm}>Create Purchase Order</Button> : null}
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

      <Toolbar>
        <SearchInput
          placeholder="Search PO, supplier, or phone"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) =>
            setFilters((current) => ({
              ...current,
              status,
              pendingReceive: false,
            }))
          }
          options={[
            { value: "", label: "All statuses" },
            ...purchaseStatusOptions.map((status) => ({
              value: status,
              label: labelize(status),
            })),
          ]}
        />
        <Button
          onClick={() =>
            setFilters((current) => ({
              ...current,
              status: current.pendingReceive ? current.status : "",
              pendingReceive: !current.pendingReceive,
            }))
          }
          variant={filters.pendingReceive ? "primary" : "secondary"}
        >
          Pending Receive ({pendingReceiveCount})
        </Button>
        <SelectInput
          label="Supplier"
          value={filters.vendorId}
          onChange={(vendorId) =>
            setFilters((current) => ({ ...current, vendorId }))
          }
          options={[
            { value: "", label: "All suppliers" },
            ...vendors.map((vendor) => ({
              value: vendor.id,
              label: `${vendor.vendor_code ?? "Supplier"} - ${vendor.vendor_name}`,
            })),
          ]}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load purchases" description={error} /> : null}
      {!loading && !error && filteredOrders.length === 0 ? (
        <EmptyState
          title={
            filters.pendingReceive
              ? "No pending material receipts"
              : "No purchase orders found"
          }
          description={
            filters.pendingReceive
              ? "Ordered and partially received purchase orders will appear here."
              : "Create a purchase order to track supplier procurement and received stock."
          }
          action={canCreate ? <Button onClick={openCreateForm}>Create Purchase Order</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredOrders.length > 0 ? (
        <PurchaseOrdersSection
          orders={filteredOrders}
          canDelete={canDelete}
          canReceive={canReceive}
          canDownloadPdf={canDownloadPurchasePdf}
          pdfUrls={purchasePdfUrls}
          preparingPdfId={preparingPurchasePdfId}
          showPricing={canViewPricing}
          onDownload={(order) => void handleDownloadPurchaseOrder(order)}
          onReceive={openReceiveForm}
        />
      ) : null}

      {form ? (
        <PurchaseOrderFormModal
          title="Create Purchase Order"
          submitLabel="Save Purchase Order"
          values={form}
          setValues={setForm}
          errors={formErrors}
          vendors={vendors}
          items={items}
          priceDefaults={priceDefaults}
          canAddItems={canCreateItems}
          canRemoveItems
          onClose={() => {
            setForm(null);
          }}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {receiveTarget && receiveForm ? (
        <PurchaseReceiveFormModal
          order={receiveTarget}
          values={receiveForm}
          setValues={setReceiveForm}
          errors={receiveFormErrors}
          showPricing={canViewPricing}
          onClose={() => {
            setReceiveTarget(null);
            setReceiveForm(null);
          }}
          onSubmit={handleReceiveSubmit}
          saving={updatingStatus}
        />
      ) : null}

    </div>
  );
}

export function PurchaseOrdersSection({
  orders,
  canDelete = false,
  canReceive = false,
  canDownloadPdf = false,
  pdfUrls = {},
  preparingPdfId = null,
  showPricing = true,
  onDownload,
  onDelete,
  onReceive,
  emptyTitle = "No purchase orders",
}: {
  orders: PurchaseOrderWithRelations[];
  canDelete?: boolean;
  canReceive?: boolean;
  canDownloadPdf?: boolean;
  pdfUrls?: Record<string, string>;
  preparingPdfId?: string | null;
  showPricing?: boolean;
  onDownload?: (order: PurchaseOrderWithRelations) => void;
  onDelete?: (order: PurchaseOrderWithRelations) => void;
  onReceive?: (order: PurchaseOrderWithRelations) => void;
  emptyTitle?: string;
}) {
  const navigate = useNavigate();
  const orderPagination = useTablePagination(orders);
  const paginatedOrders = orderPagination.pageItems;

  function openPurchaseDetail(orderId: string) {
    navigate(`/purchases/${orderId}`);
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest("a,button,input,select,textarea,label"))
    );
  }

  function handlePurchaseRowClick(
    event: MouseEvent<HTMLTableRowElement | HTMLElement>,
    orderId: string,
  ) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    openPurchaseDetail(orderId);
  }

  function handlePurchaseRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    orderId: string,
  ) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPurchaseDetail(orderId);
    }
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Purchase orders linked to this record will appear here."
      />
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Purchase Orders
        </h2>
        <p className="text-sm text-slate-500">{orders.length} records</p>
      </div>
      <div className="mt-4 hidden overflow-hidden rounded-lg border border-stone-200 xl:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Order Date</th>
              <th className="px-4 py-3">Expected</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Receipt</th>
              {showPricing ? <th className="px-4 py-3">Total</th> : null}
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {paginatedOrders.map((order) => {
              const progress = purchaseReceiveProgress(order);

              return (
                <tr
                  key={order.id}
                  className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                  onClick={(event) => handlePurchaseRowClick(event, order.id)}
                  onKeyDown={(event) => handlePurchaseRowKeyDown(event, order.id)}
                  role="link"
                  tabIndex={0}
                >
                  <td className="px-4 py-3 font-semibold text-slate-950">
                    <Link
                      className="font-semibold text-[#06173f]"
                      onClick={(event) => event.stopPropagation()}
                      to={`/purchases/${order.id}`}
                    >
                      {formatPurchaseCode(order.purchase_code)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-950">
                      {order.vendor?.vendor_name ?? "Supplier"}
                    </span>
                    <div className="text-xs text-slate-500">
                      {order.vendor?.phone ?? ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{formatDate(order.order_date)}</td>
                  <td
                    className="px-4 py-3"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {formatDate(order.expected_delivery_date)}
                  </td>
                  <td className="px-4 py-3">
                    <PurchaseStatusBadge value={order.status} />
                  </td>
                  <td className="px-4 py-3">{order.items?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    <PurchaseReceiveProgress progress={progress} />
                  </td>
                  {showPricing ? (
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatPurchaseTableTotal(order.total_amount)}
                    </td>
                  ) : null}
                  <td
                    className="px-4 py-3"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <PurchaseStatusActions
                      order={order}
                      canDelete={canDelete}
                      canReceive={canReceive}
                      canDownloadPdf={canDownloadPdf}
                      pdfUrl={pdfUrls[order.id]}
                      preparingPdf={preparingPdfId === order.id}
                      onDownload={onDownload}
                      onDelete={onDelete}
                      onReceive={onReceive}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 xl:hidden">
        {paginatedOrders.map((order) => {
          const progress = purchaseReceiveProgress(order);

          return (
            <article
              key={order.id}
              className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
              onClick={(event) => handlePurchaseRowClick(event, order.id)}
              onKeyDown={(event) => handlePurchaseRowKeyDown(event, order.id)}
              role="link"
              tabIndex={0}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <Link
                      className="text-[#06173f]"
                      onClick={(event) => event.stopPropagation()}
                      to={`/purchases/${order.id}`}
                    >
                      {formatPurchaseCode(order.purchase_code)}
                    </Link>
                  </p>
                  <span className="mt-1 block text-base font-semibold text-slate-950">
                    {order.vendor?.vendor_name ?? "Supplier"}
                  </span>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDate(order.order_date)} / {order.items?.length ?? 0} items
                  </p>
                </div>
                <PurchaseStatusBadge value={order.status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Expected</dt>
                  <dd className="font-medium text-slate-900">
                    {formatDate(order.expected_delivery_date)}
                  </dd>
                </div>
                {showPricing ? (
                  <div>
                    <dt className="text-xs text-slate-500">Total</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatPurchaseTableTotal(order.total_amount)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-4">
                <PurchaseReceiveProgress progress={progress} />
              </div>
              <div
                className="mt-4"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <PurchaseStatusActions
                  order={order}
                  canDelete={canDelete}
                  canReceive={canReceive}
                  canDownloadPdf={canDownloadPdf}
                  pdfUrl={pdfUrls[order.id]}
                  preparingPdf={preparingPdfId === order.id}
                  onDownload={onDownload}
                  onDelete={onDelete}
                  onReceive={onReceive}
                />
              </div>
            </article>
          );
        })}
      </div>
      <TablePagination label="purchase orders" pagination={orderPagination} />
    </section>
  );
}

export function PurchaseStatusBadge({
  value,
}: {
  value: PurchaseStatus | null | undefined;
}) {
  const tone =
    value === "received"
      ? "green"
      : value === "cancelled"
        ? "red"
        : value === "partially_received"
          ? "amber"
        : value === "ordered"
          ? "blue"
          : "neutral";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}

function isReceivablePurchaseOrder(order: PurchaseOrderWithRelations) {
  return order.status === "ordered" || order.status === "partially_received";
}

function purchaseReceiveProgress(order: PurchaseOrderWithRelations) {
  const totals = (order.items ?? []).reduce(
    (current, item) => ({
      ordered: current.ordered + Number(item.quantity ?? 0),
      received: current.received + Number(item.received_quantity ?? 0),
    }),
    { ordered: 0, received: 0 },
  );
  const percent =
    totals.ordered > 0
      ? Math.min(100, Math.round((totals.received / totals.ordered) * 100))
      : 0;

  return { ...totals, pending: Math.max(totals.ordered - totals.received, 0), percent };
}

function PurchaseReceiveProgress({
  progress,
}: {
  progress: ReturnType<typeof purchaseReceiveProgress>;
}) {
  return (
    <div className="min-w-36">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="font-medium text-slate-700">
          {progress.received} / {progress.ordered}
        </span>
        <span>{progress.percent}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full bg-orange-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Pending {progress.pending}
      </p>
    </div>
  );
}

function PurchaseStatusActions({
  order,
  canDelete,
  canReceive,
  canDownloadPdf,
  pdfUrl,
  preparingPdf,
  onDownload,
  onDelete,
  onReceive,
}: {
  order: PurchaseOrderWithRelations;
  canDelete: boolean;
  canReceive: boolean;
  canDownloadPdf: boolean;
  pdfUrl?: string;
  preparingPdf: boolean;
  onDownload?: (order: PurchaseOrderWithRelations) => void;
  onDelete?: (order: PurchaseOrderWithRelations) => void;
  onReceive?: (order: PurchaseOrderWithRelations) => void;
}) {
  const canShowReceiveAction = Boolean(
    canReceive &&
      onReceive &&
      (order.status === "ordered" || order.status === "partially_received"),
  );

  const canShowDeleteAction = Boolean(canDelete && onDelete);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap">
      <DownloadPurchaseOrderAction
        canDownload={canDownloadPdf}
        preparing={preparingPdf}
        url={pdfUrl}
        onDownload={onDownload ? () => onDownload(order) : undefined}
      />
      <Button
        disabled={!canShowReceiveAction}
        onClick={() => onReceive?.(order)}
      >
        Material Received
      </Button>
      {canShowDeleteAction && onDelete ? (
        <Button onClick={() => onDelete(order)} variant="danger">
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function formatPurchaseTableTotal(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function DownloadPurchaseOrderAction({
  canDownload,
  url,
  preparing,
  onDownload,
}: {
  canDownload: boolean;
  url?: string;
  preparing: boolean;
  onDownload?: () => void;
}) {
  if (url) {
    return (
      <a
        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
        download
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        Download PO
      </a>
    );
  }

  if (!canDownload || !onDownload) {
    return <PlaceholderAction>Download PO</PlaceholderAction>;
  }

  return (
    <Button disabled={preparing} onClick={onDownload}>
      {preparing ? "Preparing PO" : "Download PO"}
    </Button>
  );
}

export function PurchaseOrderFormModal({
  title = "Create Purchase Order",
  submitLabel = "Save Purchase Order",
  values,
  setValues,
  errors,
  vendors,
  items,
  priceDefaults,
  canAddItems = true,
  canRemoveItems = true,
  receiptLocked = false,
  onClose,
  onSubmit,
  saving,
}: {
  title?: string;
  submitLabel?: string;
  values: PurchaseOrderFormValues;
  setValues: (values: PurchaseOrderFormValues) => void;
  errors: PurchaseFormErrors | null;
  vendors: PurchaseVendorOption[];
  items: InventoryItem[];
  priceDefaults: Map<string, { current_purchase_price: number | null; gst_percent: number | null }>;
  canAddItems?: boolean;
  canRemoveItems?: boolean;
  receiptLocked?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const totals = calculatePurchaseTotals(values);
  const activeItems = items.filter(isPurchaseSelectableItem);

  function updateItem(index: number, item: PurchaseOrderItemFormValues) {
    setValues({
      ...values,
      items: values.items.map((current, itemIndex) =>
        itemIndex === index ? item : current,
      ),
    });
  }

  function handleItemChange(index: number, itemId: string) {
    const selectedItem = items.find((item) => item.id === itemId);
    updateItem(
      index,
      emptyPurchaseItemForm(
        selectedItem,
        selectedItem?.catalog_product_id
          ? priceDefaults.get(selectedItem.catalog_product_id)
          : null,
      ),
    );
  }

  if (receiptLocked) {
    return (
      <Modal
        title={title}
        onClose={onClose}
        onSubmit={onSubmit}
        submitLabel={submitLabel}
        submitting={saving}
      >
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 md:col-span-2">
          Material has already been received. Supplier, order date, items,
          quantities, and pricing are locked. You can still update the bill /
          invoice number, expected delivery date, and notes.
        </section>
        <TextInput
          label="Bill / Invoice No."
          value={values.bill_invoice_no}
          onChange={(bill_invoice_no) =>
            setValues({ ...values, bill_invoice_no })
          }
        />
        <p className="self-end pb-2 text-xs text-slate-500">
          This number is applied to all material receipts recorded for this PO.
        </p>
        <TextInput
          label="Expected Delivery"
          type="date"
          value={values.expected_delivery_date}
          onChange={(expected_delivery_date) =>
            setValues({ ...values, expected_delivery_date })
          }
        />
        <TextArea
          label="Notes"
          value={values.notes}
          onChange={(notes) => setValues({ ...values, notes })}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={submitLabel}
      submitting={saving}
    >
      <SelectInput
        label="Supplier"
        value={values.vendor_id}
        onChange={(vendor_id) => setValues({ ...values, vendor_id })}
        options={[
          { value: "", label: "Select supplier" },
          ...vendors.map((vendor) => ({
            value: vendor.id,
            label: `${vendor.vendor_code ?? "Supplier"} - ${vendor.vendor_name}`,
          })),
        ]}
      />
      {errors?.vendor_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.vendor_id}</p>
      ) : null}
      <TextInput
        label="Order Date"
        type="date"
        value={values.order_date}
        onChange={(order_date) => setValues({ ...values, order_date })}
      />
      <TextInput
        label="Expected Delivery"
        type="date"
        value={values.expected_delivery_date}
        onChange={(expected_delivery_date) =>
          setValues({ ...values, expected_delivery_date })
        }
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(notes) => setValues({ ...values, notes })}
      />
      <div className="space-y-3 md:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">Items</h3>
          {canAddItems ? (
            <Button
              onClick={() =>
                setValues({
                  ...values,
                  items: [...values.items, emptyPurchaseItemForm()],
                })
              }
              variant="secondary"
            >
              Add Item
            </Button>
          ) : null}
        </div>
        {errors?.items ? (
          <p className="text-xs text-rose-700">{errors.items}</p>
        ) : null}
        {activeItems.length === 0 ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
            No active Product Master items are available. Add or reactivate a
            product in Products &amp; Materials before creating a purchase order.
          </section>
        ) : null}
        {values.items.map((item, index) => {
          const itemTotal = calculatePurchaseItemTotal(item);
          const itemErrors = errors?.itemErrors[index];
          const selectedItem = items.find((option) => option.id === item.item_id);
          const itemOptions =
            selectedItem && !activeItems.some((option) => option.id === selectedItem.id)
              ? [...activeItems, selectedItem]
              : activeItems;

          return (
            <div
              key={index}
              className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 md:grid-cols-5"
            >
              <div className="md:col-span-2">
                <SelectInput
                  label="Product / Material"
                  value={item.item_id}
                  onChange={(itemId) => handleItemChange(index, itemId)}
                  options={[
                    { value: "", label: "Select product or material" },
                    ...itemOptions.map((option) => ({
                      value: option.id,
                      label: [
                        option.catalog_product?.product_code ?? option.item_code,
                        inventoryProductName(option),
                        option.unit,
                        `Stock ${formatStock(option.current_stock)}`,
                      ]
                        .filter(Boolean)
                        .join(" - "),
                    })),
                  ]}
                />
                {itemErrors?.item_id ? (
                  <p className="mt-1 text-xs text-rose-700">
                    {itemErrors.item_id}
                  </p>
                ) : null}
              </div>
              <TextInput
                label="Quantity"
                type="number"
                value={item.quantity}
                onChange={(quantity) => updateItem(index, { ...item, quantity })}
                error={itemErrors?.quantity}
              />
              <TextInput
                label="Unit Price"
                type="number"
                value={item.unit_price}
                onChange={(unit_price) => updateItem(index, { ...item, unit_price })}
                error={itemErrors?.unit_price}
              />
              <TextInput
                label="GST %"
                type="number"
                value={item.gst_percent}
                onChange={(gst_percent) =>
                  updateItem(index, { ...item, gst_percent })
                }
                error={itemErrors?.gst_percent}
              />
              <div className="md:col-span-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  {selectedItem
                    ? `Current stock: ${formatStock(
                        selectedItem.current_stock,
                        selectedItem.unit,
                      )}`
                    : "Select a Product Master item"}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-slate-950">
                    Line total {formatCurrency(itemTotal.total)}
                  </span>
                  {values.items.length > 1 && (canRemoveItems || !item.id) ? (
                    <Button
                      onClick={() =>
                        setValues({
                          ...values,
                          items: values.items.filter(
                            (_current, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-3 md:col-span-2 sm:grid-cols-3">
        <PurchaseTotal label="Subtotal" value={totals.subtotal} />
        <PurchaseTotal label="GST" value={totals.gstAmount} />
        <PurchaseTotal label="Total" value={totals.total} strong />
      </section>
    </Modal>
  );
}

function isPurchaseSelectableItem(item: InventoryItem) {
  return (
    item.status === "active" &&
    (!item.catalog_product?.status || item.catalog_product.status === "active")
  );
}

function PurchaseTotal({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 ${strong ? "text-lg" : "text-sm"} font-semibold text-slate-950`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

export function PurchaseReceiveFormModal({
  order,
  values,
  setValues,
  errors,
  showPricing,
  onClose,
  onSubmit,
  saving,
}: {
  order: PurchaseOrderWithRelations;
  values: PurchaseReceiveFormValues;
  setValues: (values: PurchaseReceiveFormValues) => void;
  errors: PurchaseReceiveFormErrors | null;
  showPricing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function updateItem(index: number, item: PurchaseReceiveItemFormValues) {
    setValues({
      ...values,
      items: values.items.map((current, itemIndex) =>
        itemIndex === index ? item : current,
      ),
    });
  }

  return (
    <Modal
      title={`Receive ${formatPurchaseCode(order.purchase_code)}`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Material Received"
      submitting={saving}
      maxWidthClass="sm:max-w-4xl"
    >
      <TextInput
        label="Bill / Invoice No."
        value={values.bill_no}
        onChange={(bill_no) => setValues({ ...values, bill_no })}
      />
      <TextInput
        label="Received Date"
        type="date"
        value={values.received_date}
        onChange={(received_date) => setValues({ ...values, received_date })}
        error={errors?.received_date}
      />
      <TextArea
        label="Receiving Notes"
        value={values.notes}
        onChange={(notes) => setValues({ ...values, notes })}
      />
      <div className="space-y-3 md:col-span-2">
        <h3 className="text-sm font-semibold text-slate-950">Received Items</h3>
        {errors?.items ? (
          <p className="text-xs text-rose-700">{errors.items}</p>
        ) : null}
        {values.items.length === 0 ? (
          <p className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-slate-600">
            All purchase lines are already received.
          </p>
        ) : null}
        {values.items.map((item, index) => {
          const itemErrors = errors?.itemErrors[index];
          const pendingQuantity = Math.max(
            item.ordered_quantity - item.already_received_quantity,
            0,
          );

          return (
            <div
              key={item.purchase_order_item_id}
              className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 md:grid-cols-5"
            >
              <div className="md:col-span-2">
                <p className="text-sm font-semibold text-slate-950">
                  {item.item_name}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Ordered {formatStock(item.ordered_quantity)} / pending{" "}
                  {formatStock(pendingQuantity)}
                </p>
              </div>
              <TextInput
                label="Receive Qty"
                type="number"
                value={item.received_quantity}
                onChange={(received_quantity) =>
                  updateItem(index, { ...item, received_quantity })
                }
                error={itemErrors?.received_quantity}
              />
              {showPricing ? (
                <>
                  <TextInput
                    label="Unit Price"
                    type="number"
                    value={item.actual_unit_purchase_price}
                    onChange={(actual_unit_purchase_price) =>
                      updateItem(index, { ...item, actual_unit_purchase_price })
                    }
                    error={itemErrors?.actual_unit_purchase_price}
                  />
                  <TextInput
                    label="GST %"
                    type="number"
                    value={item.gst_percent}
                    onChange={(gst_percent) =>
                      updateItem(index, { ...item, gst_percent })
                    }
                    error={itemErrors?.gst_percent}
                  />
                  <label className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 md:col-span-5">
                    <input
                      checked={item.update_current_purchase_price}
                      className="h-4 w-4 rounded border-stone-300 text-[#06173f] focus:ring-orange-600"
                      onChange={(event) =>
                        updateItem(index, {
                          ...item,
                          update_current_purchase_price: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Update current Product Master purchase price from this received cost
                  </label>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
