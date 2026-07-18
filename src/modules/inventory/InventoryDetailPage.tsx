import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
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
  PencilIcon,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
} from "../crm/crmUtils";
import {
  fetchInventoryItem,
  fetchInventoryMasters,
  fetchInventoryTransactions,
  updateInventoryItem,
} from "./inventoryApi";
import {
  formatStock,
  inventoryBrandName,
  inventoryModelName,
  inventoryProductName,
  inventoryItemToForm,
  inventoryItemValidationSummary,
  isLowStock,
  validateInventoryItemForm,
} from "./inventoryUtils";
import {
  InventoryItemFormModal,
  InventoryStatusBadge,
  InventoryStockBadge,
  InventoryTransactionsSection,
} from "./InventoryPage";
import type {
  InventoryItem,
  InventoryItemFormValues,
  InventoryMasters,
  InventoryTransactionWithRelations,
} from "./types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";

export function InventoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [masters, setMasters] = useState<InventoryMasters>({
    products: [],
    categories: [],
    vendors: [],
  });
  const [transactions, setTransactions] = useState<
    InventoryTransactionWithRelations[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<InventoryItemFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [itemSaveAlert, setItemSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [confirmingDiscontinue, setConfirmingDiscontinue] = useState(false);
  const [discontinuing, setDiscontinuing] = useState(false);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canUpdate = hasPermission(profile, permissions, "inventory", "update");
  const canDelete = hasPermission(profile, permissions, "inventory", "delete");

  async function loadItem() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextItem, nextTransactions, nextMasters] =
        await Promise.all([
          fetchInventoryItem(profile, id),
          fetchInventoryTransactions(profile, id),
          fetchInventoryMasters(profile),
        ]);
      setItem(nextItem);
      setTransactions(nextTransactions);
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

  async function openEditForm() {
    if (!item) {
      return;
    }

    try {
      const nextMasters = await fetchInventoryMasters(profile);
      setMasters(nextMasters);
      setFormErrors({});
      setEditing(inventoryItemToForm(item));
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load the latest suppliers.",
        "error",
      );
    }
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
      <Link className="text-sm font-semibold text-[#06173f]" to="/inventory">
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
            <RecordTitle
              recordType="Inventory Item"
              name={inventoryProductName(item)}
              meta={[
                item.item_code ?? "Inventory item",
                inventoryBrandName(item),
                inventoryModelName(item),
              ]}
              action={
                canUpdate && !item.archived_at ? (
                  <button
                    aria-label="Edit inventory item"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                    onClick={openEditForm}
                    title="Edit inventory item"
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                ) : null
              }
            />
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
            <DetailItem label="Brand" value={inventoryBrandName(item) || "-"} />
            <DetailItem
              label="Model / Specifications"
              value={inventoryModelName(item) || "-"}
            />
            <DetailItem label="HSN Code" value={item.catalog_product?.hsn_code ?? "-"} />
            <DetailItem
              label="Opening Stock"
              value={formatStock(item.opening_stock, item.unit)}
            />
            <DetailItem
              label="Inventory Date"
              value={formatDate(item.inventory_date)}
            />
            <DetailItem label="Created" value={formatDate(item.created_at)} />
            <DetailItem label="Notes" value={item.notes ?? "-"} />
          </DetailSection>

          <InventoryTransactionsSection transactions={transactions} />


          {canUpdate && !item.archived_at && item.status !== "discontinued" ? (
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

          <RecordLifecyclePanel
            archiveReason={item.archive_reason}
            archivedAt={item.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="inventory_items"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Inventory item permanently deleted.", "success");
                navigate("/inventory");
                return;
              }
              showToast(action === "archive" ? "Inventory item archived." : "Inventory item restored.", "success");
              await loadItem();
            }}
            recordId={item.id}
            recordLabel={item.item_code || item.item_name}
          />
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
