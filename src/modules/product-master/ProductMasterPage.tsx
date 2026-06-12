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
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
} from "../crm/CrmComponents";
import { hasPermission, labelize } from "../crm/crmUtils";
import {
  createProduct,
  fetchProductBrandSuggestions,
  fetchProductCategories,
  fetchProductTypes,
  fetchProducts,
  updateProduct,
  updateProductStatus,
} from "./productMasterApi";
import {
  buildGeneratedProductName,
  emptyProductForm,
  productCategoryName,
  productTypeName,
  productStatusOptions,
  productToForm,
  productValidationSummary,
  validateProductForm,
} from "./productMasterUtils";
import {
  ProductFormModal,
  ProductStatusBadge,
} from "./ProductMasterComponents";
import type {
  Product,
  ProductCategory,
  ProductFormValues,
  ProductStatus,
  ProductType,
} from "./types";

type ProductFilters = {
  search: string;
  categoryId: string;
  status: string;
};

type ProductFormState = {
  mode: "create" | "edit";
  product: Product | null;
  values: ProductFormValues;
};

type ProductStatusAction = {
  product: Product;
  status: Exclude<ProductStatus, "active">;
};

export function ProductMasterPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    categoryId: "",
    status: "",
  });
  const [productForm, setProductForm] = useState<ProductFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveAlert, setSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [statusAction, setStatusAction] = useState<ProductStatusAction | null>(
    null,
  );
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [openActionProductId, setOpenActionProductId] = useState<string | null>(
    null,
  );

  const canView = hasPermission(profile, permissions, "product_master", "view");
  const canCreate = hasPermission(
    profile,
    permissions,
    "product_master",
    "create",
  );
  const canUpdate = hasPermission(
    profile,
    permissions,
    "product_master",
    "update",
  );

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [
        nextProducts,
        nextCategories,
        nextProductTypes,
        nextBrandOptions,
      ] = await Promise.all([
        fetchProducts(profile),
        fetchProductCategories(profile),
        fetchProductTypes(profile),
        fetchProductBrandSuggestions(profile),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setProductTypes(nextProductTypes);
      setBrandOptions(nextBrandOptions);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load products and materials.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  const filteredProducts = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !search ||
        [
          product.product_code,
          product.product_name,
          productCategoryName(product),
          product.hsn_code,
          productTypeName(product),
          product.brand,
          product.model_number,
          product.specifications,
          product.unit,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesCategory =
        !filters.categoryId || product.category_id === filters.categoryId;
      const matchesStatus = !filters.status || product.status === filters.status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [filters, products]);

  if (!canView) {
    return (
      <AccessDenied
        title="Products are not available"
        description="Your role needs product_master:view access to open Products."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setProductForm({
      mode: "create",
      product: null,
      values: emptyProductForm(),
    });
  }

  function openEditForm(product: Product) {
    setFormErrors({});
    setProductForm({
      mode: "edit",
      product,
      values: productToForm(product),
    });
  }

  function openProductDetail(productId: string) {
    navigate(`/products-materials/products/${productId}`);
  }

  function handleProductRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    productId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProductDetail(productId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!productForm) {
      return;
    }

    const submitValues = {
      ...productForm.values,
      product_name: buildGeneratedProductName(productForm.values, categories),
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
      if (productForm.mode === "create") {
        await createProduct(profile, submitValues);
        showToast("Product or material added.", "success");
      } else if (productForm.product) {
        await updateProduct(productForm.product.id, submitValues);
        showToast("Product or material updated.", "success");
      }

      setProductForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "Product or material save failed.";
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
    if (!statusAction) {
      return;
    }

    try {
      setUpdatingStatus(true);
      const updatedProduct = await updateProductStatus(
        statusAction.product.id,
        statusAction.status,
      );
      setProducts((current) =>
        current.map((product) =>
          product.id === updatedProduct.id ? updatedProduct : product,
        ),
      );
      showToast(
        `Product or material marked ${labelize(statusAction.status).toLowerCase()}.`,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Products"
          description="Manage the central catalog used across inventory, purchases, quotations, projects, and reports."
        />
        {canCreate ? (
          <Button onClick={openCreateForm}>Add Product or Material</Button>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <ProductMetricCard label="Total Items" value={products.length} />
        <ProductMetricCard
          label="Active Items"
          value={products.filter((product) => product.status === "active").length}
        />
        <ProductMetricCard
          label="Discontinued Items"
          value={
            products.filter((product) => product.status === "discontinued")
              .length
          }
        />
      </section>

      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(220px,1.4fr)_minmax(170px,0.8fr)_minmax(150px,0.8fr)]">
        <SearchInput
          className="block"
          placeholder="Search code, display name, category, HSN, product type, brand, model, specifications, or unit"
          value={filters.search}
          onChange={(search) =>
            setFilters((current) => ({ ...current, search }))
          }
        />
        <SelectInput
          label="Category"
          value={filters.categoryId}
          onChange={(categoryId) =>
            setFilters((current) => ({ ...current, categoryId }))
          }
          options={[
            { value: "", label: "All categories" },
            ...categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) =>
            setFilters((current) => ({ ...current, status }))
          }
          options={[
            { value: "", label: "All statuses" },
            ...productStatusOptions.map((status) => ({
              value: status,
              label: labelize(status),
            })),
          ]}
        />
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load products" description={error} />
      ) : null}
      {!loading && !error && filteredProducts.length === 0 ? (
        <EmptyState
          title="No products or materials found"
          description="Add items to build the shared catalog, or adjust the filters to see existing records."
          action={
            canCreate ? (
              <Button onClick={openCreateForm}>Add Product or Material</Button>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredProducts.length > 0 ? (
        <>
          <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product Code</th>
                  <th className="px-4 py-3">Display Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">HSN Code</th>
                  <th className="px-4 py-3">Product Type</th>
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Model Number</th>
                  <th className="px-4 py-3">Specifications</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-12 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                    onClick={() => openProductDetail(product.id)}
                    onKeyDown={(event) =>
                      handleProductRowKeyDown(event, product.id)
                    }
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {product.product_code}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-brand-700">
                        {product.product_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">{productCategoryName(product)}</td>
                    <td className="px-4 py-3">{product.hsn_code ?? "-"}</td>
                    <td className="px-4 py-3">{productTypeName(product)}</td>
                    <td className="px-4 py-3">{product.brand ?? "-"}</td>
                    <td className="px-4 py-3">{product.model_number ?? "-"}</td>
                    <td className="px-4 py-3">
                      {product.specifications ?? "-"}
                    </td>
                    <td className="px-4 py-3">{product.unit}</td>
                    <td className="px-4 py-3">
                      <ProductStatusBadge value={product.status} />
                    </td>
                    <td
                      className="relative px-4 py-3 text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <ProductActions
                        product={product}
                        canUpdate={canUpdate}
                        open={openActionProductId === product.id}
                        onToggle={() =>
                          setOpenActionProductId((current) =>
                            current === product.id ? null : product.id,
                          )
                        }
                        onView={() => openProductDetail(product.id)}
                        onEdit={() => openEditForm(product)}
                        onStatus={(status) => setStatusAction({ product, status })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {filteredProducts.map((product) => (
              <article
                key={product.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {product.product_code}
                    </p>
                    <Link
                      className="mt-1 block text-base font-semibold text-brand-700"
                      to={`/products-materials/products/${product.id}`}
                    >
                      {product.product_name}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      {[
                        productCategoryName(product),
                        product.hsn_code,
                        productTypeName(product),
                        product.brand,
                        product.model_number,
                        product.specifications,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <ProductStatusBadge value={product.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Unit</dt>
                    <dd className="font-medium text-slate-900">
                      {product.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">HSN Code</dt>
                    <dd className="font-medium text-slate-900">
                      {product.hsn_code ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Product Type</dt>
                    <dd className="font-medium text-slate-900">
                      {productTypeName(product)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Model Number</dt>
                    <dd className="font-medium text-slate-900">
                      {product.model_number ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Specifications</dt>
                    <dd className="font-medium text-slate-900">
                      {product.specifications ?? "-"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => openProductDetail(product.id)} variant="secondary">
                    View
                  </Button>
                  {canUpdate ? (
                    <>
                      <Button onClick={() => openEditForm(product)} variant="secondary">
                        Edit
                      </Button>
                      {product.status !== "inactive" ? (
                        <Button
                          onClick={() =>
                            setStatusAction({ product, status: "inactive" })
                          }
                          variant="ghost"
                        >
                          Mark Inactive
                        </Button>
                      ) : null}
                      {product.status !== "discontinued" ? (
                        <Button
                          onClick={() =>
                            setStatusAction({
                              product,
                              status: "discontinued",
                            })
                          }
                          variant="danger"
                        >
                          Mark Discontinued
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {productForm ? (
        <ProductFormModal
          title={
            productForm.mode === "create"
              ? "Add Product or Material"
              : "Edit Product or Material"
          }
          values={productForm.values}
          setValues={(values) => setProductForm({ ...productForm, values })}
          categories={categories}
          productTypes={productTypes}
          brandOptions={brandOptions}
          errors={formErrors}
          onClose={() => setProductForm(null)}
          onSubmit={handleSubmit}
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

      {statusAction ? (
        <ConfirmDialog
          title={`Mark product ${labelize(statusAction.status).toLowerCase()}?`}
          description={`This keeps ${statusAction.product.product_name} in Products & Materials for reporting and future references.`}
          confirming={updatingStatus}
          confirmLabel={`Mark ${labelize(statusAction.status)}`}
          confirmingLabel="Updating..."
          confirmVariant={statusAction.status === "discontinued" ? "danger" : "primary"}
          onCancel={() => setStatusAction(null)}
          onConfirm={confirmStatusAction}
        />
      ) : null}
    </div>
  );
}

function ProductMetricCard({
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

function ProductActions({
  product,
  canUpdate,
  open,
  onToggle,
  onView,
  onEdit,
  onStatus,
}: {
  product: Product;
  canUpdate: boolean;
  open: boolean;
  onToggle: () => void;
  onView: () => void;
  onEdit: () => void;
  onStatus: (status: Exclude<ProductStatus, "active">) => void;
}) {
  return (
    <>
      <button
        aria-label={`Actions for ${product.product_name}`}
        className="inline-flex min-h-8 items-center justify-center rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:bg-stone-50"
        onClick={onToggle}
        type="button"
      >
        More
      </button>
      {open ? (
        <div className="absolute right-4 z-30 mt-2 w-44 rounded-lg border border-stone-200 bg-white p-1 text-left shadow-lg">
          <button
            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
            onClick={onView}
            type="button"
          >
            View
          </button>
          {canUpdate ? (
            <>
              <button
                className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                onClick={onEdit}
                type="button"
              >
                Edit
              </button>
              {product.status !== "inactive" ? (
                <button
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-amber-800 hover:bg-amber-50"
                  onClick={() => onStatus("inactive")}
                  type="button"
                >
                  Mark Inactive
                </button>
              ) : null}
              {product.status !== "discontinued" ? (
                <button
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-rose-800 hover:bg-rose-50"
                  onClick={() => onStatus("discontinued")}
                  type="button"
                >
                  Mark Discontinued
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
