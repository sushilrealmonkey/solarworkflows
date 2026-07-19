import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  PencilIcon,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasPermission,
} from "../crm/crmUtils";
import {
  correctInventoryStock,
  fetchInventoryItem,
  fetchInventoryTransactions,
  updateInventoryItem,
} from "./inventoryApi";
import {
  emptyInventoryStockCorrection,
  formatStock,
  inventoryBrandName,
  inventoryModelName,
  inventoryProductName,
  inventoryItemToForm,
  inventoryItemValidationSummary,
  isLowStock,
  validateInventoryItemForm,
  validateInventoryStockCorrection,
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
  InventoryStockCorrectionValues,
  InventoryTransactionWithRelations,
} from "./types";

export function InventoryDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [item, setItem] = useState<InventoryItem | null>(null);
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
  const [correction, setCorrection] =
    useState<InventoryStockCorrectionValues | null>(null);
  const [correctionErrors, setCorrectionErrors] = useState<
    Record<string, string>
  >({});
  const [correcting, setCorrecting] = useState(false);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canCreate = hasPermission(profile, permissions, "inventory", "create");
  const canUpdate = hasPermission(profile, permissions, "inventory", "update");
  const canCorrect = canCreate && canUpdate;

  async function loadItem() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextItem, nextTransactions] = await Promise.all([
        fetchInventoryItem(profile, id),
        fetchInventoryTransactions(profile, id),
      ]);
      setItem(nextItem);
      setTransactions(nextTransactions);
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

  function openEditForm() {
    if (!item) {
      return;
    }

    setFormErrors({});
    setEditing(inventoryItemToForm(item));
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

  async function handleCorrectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!item || !correction) {
      return;
    }

    const nextErrors = validateInventoryStockCorrection(correction);
    setCorrectionErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setCorrecting(true);
      await correctInventoryStock(item.id, correction);
      setCorrection(null);
      showToast("Physical stock corrected and recorded in the ledger.", "success");
      await loadItem();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Stock correction failed.",
        "error",
      );
    } finally {
      setCorrecting(false);
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
          description="This item may be inactive or outside your organization access."
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
                !item.archived_at && (canUpdate || canCorrect) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {canCorrect ? (
                      <Button
                        onClick={() => {
                          setCorrectionErrors({});
                          setCorrection(emptyInventoryStockCorrection(item));
                        }}
                        variant="secondary"
                      >
                        Correct Stock
                      </Button>
                    ) : null}
                    {canUpdate ? (
                      <button
                        aria-label="Edit inventory settings"
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                        onClick={openEditForm}
                        title="Edit inventory settings"
                        type="button"
                      >
                        <PencilIcon />
                      </button>
                    ) : null}
                  </div>
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

          <InventoryTransactionsSection
            detailView
            transactions={transactions}
          />
        </>
      ) : null}

      {editing ? (
        <InventoryItemFormModal
          title="Edit Inventory Item"
          values={editing}
          setValues={setEditing}
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

      {correction && item ? (
        <Modal
          title="Correct Physical Stock"
          onClose={() => setCorrection(null)}
          onSubmit={handleCorrectionSubmit}
          submitLabel="Record Stock Correction"
          submitting={correcting}
        >
          <section className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700 md:col-span-2">
            Current physical stock: {formatStock(item.current_stock, item.unit)}.
            Enter the quantity physically counted; the signed adjustment is
            calculated automatically.
          </section>
          <TextInput
            label={`Counted Stock${item.unit ? ` (${item.unit})` : ""}`}
            type="number"
            value={correction.counted_quantity}
            onChange={(counted_quantity) =>
              setCorrection({ ...correction, counted_quantity })
            }
            error={correctionErrors.counted_quantity}
            required
          />
          <TextInput
            label="Correction Date"
            type="date"
            value={correction.correction_date}
            onChange={(correction_date) =>
              setCorrection({ ...correction, correction_date })
            }
            error={correctionErrors.correction_date}
            required
          />
          <TextArea
            label="Correction Reason *"
            value={correction.reason}
            onChange={(reason) => setCorrection({ ...correction, reason })}
          />
          {correctionErrors.reason ? (
            <p className="-mt-3 text-xs text-rose-700 md:col-span-2">
              {correctionErrors.reason}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
