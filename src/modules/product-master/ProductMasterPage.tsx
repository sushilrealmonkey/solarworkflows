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
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  AccessDenied,
  AlertDialog,
  Button,
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
  fetchProducts,
  updateProduct,
} from "./productMasterApi";
import {
  buildGeneratedProductName,
  emptyProductForm,
  productCategoryName,
  productStatusOptions,
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

export function ProductMasterPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
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

  const canView = hasPermission(profile, permissions, "product_master", "view");
  const canCreate = hasPermission(
    profile,
    permissions,
    "product_master",
    "create",
  );

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextProducts, nextCategories, nextBrandOptions] =
        await Promise.all([
        fetchProducts(profile, archiveScope),
        fetchProductCategories(profile),
        fetchProductBrandSuggestions(profile),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
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
  }, [archiveScope, canView, profile?.id]);

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

  const productPagination = useTablePagination(filteredProducts);
  const paginatedProducts = productPagination.pageItems;

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

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

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
          placeholder="Search code, display name, category, brand, model, or specifications"
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
                  <th className="px-4 py-3">Brand</th>
                  <th className="px-4 py-3">Model Number</th>
                  <th className="px-4 py-3">Specifications</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedProducts.map((product) => (
                    <tr
                      key={product.id}
                      className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
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
                        <span className="font-semibold text-[#06173f]">
                          {product.product_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">{productCategoryName(product)}</td>
                      <td className="px-4 py-3">{product.brand ?? "-"}</td>
                      <td className="px-4 py-3">{product.model_number ?? "-"}</td>
                      <td className="px-4 py-3">
                        {product.specifications ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <ProductStatusBadge value={product.status} />
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedProducts.map((product) => (
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
                      className="mt-1 block text-base font-semibold text-[#06173f]"
                      to={`/products-materials/products/${product.id}`}
                    >
                      {product.product_name}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      {[
                        productCategoryName(product),
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
              </article>
            ))}
          </div>
          <TablePagination label="products" pagination={productPagination} />
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
