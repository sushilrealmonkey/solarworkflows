import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import { hasPermission } from "../crm/crmUtils";
import {
  createProductCategory,
  fetchProductCategories,
  fetchProducts,
  importProductCatalogDefaults,
  updateProductCategory,
} from "./productMasterApi";
import {
  emptyProductCategoryForm,
  productCategoryToForm,
  productValidationSummary,
  validateProductCategoryForm,
} from "./productMasterUtils";
import {
  ProductCategoryFormModal,
  ProductCategoryTypeBadge,
} from "./ProductMasterComponents";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
} from "./types";

type ProductCategoryFormState = {
  mode: "create" | "edit";
  category: ProductCategory | null;
  values: ProductCategoryFormValues;
};

export function CategoryMasterPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] =
    useState<ProductCategoryFormState | null>(null);
  const [categoryFormErrors, setCategoryFormErrors] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);
  const [importingDefaults, setImportingDefaults] = useState(false);
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
  const canUpdate = hasPermission(
    profile,
    permissions,
    "product_master",
    "update",
  );
  const canImportDefaults = canCreate && Boolean(profile?.organization_id);

  const categoryProductCounts = useMemo(() => {
    return products.reduce<Record<string, number>>((counts, product) => {
      counts[product.category_id] = (counts[product.category_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [products]);

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextCategories, nextProducts] = await Promise.all([
        fetchProductCategories(profile),
        fetchProducts(profile),
      ]);
      setCategories(nextCategories);
      setProducts(nextProducts);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load categories.",
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

  if (!canView) {
    return (
      <AccessDenied
        title="Categories are not available"
        description="Your role needs product_master:view access to open Category Master."
      />
    );
  }

  function openCreateCategoryForm() {
    setCategoryFormErrors({});
    setCategoryForm({
      mode: "create",
      category: null,
      values: emptyProductCategoryForm(),
    });
  }

  function openEditCategoryForm(category: ProductCategory) {
    setCategoryFormErrors({});
    setCategoryForm({
      mode: "edit",
      category,
      values: productCategoryToForm(category),
    });
  }

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!categoryForm) {
      return;
    }

    const nextErrors = validateProductCategoryForm(categoryForm.values);
    setCategoryFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSaveAlert({
        title: "Category details missing",
        description:
          productValidationSummary(nextErrors) ||
          "Please complete the required category details before saving.",
      });
      return;
    }

    try {
      setSaving(true);
      if (categoryForm.mode === "create") {
        await createProductCategory(profile, categoryForm.values);
        showToast("Category added.", "success");
      } else if (categoryForm.category) {
        await updateProductCategory(
          profile,
          categoryForm.category.id,
          categoryForm.values,
        );
        showToast("Category updated.", "success");
      }

      setCategoryForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error ? nextError.message : "Category save failed.";
      setSaveAlert({
        title: "Category could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleImportDefaults() {
    try {
      setImportingDefaults(true);
      const result = await importProductCatalogDefaults();
      await loadData();
      showToast(`Imported ${result.categories_imported ?? 0} categories.`, "success");
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "Catalog defaults import failed.";
      setSaveAlert({
        title: "Catalog defaults could not be imported",
        description,
      });
      showToast(description, "error");
    } finally {
      setImportingDefaults(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Categories"
          description="Manage product category type and display order for product selection, quotations, inventory, BOM planning, and reporting."
        />
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            {canImportDefaults ? (
              <Button
                disabled={importingDefaults}
                onClick={handleImportDefaults}
                variant="secondary"
              >
                {importingDefaults ? "Importing..." : "Import Defaults"}
              </Button>
            ) : null}
            <Button onClick={openCreateCategoryForm}>Add Category</Button>
          </div>
        ) : null}
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load categories" description={error} /> : null}
      {!loading && !error && categories.length === 0 ? (
        <EmptyState
          title="No categories found"
          description="Add categories to control product grouping and selector order."
          action={
            canCreate ? <Button onClick={openCreateCategoryForm}>Add Category</Button> : null
          }
        />
      ) : null}

      {!loading && !error && categories.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="hidden overflow-hidden rounded-lg border border-stone-200 md:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Display Order</th>
                  <th className="px-4 py-3">Category Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Products</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-20 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {category.display_order}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">
                        {category.name}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-600">
                        {category.description ?? "No description"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProductCategoryTypeBadge value={category.category_type} />
                    </td>
                    <td className="px-4 py-3">
                      {categoryProductCounts[category.id] ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      {category.is_active === false ? "Inactive" : "Active"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {canUpdate ? (
                          <Button
                            onClick={() => openEditCategoryForm(category)}
                            variant="ghost"
                          >
                            Edit
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {categories.map((category) => (
              <article
                key={category.id}
                className="rounded-lg border border-stone-200 bg-stone-50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Order {category.display_order}
                    </p>
                    <h2 className="mt-1 text-sm font-semibold text-slate-950">
                      {category.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                      {category.description ?? "No description"}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-600">
                      {categoryProductCounts[category.id] ?? 0} products /{" "}
                      {category.is_active === false ? "Inactive" : "Active"}
                    </p>
                  </div>
                  <ProductCategoryTypeBadge value={category.category_type} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canUpdate ? (
                    <Button
                      onClick={() => openEditCategoryForm(category)}
                      variant="ghost"
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {categoryForm ? (
        <ProductCategoryFormModal
          title={
            categoryForm.mode === "create" ? "Add Category" : "Edit Category"
          }
          mode={categoryForm.mode}
          values={categoryForm.values}
          setValues={(values) => setCategoryForm({ ...categoryForm, values })}
          errors={categoryFormErrors}
          canEditCategoryType={Boolean(profile?.is_super_admin)}
          onClose={() => setCategoryForm(null)}
          onSubmit={handleCategorySubmit}
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
