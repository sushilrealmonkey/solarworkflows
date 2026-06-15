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
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  Modal,
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
import { formatCurrency, formatStock } from "../inventory/inventoryUtils";
import type { InventoryItem } from "../inventory/types";
import type { Vendor } from "../vendors/types";
import {
  createPurchaseOrder,
  fetchPurchasePriceDefaults,
  fetchPurchaseVendorOptions,
  fetchPurchaseOrders,
  receivePurchaseOrderItems,
  updatePurchaseOrderStatus,
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
};

type PurchaseFormErrors = ReturnType<typeof validatePurchaseOrderForm>;
type PurchaseReceiveFormErrors = ReturnType<typeof validatePurchaseReceiveForm>;
type PurchaseVendorOption = Pick<
  Vendor,
  "id" | "vendor_code" | "vendor_name" | "contact_person" | "phone"
>;

export function PurchasesPage() {
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrderWithRelations[]>([]);
  const [vendors, setVendors] = useState<PurchaseVendorOption[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [priceDefaults, setPriceDefaults] = useState(
    new Map<string, { current_purchase_price: number | null; gst_percent: number | null }>(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PurchaseFilters>({
    search: "",
    status: "",
    vendorId: "",
  });
  const [form, setForm] = useState<PurchaseOrderFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<PurchaseFormErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    order: PurchaseOrderWithRelations;
    status: PurchaseStatus;
  } | null>(null);
  const [receiveTarget, setReceiveTarget] =
    useState<PurchaseOrderWithRelations | null>(null);
  const [receiveForm, setReceiveForm] = useState<PurchaseReceiveFormValues | null>(
    null,
  );
  const [receiveFormErrors, setReceiveFormErrors] =
    useState<PurchaseReceiveFormErrors | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

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
  const canUpdatePricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "update",
  );
  const canCreate =
    hasPermission(profile, permissions, "inventory", "create") &&
    canCreatePricing;
  const canManageStatus =
    hasPermission(profile, permissions, "inventory", "update") &&
    canUpdatePricing;
  const canReceive =
    hasPermission(profile, permissions, "inventory", "create") &&
    hasPermission(profile, permissions, "inventory", "update");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextOrders, nextVendors, nextItems] = await Promise.all([
        fetchPurchaseOrders(profile, undefined, { includePricing: canViewPricing }),
        fetchPurchaseVendorOptions(),
        fetchInventoryItems(profile),
      ]);
      setOrders(nextOrders);
      setVendors(nextVendors);
      setItems(nextItems);
      setPriceDefaults(
        canViewPricing ? await fetchPurchasePriceDefaults(nextItems) : new Map(),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load purchases.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, profile?.id]);

  const filteredOrders = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return orders.filter((order) => {
      const matchesSearch =
        !search ||
        [
          order.purchase_code,
          order.vendor?.vendor_name,
          order.vendor?.vendor_code,
          order.vendor?.phone,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus = !filters.status || order.status === filters.status;
      const matchesVendor = !filters.vendorId || order.vendor_id === filters.vendorId;

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [orders, filters]);

  if (!canView) {
    return (
      <AccessDenied
        title="Purchases are not available"
        description="Your role needs inventory:view access to open purchase tracking."
      />
    );
  }

  function openCreateForm() {
    setFormErrors(null);
    setForm(emptyPurchaseOrderForm());
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
      await createPurchaseOrder(profile, form);
      setForm(null);
      showToast("Purchase order created.", "success");
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

  async function confirmStatusUpdate() {
    if (!statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await updatePurchaseOrderStatus(statusTarget.order.id, statusTarget.status);
      showToast("Purchase status updated.", "success");
      setStatusTarget(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
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
      showToast("Purchase received and stock updated.", "success");
      setReceiveTarget(null);
      setReceiveForm(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase receiving failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Purchases"
          description="Create purchase orders and receive stock into inventory."
        />
        {canCreate ? <Button onClick={openCreateForm}>Create Purchase Order</Button> : null}
      </div>

      <Toolbar>
        <SearchInput
          placeholder="Search PO, vendor, or phone"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...purchaseStatusOptions.map((status) => ({
              value: status,
              label: labelize(status),
            })),
          ]}
        />
        <SelectInput
          label="Vendor"
          value={filters.vendorId}
          onChange={(vendorId) =>
            setFilters((current) => ({ ...current, vendorId }))
          }
          options={[
            { value: "", label: "All vendors" },
            ...vendors.map((vendor) => ({
              value: vendor.id,
              label: `${vendor.vendor_code ?? "Vendor"} - ${vendor.vendor_name}`,
            })),
          ]}
        />
      </Toolbar>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load purchases" description={error} /> : null}
      {!loading && !error && filteredOrders.length === 0 ? (
        <EmptyState
          title="No purchase orders found"
          description="Create a purchase order to track vendor procurement and received stock."
          action={canCreate ? <Button onClick={openCreateForm}>Create Purchase Order</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredOrders.length > 0 ? (
        <PurchaseOrdersSection
          orders={filteredOrders}
          canManageStatus={canManageStatus}
          canReceive={canReceive}
          showPricing={canViewPricing}
          onStatusChange={(order, status) => setStatusTarget({ order, status })}
          onReceive={openReceiveForm}
        />
      ) : null}

      {form ? (
        <PurchaseOrderFormModal
          values={form}
          setValues={setForm}
          errors={formErrors}
          vendors={vendors}
          items={items}
          priceDefaults={priceDefaults}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          title={
            statusTarget.status === "received"
              ? "Receive purchase order?"
              : "Update purchase status?"
          }
          description={
            statusTarget.status === "received"
              ? "This opens the receiving workflow for this purchase order."
              : `Set ${formatPurchaseCode(statusTarget.order.purchase_code)} to ${labelize(statusTarget.status)}.`
          }
          confirming={updatingStatus}
          confirmLabel={
            statusTarget.status === "received" ? "Receive Stock" : "Update Status"
          }
          confirmingLabel="Updating..."
          confirmVariant={statusTarget.status === "cancelled" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusUpdate}
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
  canManageStatus = false,
  canReceive = false,
  showPricing = true,
  onStatusChange,
  onReceive,
  emptyTitle = "No purchase orders",
}: {
  orders: PurchaseOrderWithRelations[];
  canManageStatus?: boolean;
  canReceive?: boolean;
  showPricing?: boolean;
  onStatusChange?: (
    order: PurchaseOrderWithRelations,
    status: PurchaseStatus,
  ) => void;
  onReceive?: (order: PurchaseOrderWithRelations) => void;
  emptyTitle?: string;
}) {
  const navigate = useNavigate();

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
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Order Date</th>
              <th className="px-4 py-3">Expected</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Items</th>
              {showPricing ? <th className="px-4 py-3">Total</th> : null}
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orders.map((order) => (
              <tr
                key={order.id}
                className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                onClick={(event) => handlePurchaseRowClick(event, order.id)}
                onKeyDown={(event) => handlePurchaseRowKeyDown(event, order.id)}
                role="link"
                tabIndex={0}
              >
                <td className="px-4 py-3 font-semibold text-slate-950">
                  <Link
                    className="font-semibold text-brand-700"
                    onClick={(event) => event.stopPropagation()}
                    to={`/purchases/${order.id}`}
                  >
                    {formatPurchaseCode(order.purchase_code)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-slate-950">
                    {order.vendor?.vendor_name ?? "Vendor"}
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
                {showPricing ? (
                  <td className="px-4 py-3 font-semibold text-slate-950">
                    {formatCurrency(order.total_amount)}
                  </td>
                ) : null}
                <td
                  className="px-4 py-3"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <PurchaseStatusActions
                    order={order}
                    canManageStatus={canManageStatus}
                    canReceive={canReceive}
                    onStatusChange={onStatusChange}
                    onReceive={onReceive}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 xl:hidden">
        {orders.map((order) => (
          <article
            key={order.id}
            className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            onClick={(event) => handlePurchaseRowClick(event, order.id)}
            onKeyDown={(event) => handlePurchaseRowKeyDown(event, order.id)}
            role="link"
            tabIndex={0}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Link
                    className="text-brand-700"
                    onClick={(event) => event.stopPropagation()}
                    to={`/purchases/${order.id}`}
                  >
                    {formatPurchaseCode(order.purchase_code)}
                  </Link>
                </p>
                <span className="mt-1 block text-base font-semibold text-slate-950">
                  {order.vendor?.vendor_name ?? "Vendor"}
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
                    {formatCurrency(order.total_amount)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div
              className="mt-4"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <PurchaseStatusActions
                order={order}
                canManageStatus={canManageStatus}
                canReceive={canReceive}
                onStatusChange={onStatusChange}
                onReceive={onReceive}
              />
            </div>
          </article>
        ))}
      </div>
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

function PurchaseStatusActions({
  order,
  canManageStatus,
  canReceive,
  onStatusChange,
  onReceive,
}: {
  order: PurchaseOrderWithRelations;
  canManageStatus: boolean;
  canReceive: boolean;
  onStatusChange?: (
    order: PurchaseOrderWithRelations,
    status: PurchaseStatus,
  ) => void;
  onReceive?: (order: PurchaseOrderWithRelations) => void;
}) {
  const canShowStatusActions = Boolean(
    canManageStatus && onStatusChange && order.status !== "received",
  );
  const canShowReceiveAction = Boolean(
    canReceive &&
      onReceive &&
      order.status !== "received" &&
      order.status !== "cancelled",
  );

  if (!canShowStatusActions && !canShowReceiveAction) {
    return <span className="text-sm text-slate-500">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canShowStatusActions && onStatusChange && order.status === "draft" ? (
        <Button onClick={() => onStatusChange(order, "ordered")} variant="secondary">
          Mark Ordered
        </Button>
      ) : null}
      {canShowReceiveAction && onReceive ? (
        <Button onClick={() => onReceive(order)}>
          Receive Stock
        </Button>
      ) : null}
      {canShowStatusActions && onStatusChange && order.status !== "cancelled" ? (
        <Button onClick={() => onStatusChange(order, "cancelled")} variant="danger">
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

function PurchaseOrderFormModal({
  values,
  setValues,
  errors,
  vendors,
  items,
  priceDefaults,
  onClose,
  onSubmit,
  saving,
}: {
  values: PurchaseOrderFormValues;
  setValues: (values: PurchaseOrderFormValues) => void;
  errors: PurchaseFormErrors | null;
  vendors: PurchaseVendorOption[];
  items: InventoryItem[];
  priceDefaults: Map<string, { current_purchase_price: number | null; gst_percent: number | null }>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const totals = calculatePurchaseTotals(values);

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

  return (
    <Modal
      title="Create Purchase Order"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Purchase Order"
      submitting={saving}
    >
      <SelectInput
        label="Vendor"
        value={values.vendor_id}
        onChange={(vendor_id) => setValues({ ...values, vendor_id })}
        options={[
          { value: "", label: "Select vendor" },
          ...vendors.map((vendor) => ({
            value: vendor.id,
            label: `${vendor.vendor_code ?? "Vendor"} - ${vendor.vendor_name}`,
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
        </div>
        {errors?.items ? (
          <p className="text-xs text-rose-700">{errors.items}</p>
        ) : null}
        {values.items.map((item, index) => {
          const itemTotal = calculatePurchaseItemTotal(item);
          const itemErrors = errors?.itemErrors[index];
          const selectedItem = items.find((option) => option.id === item.item_id);

          return (
            <div
              key={index}
              className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 md:grid-cols-5"
            >
              <div className="md:col-span-2">
                <SelectInput
                  label="Inventory Item"
                  value={item.item_id}
                  onChange={(itemId) => handleItemChange(index, itemId)}
                  options={[
                    { value: "", label: "Select item" },
                    ...items.map((option) => ({
                      value: option.id,
                      label: `${option.item_code ?? "Item"} - ${option.item_name}`,
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
                    : "Select an inventory item"}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-slate-950">
                    Line total {formatCurrency(itemTotal.total)}
                  </span>
                  {values.items.length > 1 ? (
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
      submitLabel="Receive Stock"
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
                      className="h-4 w-4 rounded border-stone-300 text-brand-700 focus:ring-brand-600"
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
