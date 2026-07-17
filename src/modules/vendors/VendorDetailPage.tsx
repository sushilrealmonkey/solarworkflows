import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import {
  PurchaseOrdersSection,
} from "../purchases/PurchasesPage";
import { fetchPurchaseOrders } from "../purchases/purchaseApi";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import {
  fetchVendor,
  updateVendor,
} from "./vendorApi";
import {
  formatVendorAddress,
  validateVendorForm,
  vendorToForm,
} from "./vendorUtils";
import { VendorFormModal, VendorStatusBadge } from "./VendorsPage";
import type { Vendor, VendorFormValues } from "./types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";

export function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<
    PurchaseOrderWithRelations[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VendorFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");
  const canDelete = hasPermission(profile, permissions, "vendors", "delete");
  const canViewPurchases = hasPermission(profile, permissions, "inventory", "view");
  const canViewPricing = hasAdminPricingAccess(
    profile,
    permissions,
    roleNames,
    "view",
  );

  async function loadVendor() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextVendor, nextPurchaseOrders] = await Promise.all([
        fetchVendor(profile, id),
        canViewPurchases
          ? fetchPurchaseOrders(profile, { vendorId: id }, {
              includePricing: canViewPricing,
            })
          : Promise.resolve([]),
      ]);
      setVendor(nextVendor);
      setPurchaseOrders(nextPurchaseOrders);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load supplier.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVendor();
    // loadVendor closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPurchases, canViewPricing, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Supplier details are not available"
        description="Your role needs vendors:view access to open supplier details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!vendor || !editing) {
      return;
    }

    const nextErrors = validateVendorForm(editing);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateVendor(vendor.id, editing);
      setEditing(null);
      showToast("Supplier updated.", "success");
      await loadVendor();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Supplier update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/vendors">
        Back to suppliers
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load supplier" description={error} /> : null}
      {!loading && !error && !vendor ? (
        <EmptyState
          title="Supplier not found"
          description="This supplier may have been deleted or is outside your organization access."
        />
      ) : null}

      {vendor ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={vendor.vendor_name}
              description={`${vendor.vendor_code ?? "Supplier"} / ${labelize(
                vendor.vendor_type,
              )}`}
            />
            <div className="flex flex-wrap gap-2">
              {canUpdate && !vendor.archived_at ? (
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(vendorToForm(vendor));
                  }}
                  variant="secondary"
                >
                  Edit Supplier
                </Button>
              ) : null}
            </div>
          </div>

          <DetailSection title="Supplier Details">
            <DetailItem label="Supplier Code" value={vendor.vendor_code ?? "-"} />
            <DetailItem label="Status" value={<VendorStatusBadge value={vendor.status} />} />
            <DetailItem label="Supplier Type" value={labelize(vendor.vendor_type)} />
            <DetailItem label="Created" value={formatDate(vendor.created_at)} />
            <DetailItem label="Notes" value={vendor.notes ?? "-"} />
          </DetailSection>

          <DetailSection title="Contact">
            <DetailItem label="Contact Person" value={vendor.contact_person ?? "-"} />
            <DetailItem label="Phone" value={vendor.phone ?? "-"} />
            <DetailItem label="Alternate Phone" value={vendor.alternate_phone ?? "-"} />
            <DetailItem label="Email" value={vendor.email ?? "-"} />
          </DetailSection>

          <DetailSection title="Tax And Address">
            <DetailItem label="GST Number" value={vendor.gst_number ?? "-"} />
            <DetailItem label="PAN Number" value={vendor.pan_number ?? "-"} />
            <DetailItem
              label="Address"
              value={formatVendorAddress(vendor) || "-"}
            />
          </DetailSection>

          {canViewPurchases ? (
            <PurchaseOrdersSection
              orders={purchaseOrders}
              canReceive={false}
              showPricing={canViewPricing}
              emptyTitle="No purchase orders for this supplier"
            />
          ) : null}

          <RecordLifecyclePanel
            archiveReason={vendor.archive_reason}
            archivedAt={vendor.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="vendors"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Supplier permanently deleted.", "success");
                navigate("/vendors");
                return;
              }
              showToast(action === "archive" ? "Supplier archived." : "Supplier restored.", "success");
              await loadVendor();
            }}
            recordId={vendor.id}
            recordLabel={vendor.vendor_code || vendor.vendor_name}
          />
        </>
      ) : null}

      {editing ? (
        <VendorFormModal
          title="Edit Supplier"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

    </div>
  );
}
