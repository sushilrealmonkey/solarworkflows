import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import {
  formatDate,
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import { formatCurrency, formatStock } from "../inventory/inventoryUtils";
import { buildPurchaseOrderPdf } from "../documents/businessPdf";
import {
  buildPurchaseOrderPdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import {
  fetchPurchaseOrder,
  fetchPurchaseOrderSafe,
  receivePurchaseOrderItems,
  updatePurchaseOrderStatus,
} from "./purchaseApi";
import {
  emptyPurchaseReceiveForm,
  formatPurchaseCode,
  hasPurchaseReceiveFormErrors,
  validatePurchaseReceiveForm,
} from "./purchaseUtils";
import {
  PurchaseReceiveFormModal,
  PurchaseStatusBadge,
} from "./PurchasesPage";
import type {
  PurchaseOrderWithRelations,
  PurchaseReceiveFormValues,
  PurchaseStatus,
} from "./types";

type PurchaseReceiveFormErrors = ReturnType<typeof validatePurchaseReceiveForm>;

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { profile, permissions, roleNames, organization } = useAuth();
  const { showToast } = useToast();
  const [order, setOrder] = useState<PurchaseOrderWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<PurchaseStatus | null>(null);
  const [receiveForm, setReceiveForm] = useState<PurchaseReceiveFormValues | null>(
    null,
  );
  const [receiveFormErrors, setReceiveFormErrors] =
    useState<PurchaseReceiveFormErrors | null>(null);
  const [updating, setUpdating] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [confirmingRegeneratePdf, setConfirmingRegeneratePdf] = useState(false);

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

  async function loadOrder() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const nextOrder = canViewPricing
        ? await fetchPurchaseOrder(profile, id)
        : await fetchPurchaseOrderSafe(id);
      setOrder(nextOrder);
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

  async function confirmStatusUpdate() {
    if (!order || !statusTarget) {
      return;
    }

    try {
      setUpdating(true);
      const nextOrder = await updatePurchaseOrderStatus(order.id, statusTarget);
      setOrder((current) => (current ? { ...current, ...nextOrder } : nextOrder));
      setStatusTarget(null);
      showToast("Purchase status updated.", "success");
      await loadOrder();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase status update failed.",
        "error",
      );
    } finally {
      setUpdating(false);
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
      const path = buildPurchaseOrderPdfPath(
        targetOrder.organization_id,
        targetOrder.purchase_code,
        "PO",
        targetOrder.id,
      );
      const document = await fetchGeneratedDocument(path);

      if (document) {
        setPdfPreviewUrl(await createGeneratedPdfPreviewUrl(document.file_path));
      } else {
        setPdfPreviewUrl(null);
      }
    } catch {
      setPdfPreviewUrl(null);
    }
  }

  async function handleGeneratePdf(confirmedRegenerate = false) {
    if (!order) {
      return;
    }

    if (!canCreateDocuments) {
      showToast("Your role needs documents:create access to store generated PDFs.", "error");
      return;
    }

    if (!canViewPricing) {
      showToast("Your role needs purchase pricing access to generate PO PDFs.", "error");
      return;
    }

    try {
      setGeneratingPdf(true);
      const settings = await fetchBusinessDocumentSettings();
      const filePath = buildPurchaseOrderPdfPath(
        order.organization_id,
        order.purchase_code,
        "PO",
        order.id,
      );
      const existingDocument = await fetchGeneratedDocument(filePath);

      if (existingDocument && !confirmedRegenerate) {
        setConfirmingRegeneratePdf(true);
        return;
      }

      const pdfBlob = await buildPurchaseOrderPdf(order, organization, settings);
      const result = await uploadGeneratedPdf(
        profile,
        {
          document_type: "purchase_order_pdf",
          document_name: `${order.purchase_code ?? "Purchase Order"} PDF`,
          file_path: filePath,
          customer_id: null,
          purchase_order_id: order.id,
          notes: "Generated purchase order PDF",
        },
        pdfBlob,
      );

      setPdfPreviewUrl(result.previewUrl);
      setConfirmingRegeneratePdf(false);
      showToast("Purchase order PDF generated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Purchase order PDF generation failed.",
        "error",
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-brand-700" to="/purchases">
        Back to purchases
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={formatPurchaseCode(order.purchase_code)}
              description={`Purchase order for ${order.vendor?.vendor_name ?? "vendor"}.`}
            />
            <PurchaseDetailActions
              canManageStatus={canManageStatus}
              canReceive={canReceive}
              canGeneratePdf={canGeneratePurchasePdf}
              generatingPdf={generatingPdf}
              order={order}
              pdfPreviewUrl={pdfPreviewUrl}
              onGeneratePdf={() => void handleGeneratePdf(false)}
              onReceive={openReceiveForm}
              onStatusChange={setStatusTarget}
            />
          </div>

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

          <DetailSection title="Vendor">
            <DetailItem
              label="Vendor"
              value={
                order.vendor ? (
                  <Link
                    className="font-semibold text-brand-700"
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
              label="Vendor Code"
              value={order.vendor?.vendor_code ?? "-"}
            />
            <DetailItem
              label="Contact Person"
              value={order.vendor?.contact_person ?? "-"}
            />
            <DetailItem label="Phone" value={order.vendor?.phone ?? "-"} />
          </DetailSection>

          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Items</h2>
            <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
              <table className="w-full border-collapse text-left text-sm">
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

          {canViewPricing ? (
            <DetailSection title="Totals">
              <DetailItem label="Subtotal" value={formatCurrency(order.subtotal)} />
              <DetailItem label="GST Amount" value={formatCurrency(order.gst_amount)} />
              <DetailItem
                label="Total Amount"
                value={formatCurrency(order.total_amount)}
              />
            </DetailSection>
          ) : null}

          {statusTarget ? (
            <ConfirmDialog
              title="Update purchase status?"
              description={`Set ${formatPurchaseCode(order.purchase_code)} to ${labelize(statusTarget)}.`}
              confirming={updating}
              confirmLabel="Update Status"
              confirmingLabel="Updating..."
              confirmVariant={statusTarget === "cancelled" ? "danger" : "primary"}
              onCancel={() => setStatusTarget(null)}
              onConfirm={confirmStatusUpdate}
            />
          ) : null}

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

          {confirmingRegeneratePdf ? (
            <ConfirmDialog
              title="Regenerate purchase order PDF?"
              description="A purchase order PDF already exists for this purchase code. Regenerating will replace the stored PDF file and refresh the document record."
              confirmLabel="Regenerate"
              confirmingLabel="Regenerating..."
              confirmVariant="primary"
              confirming={generatingPdf}
              onCancel={() => setConfirmingRegeneratePdf(false)}
              onConfirm={() => void handleGeneratePdf(true)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PurchaseDetailActions({
  order,
  canManageStatus,
  canReceive,
  canGeneratePdf,
  generatingPdf,
  pdfPreviewUrl,
  onGeneratePdf,
  onStatusChange,
  onReceive,
}: {
  order: PurchaseOrderWithRelations;
  canManageStatus: boolean;
  canReceive: boolean;
  canGeneratePdf: boolean;
  generatingPdf: boolean;
  pdfPreviewUrl: string | null;
  onGeneratePdf: () => void;
  onStatusChange: (status: PurchaseStatus) => void;
  onReceive: () => void;
}) {
  const canShowStatusActions =
    canManageStatus && order.status !== "received";
  const canShowReceiveAction =
    canReceive &&
    order.status !== "received" &&
    order.status !== "cancelled";

  if (!canShowStatusActions && !canShowReceiveAction && !canGeneratePdf && !pdfPreviewUrl) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canGeneratePdf ? (
        <Button
          onClick={onGeneratePdf}
          disabled={generatingPdf}
          variant="secondary"
        >
          {generatingPdf ? "Generating..." : "Generate PDF"}
        </Button>
      ) : null}
      {pdfPreviewUrl ? (
        <a
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
          href={pdfPreviewUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open PDF
        </a>
      ) : null}
      {canShowStatusActions && order.status === "draft" ? (
        <Button onClick={() => onStatusChange("ordered")} variant="secondary">
          Mark Ordered
        </Button>
      ) : null}
      {canShowReceiveAction ? (
        <Button onClick={onReceive}>Receive Stock</Button>
      ) : null}
      {canShowStatusActions && order.status !== "cancelled" ? (
        <Button onClick={() => onStatusChange("cancelled")} variant="danger">
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
