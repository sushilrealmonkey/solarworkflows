import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
} from "../crm/crmUtils";
import {
  createInventoryTransaction,
  fetchInventoryBatches,
  fetchInventoryItem,
  fetchInventoryItems,
  fetchInventoryMasters,
  fetchInventoryProjectOptions,
  fetchInventoryTransactions,
  updateInventoryItem,
} from "./inventoryApi";
import {
  emptyInventoryTransactionForm,
  formatStock,
  inventoryBrandName,
  inventoryModelName,
  inventoryProductName,
  inventoryVendorName,
  inventoryItemToForm,
  inventoryItemValidationSummary,
  isLowStock,
  validateInventoryItemForm,
  validateTransactionForm,
} from "./inventoryUtils";
import {
  InventoryItemFormModal,
  InventoryStatusBadge,
  InventoryStockBadge,
  InventoryTransactionFormModal,
  InventoryTransactionsSection,
} from "./InventoryPage";
import { fetchPurchaseOrders } from "../purchases/purchaseApi";
import { PurchaseOrdersSection } from "../purchases/PurchasesPage";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import type {
  InventoryItem,
  InventoryBatch,
  InventoryItemFormValues,
  InventoryMasters,
  InventoryProjectOption,
  InventoryTransactionFormValues,
  InventoryTransactionWithRelations,
} from "./types";

export function InventoryDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [masters, setMasters] = useState<InventoryMasters>({
    products: [],
    categories: [],
    vendors: [],
  });
  const [transactions, setTransactions] = useState<
    InventoryTransactionWithRelations[]
  >([]);
  const [purchaseOrders, setPurchaseOrders] = useState<
    PurchaseOrderWithRelations[]
  >([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [projects, setProjects] = useState<InventoryProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InventoryItemFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [itemSaveAlert, setItemSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [transactionForm, setTransactionForm] =
    useState<InventoryTransactionFormValues | null>(null);
  const [transactionFormErrors, setTransactionFormErrors] = useState<
    Record<string, string>
  >({});
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [confirmingDiscontinue, setConfirmingDiscontinue] = useState(false);
  const [discontinuing, setDiscontinuing] = useState(false);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canCreate = hasPermission(profile, permissions, "inventory", "create");
  const canUpdate = hasPermission(profile, permissions, "inventory", "update");

  async function loadItem() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [
        nextItem,
        nextItems,
        nextTransactions,
        nextProjects,
        nextPurchaseOrders,
        nextBatches,
        nextMasters,
      ] =
        await Promise.all([
          fetchInventoryItem(profile, id),
          fetchInventoryItems(profile),
          fetchInventoryTransactions(profile, id),
          fetchInventoryProjectOptions(profile),
          fetchPurchaseOrders(
            profile,
            { itemId: id },
            { includePricing: false },
          ),
          fetchInventoryBatches(id),
          fetchInventoryMasters(profile),
        ]);
      setItem(nextItem);
      setItems(nextItems);
      setTransactions(nextTransactions);
      setProjects(nextProjects);
      setPurchaseOrders(nextPurchaseOrders);
      setBatches(nextBatches);
      setMasters(nextMasters);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load inventory item.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItem();
    // loadItem closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Inventory details are not available"
        description="Your role needs inventory:view access to open inventory item details."
      />
    );
  }

  function openTransactionForm() {
    if (!item) {
      return;
    }

    setTransactionFormErrors({});
    setTransactionForm(emptyInventoryTransactionForm(item.id));
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!item || !editing) {
      return;
    }

    const nextErrors = validateInventoryItemForm(editing);
    setFormErrors(nextErrors);

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
      setSaving(true);
      await updateInventoryItem(item.id, profile, editing);
      setEditing(null);
      showToast("Inventory item updated.", "success");
      await loadItem();
    } catch (nextError) {
      setItemSaveAlert({
        title: "Item could not be saved",
        description:
          nextError instanceof Error
            ? nextError.message
            : "Inventory item update failed.",
      });
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Inventory item update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTransactionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!transactionForm) {
      return;
    }

    const nextErrors = validateTransactionForm(transactionForm, items);
    setTransactionFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingTransaction(true);
      await createInventoryTransaction(profile, transactionForm);
      setTransactionForm(null);
      showToast("Stock transaction added.", "success");
      await loadItem();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Stock transaction failed.",
        "error",
      );
    } finally {
      setSavingTransaction(false);
    }
  }

  async function handleDiscontinue() {
    if (!item) {
      return;
    }

    try {
      setDiscontinuing(true);
      const updatedItem = await updateInventoryItem(item.id, profile, {
        ...inventoryItemToForm(item),
        status: "discontinued",
      });
      setItem(updatedItem);
      showToast("Inventory item marked discontinued.", "success");
      setConfirmingDiscontinue(false);
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
      <Link className="text-sm font-semibold text-brand-700" to="/inventory">
        Back to inventory
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load inventory item" description={error} />
      ) : null}
      {!loading && !error && !item ? (
        <EmptyState
          title="Inventory item not found"
          description="This item may have been deleted or is outside your organization access."
        />
      ) : null}

      {item ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={inventoryProductName(item)}
              description={[
                item.item_code ?? "Inventory item",
                inventoryBrandName(item),
                inventoryModelName(item),
              ]
                .filter(Boolean)
                .join(" / ")}
            />
            <div className="flex flex-wrap gap-2">
              {canCreate ? (
                <Button onClick={openTransactionForm}>Add Transaction</Button>
              ) : null}
              {canUpdate ? (
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(inventoryItemToForm(item));
                  }}
                  variant="secondary"
                >
                  Edit Item
                </Button>
              ) : null}
            </div>
          </div>

          {isLowStock(item) ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-sm">
              Low stock warning: current stock is at or below the configured
              minimum.
            </section>
          ) : null}

          <DetailSection title="Stock Details">
            <DetailItem label="Available Stock" value={<InventoryStockBadge item={item} />} />
            <DetailItem
              label="Physical Stock"
              value={formatStock(item.current_stock, item.unit)}
            />
            <DetailItem
              label="Reserved Stock"
              value={formatStock(item.reserved_qty ?? 0, item.unit)}
            />
            <DetailItem
              label="Minimum Alert"
              value={formatStock(item.minimum_stock, item.unit)}
            />
            <DetailItem label="Unit" value={item.unit ?? "-"} />
            <DetailItem
              label="Status"
              value={<InventoryStatusBadge value={item.status} />}
            />
          </DetailSection>

          <DetailSection title="Item Details">
            <DetailItem label="Item Code" value={item.item_code ?? "-"} />
            <DetailItem label="Product" value={inventoryProductName(item)} />
            <DetailItem
              label="Product Code"
              value={item.catalog_product?.product_code ?? "-"}
            />
            <DetailItem
              label="Category"
              value={item.catalog_product?.category?.name ?? "-"}
            />
            <DetailItem
              label="Product Type"
              value={item.catalog_product?.product_type?.name ?? "-"}
            />
            <DetailItem label="Brand" value={inventoryBrandName(item) || "-"} />
            <DetailItem
              label="Model / Specifications"
              value={inventoryModelName(item) || "-"}
            />
            <DetailItem label="HSN Code" value={item.catalog_product?.hsn_code ?? "-"} />
            <DetailItem
              label="Vendor"
              value={inventoryVendorName(item) || "-"}
            />
            <DetailItem
              label="Opening Stock"
              value={formatStock(item.opening_stock, item.unit)}
            />
            <DetailItem label="Bill No." value={item.bill_no ?? "-"} />
            <DetailItem
              label="Inventory Date"
              value={formatDate(item.inventory_date)}
            />
            <DetailItem label="Created" value={formatDate(item.created_at)} />
            <DetailItem label="Notes" value={item.notes ?? "-"} />
          </DetailSection>

          <InventoryTransactionsSection
            transactions={transactions}
            emptyTitle="No transactions for this item"
          />

          <InventoryBatchesSection
            batches={batches}
            unit={item.unit}
          />

          <PurchaseOrdersSection
            orders={purchaseOrders}
            canManageStatus={false}
            canReceive={false}
            showPricing={false}
            emptyTitle="No purchase history for this item"
          />

          {canUpdate && item.status !== "discontinued" ? (
            <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-rose-900">
                    Discontinue Item
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Keep this item in past inventory, quotation, and project
                    records, but remove it from future quotation and project
                    material selections.
                  </p>
                </div>
                <Button
                  onClick={() => setConfirmingDiscontinue(true)}
                  variant="danger"
                >
                  Mark Discontinued
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <InventoryItemFormModal
          title="Edit Inventory Item"
          values={editing}
          setValues={setEditing}
          masters={masters}
          errors={formErrors}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {itemSaveAlert ? (
        <AlertDialog
          title={itemSaveAlert.title}
          description={itemSaveAlert.description}
          onClose={() => setItemSaveAlert(null)}
        />
      ) : null}

      {transactionForm ? (
        <InventoryTransactionFormModal
          title="Add Stock Transaction"
          values={transactionForm}
          setValues={setTransactionForm}
          errors={transactionFormErrors}
          items={items}
          projects={projects}
          onClose={() => setTransactionForm(null)}
          onSubmit={handleTransactionSubmit}
          saving={savingTransaction}
        />
      ) : null}

      {confirmingDiscontinue && item ? (
        <ConfirmDialog
          title="Mark item discontinued?"
          description={`This keeps ${item.item_name} in past records, but it will not be available for future quotations or project material issues.`}
          confirming={discontinuing}
          confirmLabel="Mark Discontinued"
          confirmingLabel="Updating..."
          onCancel={() => setConfirmingDiscontinue(false)}
          onConfirm={handleDiscontinue}
        />
      ) : null}
    </div>
  );
}

function InventoryBatchesSection({
  batches,
  unit,
}: {
  batches: InventoryBatch[];
  unit: string | null;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Received Batches
        </h2>
        <p className="text-sm text-slate-500">{batches.length} records</p>
      </div>
      {batches.length === 0 ? (
        <EmptyState
          title="No received batches"
          description="Purchase receiving batches for this item will appear here."
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Received Date</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Received Qty</th>
                  <th className="px-4 py-3">Remaining Qty</th>
                  <th className="px-4 py-3">Bill No.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-3">
                      {formatDate(batch.received_date)}
                    </td>
                    <td className="px-4 py-3">{batch.vendor_name ?? "-"}</td>
                    <td className="px-4 py-3">
                      {formatStock(batch.received_quantity, unit)}
                    </td>
                    <td className="px-4 py-3">
                      {formatStock(batch.remaining_quantity, unit)}
                    </td>
                    <td className="px-4 py-3">{batch.bill_no ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-3 lg:hidden">
            {batches.map((batch) => (
              <article
                key={batch.id}
                className="rounded-lg border border-stone-200 bg-white p-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatDate(batch.received_date)} / {batch.vendor_name ?? "-"}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Received</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatStock(batch.received_quantity, unit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Remaining</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatStock(batch.remaining_quantity, unit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Bill No.</dt>
                    <dd className="font-medium text-slate-900">
                      {batch.bill_no ?? "-"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
