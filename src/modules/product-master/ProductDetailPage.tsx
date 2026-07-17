import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  hasAdminPricingAccess,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import {
  fetchProduct,
  fetchProductBrandSuggestions,
  fetchProductCategories,
  fetchProductPrice,
  fetchProductPriceHistory,
  fetchProductUsageSummary,
  saveProductPrice,
  updateProduct,
  updateProductStatus,
} from "./productMasterApi";
import {
  buildGeneratedProductName,
  emptyUsageSummary,
  productPriceToForm,
  productToForm,
  validateProductPriceForm,
  productValidationSummary,
  validateProductForm,
} from "./productMasterUtils";
import {
  ProductDetailGrid,
  ProductFormModal,
  ProductPriceFormModal,
  ProductPriceHistoryList,
  ProductPricingGrid,
} from "./ProductMasterComponents";
import type {
  Product,
  ProductCategory,
  ProductFormValues,
  ProductPrice,
  ProductPriceFormValues,
  ProductPriceHistory,
  ProductStatus,
  ProductUsageSummary,
} from "./types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, permissions, roleNames } = useAuth();
  const { showToast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [usageSummary, setUsageSummary] =
    useState<ProductUsageSummary>(emptyUsageSummary);
  const [productPrice, setProductPrice] = useState<ProductPrice | null>(null);
  const [priceHistory, setPriceHistory] = useState<ProductPriceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveAlert, setSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [statusAction, setStatusAction] = useState<ProductStatus | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [pricingForm, setPricingForm] = useState<ProductPriceFormValues | null>(
    null,
  );
  const [pricingFormErrors, setPricingFormErrors] = useState<
    Record<string, string>
  >({});
  const [savingPricing, setSavingPricing] = useState(false);

  const canView = hasPermission(profile, permissions, "product_master", "view");
  const canUpdate = hasPermission(
    profile,
    permissions,
    "product_master",
    "update",
  );
  const canDelete = hasPermission(profile, permissions, "product_master", "delete");
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

  async function loadProduct() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [
        nextProduct,
        nextCategories,
        nextBrandOptions,
        nextUsageSummary,
        nextProductPrice,
        nextPriceHistory,
      ] = await Promise.all([
        fetchProduct(profile, id),
        fetchProductCategories(profile),
        fetchProductBrandSuggestions(profile),
        fetchProductUsageSummary(profile, id),
        canViewPricing ? fetchProductPrice(id) : Promise.resolve(null),
        canViewPricing ? fetchProductPriceHistory(id) : Promise.resolve([]),
      ]);
      setProduct(nextProduct);
      setCategories(nextCategories);
      setBrandOptions(nextBrandOptions);
      setUsageSummary(nextUsageSummary);
      setProductPrice(nextProductPrice);
      setPriceHistory(nextPriceHistory);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load product or material.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProduct();
    // loadProduct closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPricing, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Product or material details are not available"
        description="Your role needs product_master:view access to open product details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!product || !editing) {
      return;
    }

    const submitValues = {
      ...editing,
      product_name: buildGeneratedProductName(editing, categories),
    };
    const nextErrors = validateProductForm(submitValues);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSaveAlert({
        title: "Product or material details missing",
        description:
          productValidationSummary(nextErrors) ||
          "Please complete the required product or material details before saving.",
      });
      return;
    }

    try {
      setSaving(true);
      const updatedProduct = await updateProduct(product.id, submitValues);
      setProduct(updatedProduct);
      setEditing(null);
      showToast("Product or material updated.", "success");
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "Product or material update failed.";
      setSaveAlert({
        title: "Product or material could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusAction() {
    if (!product || !statusAction) {
      return;
    }

    try {
      setUpdatingStatus(true);
      const updatedProduct = await updateProductStatus(product.id, statusAction);
      setProduct(updatedProduct);
      showToast(
        `Product or material marked ${labelize(statusAction).toLowerCase()}.`,
        "success",
      );
      setStatusAction(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Product or material status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handlePricingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!product || !pricingForm) {
      return;
    }

    const nextErrors = validateProductPriceForm(pricingForm);
    setPricingFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPricing(true);
      const nextPrice = await saveProductPrice(product.id, pricingForm);
      setProductPrice(nextPrice);
      setPriceHistory(await fetchProductPriceHistory(product.id));
      setPricingForm(null);
      showToast("Product pricing updated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Product pricing update failed.",
        "error",
      );
    } finally {
      setSavingPricing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        className="text-sm font-semibold text-[#06173f]"
        to="/products-materials/products"
      >
        Back to Products
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load product or material" description={error} />
      ) : null}
      {!loading && !error && !product ? (
        <EmptyState
          title="Product or material not found"
          description="This product or material may have been removed or is outside your tenant access."
        />
      ) : null}

      {product ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={product.product_name}
              description={[
                product.product_code,
                product.category?.name,
                product.brand,
                product.model_number,
                product.specifications,
              ]
                .filter(Boolean)
                .join(" / ")}
            />
            {canUpdate && !product.archived_at ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(productToForm(product));
                  }}
                  variant="secondary"
                >
                  Edit Product or Material
                </Button>
                {product.status !== "inactive" ? (
                  <Button
                    onClick={() => setStatusAction("inactive")}
                    variant="ghost"
                  >
                    Mark Inactive
                  </Button>
                ) : null}
                {product.status !== "discontinued" ? (
                  <Button
                    onClick={() => setStatusAction("discontinued")}
                    variant="danger"
                  >
                    Mark Discontinued
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <DetailSection title="Basic Information">
            <ProductDetailGrid product={product} />
          </DetailSection>

          {canViewPricing ? (
            <DetailSection title="Admin Pricing">
              <ProductPricingGrid price={productPrice} />
              {canUpdatePricing && !product.archived_at ? (
                <div className="sm:col-span-2">
                  <Button
                    onClick={() => {
                      setPricingFormErrors({});
                      setPricingForm(productPriceToForm(productPrice));
                    }}
                    variant="secondary"
                  >
                    Update Pricing
                  </Button>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <ProductPriceHistoryList history={priceHistory} />
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="Tax">
            <DetailItem label="GST %" value={`${Number(product.gst_percent ?? 0)}%`} />
          </DetailSection>

          <DetailSection title="Warranty">
            <DetailItem
              label="Warranty Description"
              value={product.warranty_description ?? "-"}
            />
          </DetailSection>

          <DetailSection title="Usage Summary">
            <UsageSummaryItem
              label="Used In Inventory"
              value={usageSummary.inventory}
            />
            <UsageSummaryItem
              label="Used In Quotations"
              value={usageSummary.quotations}
            />
            <UsageSummaryItem
              label="Used In Purchase Orders"
              value={usageSummary.purchaseOrders}
            />
            <UsageSummaryItem
              label="Used In Projects"
              value={usageSummary.projects}
            />
          </DetailSection>

          <DetailSection title="Audit">
            <DetailItem label="Created" value={formatDate(product.created_at)} />
            <DetailItem label="Updated" value={formatDate(product.updated_at)} />
            <DetailItem label="Notes" value={product.notes ?? "-"} />
          </DetailSection>

          <RecordLifecyclePanel
            archiveReason={product.archive_reason}
            archivedAt={product.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="products"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Product permanently deleted.", "success");
                navigate("/products-materials/products");
                return;
              }
              showToast(action === "archive" ? "Product archived." : "Product restored.", "success");
              await loadProduct();
            }}
            recordId={product.id}
            recordLabel={product.product_code || product.product_name}
          />
        </>
      ) : null}

      {editing ? (
        <ProductFormModal
          title="Edit Product or Material"
          values={editing}
          setValues={setEditing}
          categories={categories}
          brandOptions={brandOptions}
          errors={formErrors}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {saveAlert ? (
        <AlertDialog
          title={saveAlert.title}
          description={saveAlert.description}
          onClose={() => setSaveAlert(null)}
        />
      ) : null}

      {pricingForm ? (
        <ProductPriceFormModal
          values={pricingForm}
          setValues={setPricingForm}
          errors={pricingFormErrors}
          onClose={() => setPricingForm(null)}
          onSubmit={handlePricingSubmit}
          saving={savingPricing}
        />
      ) : null}

      {statusAction && product ? (
        <ConfirmDialog
          title={`Mark product ${labelize(statusAction).toLowerCase()}?`}
          description={`This keeps ${product.product_name} in Products & Materials for reporting and future references.`}
          confirming={updatingStatus}
          confirmLabel={`Mark ${labelize(statusAction)}`}
          confirmingLabel="Updating..."
          confirmVariant={statusAction === "discontinued" ? "danger" : "primary"}
          onCancel={() => setStatusAction(null)}
          onConfirm={confirmStatusAction}
        />
      ) : null}
    </div>
  );
}

function UsageSummaryItem({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}
