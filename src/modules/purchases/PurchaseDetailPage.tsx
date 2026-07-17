import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  PencilIcon,
  PlaceholderAction,
} from "../crm/CrmComponents";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import {
  formatDate,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { fetchInventoryItems } from "../inventory/inventoryApi";
import { formatCurrency, formatStock } from "../inventory/inventoryUtils";
import {
  fetchPurchaseOrderPdfPreviewUrl,
  generateAndStorePurchaseOrderPdf,
} from "./purchasePdfWorkflow";
import {
  fetchPurchaseOrder,
  fetchPurchaseOrderSafe,
  fetchPurchasePriceDefaults,
  fetchPurchaseVendorOptions,
  receivePurchaseOrderItems,
  updatePurchaseOrder,
} from "./purchaseApi";
import {
  emptyPurchaseReceiveForm,
  formatPurchaseCode,
  hasPurchaseReceiveFormErrors,
  hasPurchaseOrderFormErrors,
  purchaseOrderToForm,
  validatePurchaseOrderForm,
  validatePurchaseReceiveForm,
} from "./purchaseUtils";
import {
  PurchaseOrderFormModal,
  PurchaseReceiveFormModal,
  PurchaseStatusBadge,
} from "./PurchasesPage";
import type {
  PurchaseOrderFormValues,
  PurchaseOrderWithRelations,
  PurchaseReceiveFormValues,
} from "./types";
import type { InventoryItem } from "../inventory/types";
import type { Vendor } from "../vendors/types";

type PurchaseReceiveFormErrors = ReturnType<typeof validatePurchaseReceiveForm>;
type PurchaseFormErrors = ReturnType<typeof validatePurchaseOrderForm>;
type PurchaseVendorOption = Pick<
  Vendor,
  "id" | "vendor_code" | "vendor_name" | "contact_person" | "phone"
>;

export function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, permissions, roleNames, organization } = useAuth();
  const { showToast } = useToast();
  const [order, setOrder] = useState<PurchaseOrderWithRelations | null>(null);
  const [vendors, setVendors] = useState<PurchaseVendorOption[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [priceDefaults, setPriceDefaults] = useState(
    new Map<string, { current_purchase_price: number | null; gst_percent: number | null }>(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PurchaseOrderFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<PurchaseFormErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiveForm, setReceiveForm] = useState<PurchaseReceiveFormValues | null>(
    null,
  );
  const [receiveFormErrors, setReceiveFormErrors] =
    useState<PurchaseReceiveFormErrors | null>(null);
  const [updating, setUpdating] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [preparingPdf, setPreparingPdf] = useState(false);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );
  const canUpdatePricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "update",
  );
  const canManageStatus =
    hasPermission(profile, permissions, "inventory", "update") &&
    canUpdatePricing;
  const canCreateItems = hasPermission(
    profile,
    permissions,
    "inventory",
    "create",
  );
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
  const canGeneratePurchasePdf = canCreateDocuments && canViewPricing;
  const purchaseHasReceipt = Boolean(
    order?.items?.some((item) => (item.received_quantity ?? 0) > 0) ||
      order?.status === "partially_received" ||
      order?.status === "received",
  );
  const canEditPurchaseOrder =
    canViewPricing &&
    canManageStatus &&
    !purchaseHasReceipt &&
    !order?.archived_at &&
    order?.status !== "cancelled";

  async function loadOrder() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextOrder, nextVendors, nextItems] = await Promise.all([
        canViewPricing
          ? fetchPurchaseOrder(profile, id)
          : fetchPurchaseOrderSafe(id),
        fetchPurchaseVendorOptions(),
        fetchInventoryItems(profile),
      ]);
      setOrder(nextOrder);
      setVendors(
        nextOrder?.vendor &&
          !nextVendors.some((vendor) => vendor.id === nextOrder.vendor?.id)
          ? [...nextVendors, nextOrder.vendor]
          : nextVendors,
      );
      setItems(nextItems);
      setPriceDefaults(
        canViewPricing ? await fetchPurchasePriceDefaults(nextItems) : new Map(),
      );
      if (nextOrder && canGeneratePurchasePdf) {
        await loadPdfPreview(nextOrder);
      } else {
        setPdfPreviewUrl(null);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load purchase order.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrder();
    // loadOrder closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, id, profile]);

  if (!canView) {
    return (
      <AccessDenied
        title="Purchase details are not available"
        description="Your role needs inventory:view access to open purchase details."
      />
    );
  }

  function openReceiveForm() {
    if (!order) {
      return;
    }

    setReceiveForm(emptyPurchaseReceiveForm(order));
    setReceiveFormErrors(null);
  }

  async function openEditForm() {
    if (!order) {
      return;
    }

    try {
      const nextVendors = await fetchPurchaseVendorOptions();
      setVendors(
        order.vendor &&
          !nextVendors.some((vendor) => vendor.id === order.vendor?.id)
          ? [...nextVendors, order.vendor]
          : nextVendors,
      );
      setFormErrors(null);
      setEditing(purchaseOrderToForm(order));
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

    if (!order || !editing) {
      return;
    }

    const nextErrors = validatePurchaseOrderForm(editing);
    setFormErrors(nextErrors);

    if (hasPurchaseOrderFormErrors(nextErrors)) {
      return;
    }

    try {
      setSaving(true);
      await updatePurchaseOrder(profile, order.id, editing);
      const nextOrder = await fetchPurchaseOrder(profile, order.id);

      if (canGeneratePurchasePdf) {
        try {
          const result = await generateAndStorePurchaseOrderPdf(
            profile,
            organization,
            nextOrder,
          );
          setPdfPreviewUrl(result.previewUrl);
        } catch (pdfError) {
          showToast(
            pdfError instanceof Error
              ? `Purchase order updated, but PDF refresh failed: ${pdfError.message}`
              : "Purchase order updated, but PDF refresh failed.",
            "error",
          );
        }
      }

      setEditing(null);
      showToast("Purchase order updated.", "success");
      await loadOrder();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase order update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReceiveSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!order || !receiveForm) {
      return;
    }

    const nextErrors = validatePurchaseReceiveForm(receiveForm);
    setReceiveFormErrors(nextErrors);

    if (hasPurchaseReceiveFormErrors(nextErrors)) {
      return;
    }

    try {
      setUpdating(true);
      await receivePurchaseOrderItems(order.id, receiveForm);
      setReceiveForm(null);
      showToast("Purchase received and stock updated.", "success");
      await loadOrder();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase receiving failed.",
        "error",
      );
    } finally {
      setUpdating(false);
    }
  }

  async function loadPdfPreview(targetOrder: PurchaseOrderWithRelations) {
    try {
      setPreparingPdf(true);
      const existingPreviewUrl = await fetchPurchaseOrderPdfPreviewUrl(targetOrder);
      if (existingPreviewUrl) {
        setPdfPreviewUrl(existingPreviewUrl);
        return;
      }

      if (!canGeneratePurchasePdf) {
        setPdfPreviewUrl(null);
        return;
      }

      const result = await generateAndStorePurchaseOrderPdf(
        profile,
        organization,
        targetOrder,
      );
      setPdfPreviewUrl(result.previewUrl);
    } catch {
      setPdfPreviewUrl(null);
    } finally {
      setPreparingPdf(false);
    }
  }

  async function handleDownloadPdf() {
    if (!order) {
      return;
    }

    if (pdfPreviewUrl) {
      window.open(pdfPreviewUrl, "_blank", "noreferrer");
      return;
    }

    if (!canGeneratePurchasePdf) {
      showToast(
        "Your role needs documents:create and purchase pricing access to download PO PDFs.",
        "error",
      );
      return;
    }

    try {
      setPreparingPdf(true);
      const result = await generateAndStorePurchaseOrderPdf(
        profile,
        organization,
        order,
      );
      setPdfPreviewUrl(result.previewUrl);
      window.open(result.previewUrl, "_blank", "noreferrer");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase order PDF download failed.",
        "error",
      );
    } finally {
      setPreparingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/purchases">
        Back to purchase orders
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load purchase order" description={error} />
      ) : null}
      {!loading && !error && !order ? (
        <EmptyState
          title="Purchase order not found"
          description="This purchase order may have been deleted or is outside your organization access."
        />
      ) : null}

      {order ? (
        <>
          <div className="border-b border-stone-200 pb-5">
            <RecordTitle
              recordType="Purchase Order"
              name={formatPurchaseCode(order.purchase_code)}
              action={
                canEditPurchaseOrder ? (
                  <button
                    aria-label="Edit purchase order"
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-stone-50 hover:text-slate-950"
                    onClick={openEditForm}
                    title="Edit purchase order"
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                ) : null
              }
              meta={[
                order.vendor?.vendor_name ?? "Supplier",
                labelize(order.status),
                formatDate(order.order_date),
                canViewPricing ? formatCurrency(order.total_amount) : null,
              ]}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Purchase Details">
                <DetailItem
                  label="Purchase Code"
                  value={formatPurchaseCode(order.purchase_code)}
                />
                <DetailItem
                  label="Status"
                  value={<PurchaseStatusBadge value={order.status} />}
                />
                <DetailItem label="Order Date" value={formatDate(order.order_date)} />
                <DetailItem
                  label="Expected Delivery"
                  value={formatDate(order.expected_delivery_date)}
                />
                <DetailItem label="Created" value={formatDate(order.created_at)} />
                <DetailItem label="Created By" value={order.creator?.full_name ?? "-"} />
                <DetailItem label="Notes" value={order.notes ?? "-"} />
              </DetailSection>

              <DetailSection title="Supplier">
                <DetailItem
                  label="Supplier"
                  value={
                    order.vendor ? (
                      <Link
                        className="font-semibold text-[#06173f]"
                        to={`/vendors/${order.vendor_id}`}
                      >
                        {order.vendor.vendor_name}
                      </Link>
                    ) : (
                      "-"
                    )
                  }
                />
                <DetailItem
                  label="Supplier Code"
                  value={order.vendor?.vendor_code ?? "-"}
                />
                <DetailItem
                  label="Contact Person"
                  value={order.vendor?.contact_person ?? "-"}
                />
                <DetailItem label="Phone" value={order.vendor?.phone ?? "-"} />
              </DetailSection>

              <section
                className="scroll-mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
                id="purchase-order-items"
              >
                <h2 className="text-base font-semibold text-slate-950">Items</h2>
                <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200">
                  <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                    <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3">Quantity</th>
                        <th className="px-4 py-3">Received</th>
                        {canViewPricing ? (
                          <>
                            <th className="px-4 py-3">Unit Price</th>
                            <th className="px-4 py-3">GST</th>
                            <th className="px-4 py-3">Line Total</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {(order.items ?? []).map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-950">
                              {item.item?.item_name ?? "Inventory item"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {[item.item?.item_code, item.item?.brand, item.item?.model]
                                .filter(Boolean)
                                .join(" / ") || "-"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            {formatStock(item.quantity, item.item?.unit)}
                          </td>
                          <td className="px-4 py-3">
                            {formatStock(item.received_quantity ?? 0, item.item?.unit)}
                          </td>
                          {canViewPricing ? (
                            <>
                              <td className="px-4 py-3">
                                {formatCurrency(item.unit_price)}
                              </td>
                              <td className="px-4 py-3">{item.gst_percent ?? 0}%</td>
                              <td className="px-4 py-3 font-semibold text-slate-950">
                                {formatCurrency(item.line_total)}
                              </td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <aside id="purchase-order-actions" className="scroll-mt-6 space-y-6">
              <PurchaseNextStepSection
                canDownloadPdf={canGeneratePurchasePdf}
                canReceive={
                  canReceive && !order.archived_at &&
                  (order.status === "ordered" ||
                    order.status === "partially_received")
                }
                downloadUrl={pdfPreviewUrl}
                preparingPdf={preparingPdf}
                onDownload={() => void handleDownloadPdf()}
                onReceive={openReceiveForm}
              />

              {canViewPricing ? (
                <DetailSection title="Totals">
                  <DetailItem label="Subtotal" value={formatCurrency(order.subtotal)} />
                  <DetailItem
                    label="GST Amount"
                    value={formatCurrency(order.gst_amount)}
                  />
                  <DetailItem
                    label="Total Amount"
                    value={formatCurrency(order.total_amount)}
                  />
                </DetailSection>
              ) : null}
            </aside>
          </div>

          <RecordLifecyclePanel
            archiveReason={order.archive_reason}
            archivedAt={order.archived_at}
            canDelete={canDelete}
            canUpdate={canManageStatus}
            dependencyTargets={{
              documents: {
                actionLabel: "View PO actions",
                targetId: "purchase-order-actions",
              },
              purchase_order_items: {
                actionLabel: "View PO items",
                targetId: "purchase-order-items",
              },
              receiving_history: {
                actionLabel: "View received items",
                targetId: "purchase-order-items",
              },
            }}
            moduleKey="purchase_orders"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Purchase order permanently deleted.", "success");
                navigate("/purchases");
                return;
              }
              showToast(action === "archive" ? "Purchase order archived." : "Purchase order restored.", "success");
              await loadOrder();
            }}
            recordId={order.id}
            recordLabel={formatPurchaseCode(order.purchase_code)}
          />

          {receiveForm ? (
            <PurchaseReceiveFormModal
              order={order}
              values={receiveForm}
              setValues={setReceiveForm}
              errors={receiveFormErrors}
              showPricing={canViewPricing}
              onClose={() => {
                setReceiveForm(null);
                setReceiveFormErrors(null);
              }}
              onSubmit={handleReceiveSubmit}
              saving={updating}
            />
          ) : null}

          {editing ? (
            <PurchaseOrderFormModal
              title="Edit Purchase Order"
              submitLabel="Update Purchase Order"
              values={editing}
              setValues={setEditing}
              errors={formErrors}
              vendors={vendors}
              items={items}
              priceDefaults={priceDefaults}
              canAddItems={canCreateItems}
              canRemoveItems={canDelete}
              onClose={() => setEditing(null)}
              onSubmit={handleEditSubmit}
              saving={saving}
            />
          ) : null}

        </>
      ) : null}
    </div>
  );
}

function PurchaseNextStepSection({
  canDownloadPdf,
  canReceive,
  downloadUrl,
  preparingPdf,
  onDownload,
  onReceive,
}: {
  canDownloadPdf: boolean;
  canReceive: boolean;
  downloadUrl: string | null;
  preparingPdf: boolean;
  onDownload: () => void;
  onReceive: () => void;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Next Step</h2>
      <div className="mt-4 grid gap-2">
        <DownloadPurchaseOrderAction
          canDownload={canDownloadPdf}
          preparing={preparingPdf}
          url={downloadUrl}
          onDownload={onDownload}
        />
        {canReceive ? (
          <Button onClick={onReceive} variant="secondary">
            Material Received
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DownloadPurchaseOrderAction({
  canDownload,
  url,
  preparing,
  onDownload,
}: {
  canDownload: boolean;
  url: string | null;
  preparing: boolean;
  onDownload: () => void;
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

  if (!canDownload) {
    return (
      <PlaceholderAction>
        {preparing ? "Preparing PO" : "Download PO"}
      </PlaceholderAction>
    );
  }

  return (
    <Button disabled={preparing} onClick={onDownload}>
      {preparing ? "Preparing PO" : "Download PO"}
    </Button>
  );
}
