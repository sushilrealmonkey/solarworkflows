import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
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
import { PurchaseOrdersSection } from "../purchases/PurchasesPage";
import { fetchPurchaseOrders } from "../purchases/purchaseApi";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import { fetchSupplier, updateSupplier } from "./supplierApi";
import {
  formatSupplierAddress,
  supplierToForm,
  validateSupplierForm,
} from "./supplierUtils";
import { SupplierFormModal, SupplierStatusBadge } from "./SuppliersPage";
import type { Supplier, SupplierFormValues } from "./types";

export function SupplierDetailPage() {
  const { id } = useParams();
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orders, setOrders] = useState<PurchaseOrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SupplierFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");
  const canViewPurchases = hasPermission(profile, permissions, "inventory", "view");
  const canViewPricing = hasAdminPricingAccess(profile, permissions, roleNames, "view");

  async function loadSupplier() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextSupplier, nextOrders] = await Promise.all([
        fetchSupplier(profile, id),
        canViewPurchases
          ? fetchPurchaseOrders(profile, { vendorId: id }, { includePricing: canViewPricing })
          : Promise.resolve([]),
      ]);
      setSupplier(nextSupplier);
      setOrders(nextOrders);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load supplier.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSupplier();
    // loadSupplier closes over the current route and permission state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, canViewPurchases, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Supplier details are not available"
        description="Your role needs supplier directory access to open this record."
      />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplier || !editing) return;
    const nextErrors = validateSupplierForm(editing);
    setFormErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      setSaving(true);
      await updateSupplier(supplier.id, editing);
      setEditing(null);
      showToast("Supplier updated.", "success");
      await loadSupplier();
    } catch (value) {
      showToast(value instanceof Error ? value.message : "Supplier update failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/suppliers">Back to suppliers</Link>
      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load supplier" description={error} /> : null}
      {!loading && !error && !supplier ? (
        <EmptyState title="Supplier not found" description="This supplier may be unavailable or outside your company access." />
      ) : null}

      {supplier ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader title={supplier.supplier_name} description={supplier.supplier_code ?? "Supplier"} />
            {canUpdate ? (
              <Button
                onClick={() => {
                  setFormErrors({});
                  setEditing(supplierToForm(supplier));
                }}
                variant="secondary"
              >
                Edit Supplier
              </Button>
            ) : null}
          </div>

          <DetailSection title="Supplier Details">
            <DetailItem label="Supplier Code" value={supplier.supplier_code ?? "-"} />
            <DetailItem label="Status" value={<SupplierStatusBadge value={supplier.status} />} />
            <DetailItem label="Preferred Payment" value={labelize(supplier.preferred_payment_method)} />
            <DetailItem label="Payment Terms" value={supplier.payment_terms_days == null ? "-" : `${supplier.payment_terms_days} days`} />
            <DetailItem label="Created" value={formatDate(supplier.created_at)} />
            <DetailItem label="Notes" value={supplier.notes ?? "-"} />
          </DetailSection>

          <DetailSection title="Contact">
            <DetailItem label="Contact Person" value={supplier.contact_person ?? "-"} />
            <DetailItem label="Phone" value={supplier.phone ?? "-"} />
            <DetailItem label="Alternate Phone" value={supplier.alternate_phone ?? "-"} />
            <DetailItem label="Email" value={supplier.email ?? "-"} />
          </DetailSection>

          <DetailSection title="Tax And Address">
            <DetailItem label="GST Number" value={supplier.gst_number ?? "-"} />
            <DetailItem label="PAN Number" value={supplier.pan_number ?? "-"} />
            <DetailItem label="Address" value={formatSupplierAddress(supplier) || "-"} />
          </DetailSection>

          {canViewPurchases ? (
            <PurchaseOrdersSection
              orders={orders}
              canReceive={false}
              showPricing={canViewPricing}
              emptyTitle="No purchase orders for this supplier"
            />
          ) : null}
        </>
      ) : null}

      {editing ? (
        <SupplierFormModal
          title="Edit Supplier"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          onClose={() => setEditing(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}
    </div>
  );
}
