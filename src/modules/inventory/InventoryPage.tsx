import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
  AlertDialog,
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
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import {
  fetchInventoryItems,
  fetchInventoryMasters,
  fetchInventoryTransactions,
  updateInventoryItem,
} from "./inventoryApi";
import {
  formatStock,
  inventoryBrandName,
  inventoryItemTitle,
  inventoryModelName,
  inventoryProductName,
  inventoryVendorName,
  inventoryItemToForm,
  inventoryItemValidationSummary,
  inventoryStatusOptions,
  inventoryTransactionTypeOptions,
  isOutOfStock,
  isLowStock,
  transactionDecreasesStock,
  transactionTypeLabel,
  validateInventoryItemForm,
  availableStockNumber,
} from "./inventoryUtils";
import type {
  InventoryCatalogProduct,
  InventoryItem,
  InventoryItemFormValues,
  InventoryMasters,
  InventoryProjectOption,
  InventoryTransactionFormValues,
  InventoryTransactionType,
  InventoryTransactionWithRelations,
} from "./types";

type InventoryFilters = {
  search: string;
  categoryId: string;
  productId: string;
  status: string;
  stockState: "all" | "low_stock" | "out_of_stock";
};

type ItemFormState = {
  item: InventoryItem;
  values: InventoryItemFormValues;
};

export function InventoryPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<
    InventoryTransactionWithRelations[]
  >([]);
  const [masters, setMasters] = useState<InventoryMasters>({
    products: [],
    categories: [],
    vendors: [],
  });
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<InventoryFilters>({
    search: "",
    categoryId: "",
    productId: "",
    status: "",
    stockState: "all",
  });
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
  const [itemFormErrors, setItemFormErrors] = useState<Record<string, string>>(
    {},
  );
  const [savingItem, setSavingItem] = useState(false);
  const [itemSaveAlert, setItemSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [discontinueTarget, setDiscontinueTarget] =
    useState<InventoryItem | null>(null);
  const [discontinuing, setDiscontinuing] = useState(false);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canUpdate = hasPermission(profile, permissions, "inventory", "update");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextItems, nextTransactions, nextMasters] = await Promise.all([
        fetchInventoryItems(profile, archiveScope),
        fetchInventoryTransactions(profile),
        fetchInventoryMasters(profile),
      ]);
      setItems(nextItems);
      setTransactions(nextTransactions);
      setMasters(nextMasters);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load inventory.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveScope, canView, profile?.id]);

  const lowStockItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === "active" && isLowStock(item) && !isOutOfStock(item),
      ),
    [items],
  );

  const outOfStockItems = useMemo(
    () => items.filter((item) => item.status === "active" && isOutOfStock(item)),
    [items],
  );

  const filteredItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch =
        !search ||
        [
          item.item_code,
          inventoryProductName(item),
          item.catalog_product?.product_code,
          item.catalog_product?.category?.name,
          item.catalog_product?.hsn_code,
          inventoryBrandName(item),
          inventoryModelName(item),
          inventoryVendorName(item),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesCategory =
        !filters.categoryId ||
        item.catalog_product?.category_id === filters.categoryId;
      const matchesProduct =
        !filters.productId || item.catalog_product_id === filters.productId;
      const matchesStatus = !filters.status || item.status === filters.status;
      const matchesStockState =
        filters.stockState === "all" ||
        (filters.stockState === "low_stock" &&
          isLowStock(item) &&
          !isOutOfStock(item)) ||
        (filters.stockState === "out_of_stock" && isOutOfStock(item));

      return (
        matchesSearch &&
        matchesCategory &&
        matchesProduct &&
        matchesStatus &&
        matchesStockState
      );
    });
  }, [items, filters]);

  const itemPagination = useTablePagination(filteredItems);
  const paginatedItems = itemPagination.pageItems;

  if (!canView) {
    return (
      <AccessDenied
        title="Inventory is not available"
        description="Your role needs inventory:view access to open this module."
      />
    );
  }

  async function refreshInventoryMasters() {
    const nextMasters = await fetchInventoryMasters(profile);
    setMasters(nextMasters);
    return nextMasters;
  }

  async function openEditItemForm(item: InventoryItem) {
    try {
      const nextMasters = await refreshInventoryMasters();
      const currentSupplier = item.vendor_master
        ? {
            id: item.vendor_master.id,
            organization_id: item.organization_id,
            name: item.vendor_master.name,
            created_at: null,
          }
        : null;

      if (
        currentSupplier &&
        !nextMasters.vendors.some((vendor) => vendor.id === currentSupplier.id)
      ) {
        setMasters({
          ...nextMasters,
          vendors: [...nextMasters.vendors, currentSupplier],
        });
      }

      setItemFormErrors({});
      setItemForm({
        item,
        values: inventoryItemToForm(item),
      });
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load the latest suppliers.",
        "error",
      );
    }
  }

  function openInventoryDetail(itemId: string) {
    navigate(`/inventory/${itemId}`);
  }

  function handleInventoryRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    itemId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openInventoryDetail(itemId);
    }
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!itemForm) {
      return;
    }

    const nextErrors = validateInventoryItemForm(itemForm.values);
    setItemFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setItemSaveAlert({
        title: "Item details missing",
        description:
          inventoryItemValidationSummary(nextErrors) ||
          "Please complete the required item details before saving.",
      });
      return;
    }

    try {
      setSavingItem(true);
      await updateInventoryItem(itemForm.item.id, profile, itemForm.values);
      showToast("Inventory item updated.", "success");

      setItemForm(null);
      await loadData();
    } catch (nextError) {
      setItemSaveAlert({
        title: "Item could not be saved",
        description:
          nextError instanceof Error
            ? nextError.message
            : "Inventory item save failed.",
      });
      showToast(
        nextError instanceof Error ? nextError.message : "Inventory item save failed.",
        "error",
      );
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmDiscontinue() {
    if (!discontinueTarget) {
      return;
    }

    try {
      setDiscontinuing(true);
      await updateInventoryItem(discontinueTarget.id, profile, {
        ...inventoryItemToForm(discontinueTarget),
        status: "discontinued",
      });
      setItems((current) =>
        current.map((item) =>
          item.id === discontinueTarget.id
            ? { ...item, status: "discontinued" }
            : item,
        ),
      );
      showToast("Inventory item marked discontinued.", "success");
      setDiscontinueTarget(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Inventory item status update failed.",
        "error",
      );
    } finally {
      setDiscontinuing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Inventory"
          description="Track stock items, material movement, and project usage."
        />
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InventoryMetricCard label="Total Items" value={items.length} />
        <InventoryMetricCard label="Active Items" value={items.filter((item) => item.status === "active").length} />
        <button
          className={`rounded-xl border p-4 text-left shadow-sm transition ${
            filters.stockState === "low_stock"
              ? "border-amber-300 bg-amber-50"
              : "border-stone-200 bg-white hover:bg-stone-50"
          }`}
          type="button"
          onClick={() =>
            setFilters((current) => ({
              ...current,
              stockState:
                current.stockState === "low_stock" ? "all" : "low_stock",
            }))
          }
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Low Stock
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {lowStockItems.length}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Current stock below alert level
          </p>
        </button>
        <button
          className={`rounded-xl border p-4 text-left shadow-sm transition ${
            filters.stockState === "out_of_stock"
              ? "border-rose-300 bg-rose-50"
              : "border-stone-200 bg-white hover:bg-stone-50"
          }`}
          type="button"
          onClick={() =>
            setFilters((current) => ({
              ...current,
              stockState:
                current.stockState === "out_of_stock" ? "all" : "out_of_stock",
            }))
          }
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            Out of Stock
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {outOfStockItems.length}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Active items with no available stock
          </p>
        </button>
      </section>

      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.8fr)_minmax(180px,0.9fr)_minmax(150px,0.7fr)_minmax(170px,0.8fr)]">
        <SearchInput
          className="block"
          placeholder="Search product, category, brand, specs, or supplier"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <SelectInput
          label="Category"
          value={filters.categoryId}
          onChange={(categoryId) =>
            setFilters((current) => ({
              ...current,
              categoryId,
              productId:
                categoryId && current.productId
                  ? masters.products.find(
                      (product) =>
                        product.id === current.productId &&
                        product.category_id === categoryId,
                    )?.id ?? ""
                  : current.productId,
            }))
          }
          options={[
            { value: "", label: "All categories" },
            ...masters.categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
        />
        <SelectInput
          label="Product"
          value={filters.productId}
          onChange={(productId) =>
            setFilters((current) => ({ ...current, productId }))
          }
          options={[
            { value: "", label: "All products" },
            ...masters.products
              .filter(
                (product) =>
                  !filters.categoryId ||
                  product.category_id === filters.categoryId,
              )
              .map((product) => ({
                value: product.id,
                label: productOptionLabel(product),
              })),
          ]}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { value: "", label: "All statuses" },
            ...inventoryStatusOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
          ]}
        />
        <SelectInput
          label="Stock Filter"
          value={filters.stockState}
          onChange={(stockState) =>
            setFilters((current) => ({
              ...current,
              stockState: stockState as InventoryFilters["stockState"],
            }))
          }
          options={[
            { value: "all", label: "All" },
            { value: "low_stock", label: "Low Stock" },
            { value: "out_of_stock", label: "Out of Stock" },
          ]}
        />
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load inventory" description={error} /> : null}
      {!loading && !error && filteredItems.length === 0 ? (
        <EmptyState
          title="No inventory items found"
          description="Inventory items appear through purchase orders and sales. Adjust the filters to see existing inventory."
        />
      ) : null}

      {!loading && !error && filteredItems.length > 0 ? (
        <>
          <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Model / Specifications</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedItems.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${
                      isOutOfStock(item)
                        ? "bg-rose-50/50 hover:bg-rose-50"
                        : isLowStock(item)
                          ? "bg-amber-50/50 hover:bg-amber-50"
                          : ""
                    }`}
                    onClick={() => openInventoryDetail(item.id)}
                    onKeyDown={(event) =>
                      handleInventoryRowKeyDown(event, item.id)
                    }
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {item.item_code ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[#06173f]">
                        {inventoryProductName(item)}
                      </span>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.catalog_product?.product_code ?? "Product Master"}
                      </p>
                      {isOutOfStock(item) || isLowStock(item) ? (
                        <p
                          className={`mt-1 text-xs font-semibold ${
                            isOutOfStock(item)
                              ? "text-rose-700"
                              : "text-amber-700"
                          }`}
                        >
                          {isOutOfStock(item)
                            ? "Out of stock"
                            : "Low stock warning"}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {item.catalog_product?.category?.name ?? "-"}
                    </td>
                    <td className="px-4 py-3">{inventoryBrandName(item) || "-"}</td>
                    <td className="px-4 py-3">{inventoryModelName(item) || "-"}</td>
                    <td className="px-4 py-3">
                      <InventoryStockBadge item={item} />
                    </td>
                    <td className="px-4 py-3">
                      <InventoryStatusBadge value={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedItems.map((item) => (
              <article
                key={item.id}
                className={`cursor-pointer rounded-xl border p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 ${
                  isOutOfStock(item)
                    ? "border-rose-200 bg-rose-50 hover:bg-rose-50"
                    : isLowStock(item)
                    ? "border-amber-200 bg-amber-50 hover:bg-amber-50"
                    : "border-stone-200 bg-white"
                }`}
                onClick={() => openInventoryDetail(item.id)}
                onKeyDown={(event) =>
                  handleInventoryRowKeyDown(event, item.id)
                }
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {item.item_code ?? "Inventory Item"}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {inventoryProductName(item)}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {item.catalog_product
                        ? [
                            item.catalog_product.product_code,
                            item.catalog_product.category?.name,
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        : "Product Master"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {[inventoryBrandName(item), inventoryModelName(item)]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Stock</dt>
                    <dd className="mt-1">
                      <InventoryStockBadge item={item} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Minimum Alert</dt>
                    <dd className="font-medium text-slate-900">
                      {formatStock(item.minimum_stock, item.unit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Category</dt>
                    <dd className="font-medium text-slate-900">
                      {item.catalog_product?.category?.name ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Model / Specifications</dt>
                    <dd className="font-medium text-slate-900">
                      {inventoryModelName(item) || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Unit</dt>
                    <dd className="font-medium text-slate-900">
                      {item.unit ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd className="mt-1">
                      <InventoryStatusBadge value={item.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Supplier</dt>
                    <dd className="font-medium text-slate-900">
                      {inventoryVendorName(item) || "-"}
                    </dd>
                  </div>
                </dl>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Button
                    onClick={() => openInventoryDetail(item.id)}
                    variant="secondary"
                  >
                    View
                  </Button>
                  {canUpdate ? (
                    <Button onClick={() => openEditItemForm(item)} variant="secondary">
                      Edit
                    </Button>
                  ) : null}
                  {canUpdate && item.status !== "discontinued" ? (
                    <Button
                      onClick={() => setDiscontinueTarget(item)}
                      variant="danger"
                    >
                      Discontinue
                    </Button>
                  ) : null}
                </div>
                {isOutOfStock(item) || isLowStock(item) ? (
                  <p
                    className={`mt-3 rounded-lg border bg-white px-3 py-2 text-sm font-semibold ${
                      isOutOfStock(item)
                        ? "border-rose-200 text-rose-800"
                        : "border-amber-200 text-amber-800"
                    }`}
                  >
                    {isOutOfStock(item) ? "Out of stock" : "Low stock warning"}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
          <TablePagination label="inventory items" pagination={itemPagination} />
        </>
      ) : null}

      {!loading && !error ? (
        <InventoryTransactionsSection transactions={transactions} />
      ) : null}

      {itemForm ? (
        <InventoryItemFormModal
          title="Edit Inventory Item"
          values={itemForm.values}
          setValues={(values) =>
            setItemForm((current) => (current ? { ...current, values } : current))
          }
          masters={masters}
          errors={itemFormErrors}
          onClose={() => setItemForm(null)}
          onSubmit={handleItemSubmit}
          saving={savingItem}
        />
      ) : null}

      {itemSaveAlert ? (
        <AlertDialog
          title={itemSaveAlert.title}
          description={itemSaveAlert.description}
          onClose={() => setItemSaveAlert(null)}
        />
      ) : null}

      {discontinueTarget ? (
        <ConfirmDialog
          title="Mark item discontinued?"
          description={`This keeps ${discontinueTarget.item_name} in past records, but it will not be available for future quotations or project material issues.`}
          confirming={discontinuing}
          confirmLabel="Mark Discontinued"
          confirmingLabel="Updating..."
          onCancel={() => setDiscontinueTarget(null)}
          onConfirm={confirmDiscontinue}
        />
      ) : null}
    </div>
  );
}

function InventoryMetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </section>
  );
}

export function InventoryItemFormModal({
  title,
  values,
  setValues,
  masters,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: InventoryItemFormValues;
  setValues: (values: InventoryItemFormValues) => void;
  masters: InventoryMasters;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof InventoryItemFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const selectedProduct = masters.products.find(
    (product) => product.id === values.catalog_product_id,
  );
  const selectableProducts = masters.products.filter(
    (product) =>
      isSelectableInventoryProduct(product) ||
      product.id === values.catalog_product_id,
  );
  const productPlaceholder =
    selectableProducts.length > 0
      ? "Select product"
      : "No active products in Product Master";

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      noValidate
      submitLabel="Save Item"
      submitting={saving}
    >
      <SelectInput
        label="Product"
        value={values.catalog_product_id}
        onChange={(value) => update("catalog_product_id", value)}
        options={[
          { value: "", label: productPlaceholder },
          ...selectableProducts.map((product) => ({
            value: product.id,
            label: productOptionLabel(product),
          })),
        ]}
      />
      {errors.catalog_product_id ? (
        <p className="-mt-3 text-xs text-rose-700">
          {errors.catalog_product_id}
        </p>
      ) : null}
      {masters.products.length === 0 ? (
        <section className="-mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900 md:col-span-2">
          Add products in Products & Materials first, then create inventory
          stock against those Product Master records.
        </section>
      ) : selectableProducts.length === 0 ? (
        <section className="-mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900 md:col-span-2">
          Product Master records are available, but none are active for inventory
          selection.
        </section>
      ) : null}
      <ProductSnapshot product={selectedProduct} />
      <SelectInput
        label="Supplier"
        value={values.vendor_id}
        onChange={(value) => update("vendor_id", value)}
        options={[
          { value: "", label: "No supplier linked" },
          ...masters.vendors.map((vendor) => ({
            value: vendor.id,
            label: vendor.name,
          })),
        ]}
      />
      <TextInput
        label="Current Stock"
        type="number"
        value={values.current_stock}
        onChange={(value) => update("current_stock", value)}
        error={errors.current_stock}
      />
      <TextInput
        label="Opening Stock"
        type="number"
        value={values.opening_stock}
        onChange={(value) => update("opening_stock", value)}
        error={errors.opening_stock}
      />
      <TextInput
        label="Minimum Alert"
        type="number"
        value={values.minimum_alert}
        onChange={(value) => update("minimum_alert", value)}
        error={errors.minimum_alert}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) =>
          update("status", value as InventoryItemFormValues["status"])
        }
        options={inventoryStatusOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <TextInput
        label="Bill No."
        value={values.bill_no}
        onChange={(value) => update("bill_no", value)}
      />
      <TextInput
        label="Inventory Date"
        type="date"
        value={values.inventory_date}
        onChange={(value) => update("inventory_date", value)}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

export function InventoryTransactionFormModal({
  title,
  values,
  setValues,
  errors,
  items,
  projects,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: InventoryTransactionFormValues;
  setValues: (values: InventoryTransactionFormValues) => void;
  errors: Record<string, string>;
  items: InventoryItem[];
  projects: InventoryProjectOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof InventoryTransactionFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const selectedItem = items.find((item) => item.id === values.item_id);
  const selectableItems =
    values.transaction_type === "project_issue"
      ? items.filter((item) => item.status === "active")
      : items;

  function handleTypeChange(value: string) {
    const transactionType = value as InventoryTransactionType;
    setValues({
      ...values,
      transaction_type: transactionType,
      project_id:
        transactionType === "project_issue" ? values.project_id : "",
    });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Transaction"
      submitting={saving}
    >
      <SelectInput
        label="Item"
        value={values.item_id}
        onChange={(value) => update("item_id", value)}
        options={[
          { value: "", label: "Select item" },
          ...selectableItems.map((item) => ({
            value: item.id,
            label: `${item.item_code ?? "Item"} - ${inventoryItemTitle(item) || item.item_name}`,
          })),
        ]}
      />
      {errors.item_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.item_id}</p>
      ) : null}
      <SelectInput
        label="Transaction Type"
        value={values.transaction_type}
        onChange={handleTypeChange}
        options={inventoryTransactionTypeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <TextInput
        label={
          values.transaction_type === "adjustment"
            ? "Quantity Adjustment"
            : "Quantity"
        }
        type="number"
        value={values.quantity}
        onChange={(value) => update("quantity", value)}
        error={errors.quantity}
        required
      />
      <TextInput
        label="Transaction Date"
        type="date"
        value={values.transaction_date}
        onChange={(value) => update("transaction_date", value)}
      />
      <SelectInput
        label="Project"
        value={values.project_id}
        onChange={(value) => update("project_id", value)}
        options={[
          {
            value: "",
            label:
              values.transaction_type === "project_issue"
                ? "Select project"
                : "No project linked",
          },
          ...projects.map((project) => ({
            value: project.id,
            label: `${project.project_code ?? "Project"} - ${
              project.project_name ?? "Installation"
            }`,
          })),
        ]}
      />
      {errors.project_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.project_id}</p>
      ) : null}
      <TextInput
        label="Reference Type"
        value={values.reference_type}
        onChange={(value) => update("reference_type", value)}
      />
      <TextInput
        label="Reference ID"
        value={values.reference_id}
        onChange={(value) => update("reference_id", value)}
      />
      {selectedItem ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
          Available stock:{" "}
          <span className="font-semibold text-slate-950">
            {formatStock(
              selectedItem.available_qty ?? selectedItem.current_stock,
              selectedItem.unit,
            )}
          </span>
          {Number(selectedItem.reserved_qty ?? 0) > 0 ? (
            <span className="text-slate-500">
              {" "}
              ({formatStock(selectedItem.reserved_qty, selectedItem.unit)} reserved)
            </span>
          ) : null}
        </div>
      ) : null}
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

function productOptionLabel(product: InventoryCatalogProduct) {
  return [
    product.product_code,
    product.product_name,
    product.category?.name,
    product.brand,
    product.model_number ?? product.specifications,
  ]
    .filter(Boolean)
    .join(" - ");
}

function isSelectableInventoryProduct(product: InventoryCatalogProduct) {
  return !product.status || product.status === "active";
}

function ProductSnapshot({
  product,
}: {
  product: InventoryCatalogProduct | undefined;
}) {
  if (!product) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900 md:col-span-2">
        Select an active Product Master item before saving inventory.
      </section>
    );
  }

  const details = [
    ["Category", product.category?.name ?? "-"],
    ["Brand", product.brand ?? "-"],
    ["Model / Specifications", product.model_number ?? product.specifications ?? "-"],
    ["Unit", product.unit],
    ["HSN", product.hsn_code ?? "-"],
  ];

  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50 p-3 md:col-span-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-950">
          {product.product_name}
        </h3>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {product.product_code}
        </span>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function InventoryTransactionsSection({
  transactions,
  emptyTitle = "No stock transactions yet",
}: {
  transactions: InventoryTransactionWithRelations[];
  emptyTitle?: string;
}) {
  const transactionPagination = useTablePagination(transactions);
  const paginatedTransactions = transactionPagination.pageItems;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Inventory Transactions
        </h2>
        <p className="text-sm text-slate-500">{transactions.length} records</p>
      </div>
      {transactions.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description="Stock movements will appear here after materials are received, adjusted, returned, or issued."
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Usage</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Created By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-4 py-3">
                      {formatDate(transaction.transaction_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {transaction.item?.item_name ?? "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {transaction.item?.item_code ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TransactionTypeBadge value={transaction.transaction_type} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatStock(transaction.quantity, transaction.item?.unit)}
                    </td>
                    <td className="px-4 py-3">
                      <TransactionUsage transaction={transaction} />
                    </td>
                    <td className="px-4 py-3">{transaction.notes ?? "-"}</td>
                    <td className="px-4 py-3">
                      {transaction.creator?.full_name ??
                        transaction.creator?.email ??
                        transaction.creator?.phone ??
                        "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-3 lg:hidden">
            {paginatedTransactions.map((transaction) => (
              <article
                key={transaction.id}
                className="rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(transaction.transaction_date)}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-950">
                      {transaction.item?.item_name ?? "Inventory item"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {transaction.item?.item_code ?? ""}
                    </p>
                  </div>
                  <TransactionTypeBadge value={transaction.transaction_type} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Quantity</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatStock(transaction.quantity, transaction.item?.unit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Usage</dt>
                    <dd className="text-slate-900">
                      <TransactionUsage transaction={transaction} />
                    </dd>
                  </div>
                </dl>
                {transaction.notes ? (
                  <p className="mt-3 text-sm text-slate-600">
                    {transaction.notes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
          <TablePagination
            label="transactions"
            pagination={transactionPagination}
          />
        </div>
      )}
    </section>
  );
}

function TransactionUsage({
  transaction,
}: {
  transaction: InventoryTransactionWithRelations;
}) {
  if (transaction.project_id) {
    return (
      <div className="space-y-0.5">
        <Link
          className="font-semibold text-[#06173f]"
          to={`/projects/${transaction.project_id}`}
        >
          {transaction.project?.project_code ??
            transaction.project?.project_name ??
            "Open project"}
        </Link>
        <p className="text-xs text-slate-500">
          Project
          {transaction.project?.project_name
            ? ` - ${transaction.project.project_name}`
            : ""}
        </p>
      </div>
    );
  }

  if (
    transaction.reference_type === "b2b_sale" &&
    transaction.reference_id
  ) {
    return (
      <div className="space-y-0.5">
        <Link
          className="font-semibold text-[#06173f]"
          to={`/b2b-sales/${transaction.reference_id}`}
        >
          {transaction.b2b_sale?.sale_code ?? "Open B2B sale"}
        </Link>
        <p className="text-xs text-slate-500">
          B2B Sales
          {transaction.b2b_sale?.status
            ? ` - ${labelize(transaction.b2b_sale.status)}`
            : ""}
        </p>
      </div>
    );
  }

  if (transaction.reference_type) {
    return (
      <span className="font-medium text-slate-900">
        {labelize(transaction.reference_type)}
      </span>
    );
  }

  return <span className="text-slate-500">-</span>;
}

export function InventoryStockBadge({ item }: { item: InventoryItem }) {
  const outOfStock = isOutOfStock(item);
  const lowStock = isLowStock(item);
  const reservedQty = Number(item.reserved_qty ?? 0);
  return (
    <div className="space-y-1">
      <Badge tone={outOfStock ? "red" : lowStock ? "amber" : "green"}>
        Available {formatStock(availableStockNumber(item), item.unit)}
      </Badge>
      {reservedQty > 0 ? (
        <p className="text-xs font-medium text-slate-500">
          {formatStock(item.current_stock, item.unit)} physical /{" "}
          {formatStock(reservedQty, item.unit)} reserved
        </p>
      ) : null}
    </div>
  );
}

export function InventoryStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  const tone =
    value === "active" ? "green" : value === "inactive" ? "amber" : "red";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}

export function TransactionTypeBadge({
  value,
}: {
  value: InventoryTransactionType;
}) {
  const tone = transactionDecreasesStock(value)
    ? "red"
    : value === "adjustment"
      ? "amber"
      : "green";

  return <Badge tone={tone}>{transactionTypeLabel(value)}</Badge>;
}
