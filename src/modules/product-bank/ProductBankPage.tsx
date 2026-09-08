import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SearchInput,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { hasPermission, labelize } from "../crm/crmUtils";
import {
  fetchCatalogLibraryCategories,
} from "../catalog-library/catalogLibraryApi";
import type { CatalogLibraryCategory } from "../catalog-library/types";
import {
  createProductBankProduct,
  fetchProductBankPage,
  fetchProductBankProducts,
  importProductBankProducts,
  updateProductBankProduct,
} from "./productBankApi";
import {
  emptyProductBankForm,
  productBankPublicationOptions,
  productBankToForm,
  productUnitOptions,
  validateProductBankForm,
} from "./productBankUtils";
import type {
  ProductBankProduct,
  ProductBankProductFormValues,
} from "./types";

type ProductBankFilters = {
  search: string;
  categoryId: string;
  brand: string;
};

type ProductBankFormState = {
  mode: "create" | "edit";
  product: ProductBankProduct | null;
  values: ProductBankProductFormValues;
};

export function ProductBankPage() {
  const { profile, permissions } = useAuth();
  const canView = hasPermission(profile, permissions, "product_master", "view");

  if (!canView) {
    return (
      <AccessDenied
        title="Product Bank is not available"
        description="Your role needs product_master:view access to browse shared products."
      />
    );
  }

  return profile?.is_super_admin ? <ProductBankAdminPage /> : <TenantProductBankPage />;
}

function TenantProductBankPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const canCreate = hasPermission(profile, permissions, "product_master", "create");
  const [products, setProducts] = useState<ProductBankProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<ProductBankFilters>({
    search: "",
    categoryId: "",
    brand: "",
  });

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchProductBankPage(filters, page, 50);
      setProducts(result.products);
      setTotalProducts(result.total);
    } catch (nextError) {
      setError(messageOf(nextError, "Product Bank could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, [filters.brand, filters.categoryId, filters.search, page]);

  const categories = useMemo(
    () => uniqueOptions(products.map((product) => ({
      value: product.category_id,
      label: product.category.name,
    }))),
    [products],
  );
  const brands = useMemo(
    () => uniqueOptions(products
      .filter((product) => !filters.categoryId || product.category_id === filters.categoryId)
      .filter((product) => Boolean(product.brand))
      .map((product) => ({ value: product.brand ?? "", label: product.brand ?? "" }))),
    [filters.categoryId, products],
  );

  useEffect(() => {
    if (filters.brand && !brands.some((brand) => brand.value === filters.brand)) {
      setFilters((current) => ({ ...current, brand: "" }));
    }
  }, [brands, filters.brand]);

  const productPagination = useMemo(() => {
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(totalProducts / pageSize));
    const safePage = Math.min(page, totalPages);

    return {
      page: safePage,
      pageItems: products,
      pageSize,
      totalItems: totalProducts,
      totalPages,
      startItem: totalProducts === 0 ? 0 : (safePage - 1) * pageSize + 1,
      endItem: Math.min(totalProducts, safePage * pageSize),
      setPage,
      setPageSize: () => undefined,
    };
  }, [page, products, totalProducts]);
  const displayedProducts = products;

  function toggleSelected(product: ProductBankProduct) {
    if (product.workspace_product && !product.workspace_product.archived_at) return;

    setSelectedIds((current) => current.includes(product.id)
      ? current.filter((id) => id !== product.id)
      : [...current, product.id]);
  }

  async function addSelectedProducts() {
    if (!canCreate || selectedIds.length === 0 || importing) return;

    try {
      setImporting(true);
      const results = await importProductBankProducts(selectedIds);
      const added = results.filter((item) => item.import_action === "added").length;
      const restored = results.filter((item) => item.import_action === "restored").length;
      const alreadyAdded = results.filter((item) => item.import_action === "already_added").length;
      const messages = [
        added ? `${added} added` : "",
        restored ? `${restored} restored` : "",
        alreadyAdded ? `${alreadyAdded} already in your workspace` : "",
      ].filter(Boolean);
      showToast(messages.join(" · ") || "Product Bank selection processed.", "success");
      setSelectedIds([]);
      await loadProducts();
    } catch (nextError) {
      showToast(messageOf(nextError, "Products could not be added from Product Bank."), "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Product Bank"
          description="Choose published product templates and add editable copies to your workspace Product Master."
        />
        <Button onClick={() => navigate("/products-materials/products")} variant="secondary">
          View workspace products
        </Button>
      </div>

      <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-slate-700">
        Product Bank supplies product details only. Your purchase prices, selling prices, stock, and later edits remain private to your workspace.
      </section>

      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <SearchInput
          className="block"
          placeholder="Search products, brands, models, or specifications"
          value={filters.search}
          onChange={(search) => {
            setPage(1);
            setFilters((current) => ({ ...current, search }));
          }}
        />
        <SelectInput
          label="Category"
          value={filters.categoryId}
          onChange={(categoryId) => {
            setPage(1);
            setFilters((current) => ({ ...current, categoryId }));
          }}
          options={[{ value: "", label: "All categories" }, ...categories]}
        />
        <SelectInput
          label="Brand"
          value={filters.brand}
          onChange={(brand) => {
            setPage(1);
            setFilters((current) => ({ ...current, brand }));
          }}
          options={[{ value: "", label: "All brands" }, ...brands]}
        />
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load Product Bank" description={error} action={<Button onClick={() => void loadProducts()}>Try again</Button>} /> : null}
      {!loading && !error && products.length === 0 ? (
        <EmptyState
          title="No Product Bank products found"
          description="Try another search or ask a platform administrator to publish product templates."
        />
      ) : null}

      {!loading && !error && products.length > 0 ? (
        <ProductBankTable
          importing={importing}
          onToggle={toggleSelected}
          products={displayedProducts}
          selectedIds={selectedIds}
          tenantMode
          canCreate={canCreate}
        />
      ) : null}
      {!loading && !error && products.length > 0 ? (
        <TablePagination label="Product Bank products" pagination={productPagination} pageSizeOptions={[50]} />
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur sm:bottom-4 sm:mx-auto sm:max-w-xl sm:rounded-xl sm:border">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-800">
              {selectedIds.length} product{selectedIds.length === 1 ? "" : "s"} selected
            </p>
            <Button disabled={!canCreate || importing} onClick={() => void addSelectedProducts()}>
              {importing ? "Adding products..." : "Add to Product Master"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProductBankAdminPage() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<ProductBankProduct[]>([]);
  const [categories, setCategories] = useState<CatalogLibraryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProductBankFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<{ title: string; description: string } | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [nextProducts, nextCategories] = await Promise.all([
        fetchProductBankProducts(),
        fetchCatalogLibraryCategories(),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
    } catch (nextError) {
      setError(messageOf(nextError, "Product Bank could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    const nextErrors = validateProductBankForm(form.values);
    setFormErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setAlert({
        title: "Product Bank details missing",
        description: Object.values(nextErrors).filter(Boolean).join("\n"),
      });
      return;
    }

    try {
      setSaving(true);
      if (form.mode === "create") {
        await createProductBankProduct(form.values);
        showToast("Product Bank template created.", "success");
      } else if (form.product) {
        await updateProductBankProduct(form.product.id, form.values);
        showToast("Product Bank template updated.", "success");
      }
      setForm(null);
      await loadData();
    } catch (nextError) {
      const description = messageOf(nextError, "Product Bank template could not be saved.");
      setAlert({ title: "Product Bank save failed", description });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  const publishedCount = products.filter((product) => product.publication_status === "published").length;
  const draftCount = products.filter((product) => product.publication_status === "draft").length;
  const productPagination = useTablePagination(products);
  const displayedProducts = productPagination.pageItems;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Product Bank"
          description="Create shared templates for tenant workspaces. Published templates can be selected from Masters."
        />
        <Button
          onClick={() => {
            setFormErrors({});
            setForm({ mode: "create", product: null, values: emptyProductBankForm() });
          }}
        >
          Add Product Bank Template
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="All templates" value={products.length} />
        <Metric label="Published" value={publishedCount} />
        <Metric label="Drafts" value={draftCount} />
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load Product Bank" description={error} action={<Button onClick={() => void loadData()}>Try again</Button>} /> : null}
      {!loading && !error && products.length === 0 ? (
        <EmptyState
          title="No Product Bank templates yet"
          description="Create a draft, verify the details, then publish it for all tenant workspaces."
          action={<Button onClick={() => setForm({ mode: "create", product: null, values: emptyProductBankForm() })}>Add Product Bank Template</Button>}
        />
      ) : null}
      {!loading && !error && products.length > 0 ? (
        <ProductBankTable
          onEdit={(product) => {
            setFormErrors({});
            setForm({ mode: "edit", product, values: productBankToForm(product) });
          }}
          products={displayedProducts}
        />
      ) : null}
      {!loading && !error && products.length > 0 ? (
        <TablePagination label="Product Bank templates" pagination={productPagination} />
      ) : null}

      {form ? (
        <ProductBankFormModal
          categories={categories}
          errors={formErrors}
          onClose={() => setForm(null)}
          onSubmit={submitForm}
          saving={saving}
          setValues={(values) => setForm({ ...form, values })}
          title={form.mode === "create" ? "Add Product Bank Template" : "Edit Product Bank Template"}
          values={form.values}
        />
      ) : null}
      {alert ? <AlertDialog title={alert.title} description={alert.description} onClose={() => setAlert(null)} /> : null}
    </div>
  );
}

function ProductBankFormModal({
  categories,
  errors,
  onClose,
  onSubmit,
  saving,
  setValues,
  title,
  values,
}: {
  categories: CatalogLibraryCategory[];
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  setValues: (values: ProductBankProductFormValues) => void;
  title: string;
  values: ProductBankProductFormValues;
}) {
  function update(key: keyof ProductBankProductFormValues, value: string) {
    setValues({ ...values, [key]: value });
  }

  return (
    <Modal title={title} onClose={onClose} onSubmit={onSubmit} noValidate submitting={saving} submitLabel="Save template">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Category<span className="text-rose-600"> *</span></span>
        <select
          className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100 ${errors.category_id ? "border-rose-300" : "border-stone-200"}`}
          value={values.category_id}
          onChange={(event) => update("category_id", event.target.value)}
        >
          <option value="">Select category</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        {errors.category_id ? <p className="mt-1 text-xs text-rose-700">{errors.category_id}</p> : null}
      </label>
      <TextInput label="Product Name" value={values.product_name} onChange={(value) => update("product_name", value)} error={errors.product_name} required />
      <TextInput label="Brand" value={values.brand} onChange={(value) => update("brand", value)} />
      <TextInput label="Model Number" value={values.model_number} onChange={(value) => update("model_number", value)} />
      <TextInput label="Specifications" value={values.specifications} onChange={(value) => update("specifications", value)} />
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Unit<span className="text-rose-600"> *</span></span>
        <select
          className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100 ${errors.unit ? "border-rose-300" : "border-stone-200"}`}
          value={values.unit}
          onChange={(event) => update("unit", event.target.value)}
        >
          <option value="">Select unit</option>
          {productUnitOptions.map((unit) => <option key={unit} value={unit}>{labelize(unit)}</option>)}
        </select>
        {errors.unit ? <p className="mt-1 text-xs text-rose-700">{errors.unit}</p> : null}
      </label>
      <TextInput label="HSN Code" value={values.hsn_code} onChange={(value) => update("hsn_code", value)} />
      <TextInput label="GST Percent" value={values.gst_percent} onChange={(value) => update("gst_percent", value)} error={errors.gst_percent} inputMode="decimal" />
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Availability</span>
        <select
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
          value={values.publication_status}
          onChange={(event) => update("publication_status", event.target.value)}
        >
          {productBankPublicationOptions.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}
        </select>
      </label>
      <TextArea label="Warranty Description" value={values.warranty_description} onChange={(value) => update("warranty_description", value)} />
      <TextArea label="Notes" value={values.notes} onChange={(value) => update("notes", value)} />
    </Modal>
  );
}

function ProductBankTable({
  canCreate = false,
  importing = false,
  onEdit,
  onToggle,
  products,
  selectedIds = [],
  tenantMode = false,
}: {
  canCreate?: boolean;
  importing?: boolean;
  onEdit?: (product: ProductBankProduct) => void;
  onToggle?: (product: ProductBankProduct) => void;
  products: ProductBankProduct[];
  selectedIds?: string[];
  tenantMode?: boolean;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      <table className="min-w-[960px] w-full border-collapse text-left text-sm">
        <caption className="sr-only">Product Bank products</caption>
        <thead className="sticky top-0 z-10 bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Brand</th>
            <th className="px-4 py-3">Unit</th>
            <th className="px-4 py-3">GST / HSN</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">{tenantMode ? "Select" : "Manage"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {products.map((product) => {
            const workspaceProduct = product.workspace_product;
            const alreadyAdded = Boolean(workspaceProduct && !workspaceProduct.archived_at);
            const selected = selectedIds.includes(product.id);
            const canSelect = tenantMode && canCreate && !alreadyAdded && !importing;

            return (
              <tr className={selected ? "bg-orange-50" : "hover:bg-stone-50"} key={product.id}>
                <td className="max-w-md px-4 py-3 align-top">
                  <p className="font-semibold text-[#06173f]">{product.product_name}</p>
                  {(product.model_number || product.specifications) ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      {[product.model_number, product.specifications].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 align-top text-slate-700">{product.category.name}</td>
                <td className="px-4 py-3 align-top text-slate-700">{product.brand ?? "—"}</td>
                <td className="px-4 py-3 align-top text-slate-700">{labelize(product.unit)}</td>
                <td className="px-4 py-3 align-top text-slate-700">
                  <p>{product.gst_percent ?? 0}%</p>
                  <p className="mt-1 text-xs text-slate-500">{product.hsn_code ?? "No HSN"}</p>
                </td>
                <td className="px-4 py-3 align-top">
                  {tenantMode ? <ImportStateBadge product={product} /> : <PublicationStatusBadge value={product.publication_status} />}
                </td>
                <td className="px-4 py-3 text-right align-top">
                  {tenantMode ? (
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        aria-label={`${selected ? "Remove" : "Select"} ${product.product_name}`}
                        checked={selected}
                        className="h-4 w-4 rounded border-stone-300 text-orange-600 focus:ring-orange-500"
                        disabled={!canSelect}
                        onChange={() => onToggle?.(product)}
                        type="checkbox"
                      />
                      <span>{alreadyAdded ? "Added" : workspaceProduct?.archived_at ? "Restore" : "Select"}</span>
                    </label>
                  ) : (
                    <button
                      className="font-semibold text-orange-700 hover:text-orange-800 hover:underline"
                      onClick={() => onEdit?.(product)}
                      type="button"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ImportStateBadge({ product }: { product: ProductBankProduct }) {
  if (product.workspace_product?.archived_at) return <Badge tone="amber">Archived in workspace</Badge>;
  if (product.workspace_product) return <Badge tone="green">Added</Badge>;
  return <Badge tone="blue">Available</Badge>;
}

function PublicationStatusBadge({ value }: { value: ProductBankProduct["publication_status"] }) {
  return <Badge tone={value === "published" ? "green" : value === "draft" ? "amber" : "red"}>{labelize(value)}</Badge>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p></section>;
}

function uniqueOptions(values: Array<{ value: string; label: string }>) {
  const seen = new Set<string>();
  return values.filter((option) => {
    const key = option.value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
