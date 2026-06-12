import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import {
  AccessDenied,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import { formatDate, hasPermission } from "../crm/crmUtils";
import { formatCurrency, formatStock } from "../inventory/inventoryUtils";
import { fetchPurchaseOrder, fetchPurchaseOrderSafe } from "./purchaseApi";
import { formatPurchaseCode } from "./purchaseUtils";
import { PurchaseStatusBadge } from "./PurchasesPage";
import type { PurchaseOrderWithRelations } from "./types";

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const [order, setOrder] = useState<PurchaseOrderWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canViewPricing = hasPermission(
    profile,
    permissions,
    "product_pricing",
    "view",
  );

  useEffect(() => {
    async function loadOrder() {
      if (!canView || !id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setOrder(
          canViewPricing
            ? await fetchPurchaseOrder(profile, id)
            : await fetchPurchaseOrderSafe(id),
        );
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

    void loadOrder();
  }, [canView, canViewPricing, id, profile]);

  if (!canView) {
    return (
      <AccessDenied
        title="Purchase details are not available"
        description="Your role needs inventory:view access to open purchase details."
      />
    );
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
          <PageHeader
            title={formatPurchaseCode(order.purchase_code)}
            description={`Purchase order for ${order.vendor?.vendor_name ?? "vendor"}.`}
          />

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
        </>
      ) : null}
    </div>
  );
}
