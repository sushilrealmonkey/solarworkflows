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
  createProductType,
  fetchProductCategories,
  fetchProductTypes,
  fetchProducts,
  importProductCatalogDefaults,
  updateProductCategory,
  updateProductType,
} from "./productMasterApi";
import {
  emptyProductCategoryForm,
  emptyProductTypeForm,
  productCategoryToForm,
  productTypeToForm,
  productValidationSummary,
  validateProductCategoryForm,
  validateProductTypeForm,
} from "./productMasterUtils";
import {
  ProductCategoryFormModal,
  ProductCategoryTypeBadge,
  ProductTypeFormModal,
} from "./ProductMasterComponents";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
  ProductType,
  ProductTypeFormValues,
} from "./types";

type ProductCategoryFormState = {
  mode: "create" | "edit";
  category: ProductCategory | null;
  values: ProductCategoryFormValues;
};

type ProductTypeFormState = {
  mode: "create" | "edit";
  productType: ProductType | null;
  values: ProductTypeFormValues;
};

export function CategoryMasterPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] =
    useState<ProductCategoryFormState | null>(null);
  const [categoryFormErrors, setCategoryFormErrors] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);
  const [importingDefaults, setImportingDefaults] = useState(false);
  const [savingProductType, setSavingProductType] = useState(false);
  const [managingProductTypesFor, setManagingProductTypesFor] =
    useState<ProductCategory | null>(null);
  const [productTypeForm, setProductTypeForm] =
    useState<ProductTypeFormState | null>(null);
  const [productTypeFormErrors, setProductTypeFormErrors] = useState<
    Record<string, string>
  >({});
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

  const categoryProductTypeCounts = useMemo(() => {
    return productTypes.reduce<Record<string, number>>((counts, productType) => {
      counts[productType.category_id] =
        (counts[productType.category_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [productTypes]);

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextCategories, nextProducts, nextProductTypes] = await Promise.all([
        fetchProductCategories(profile),
        fetchProducts(profile),
        fetchProductTypes(profile),
      ]);
      setCategories(nextCategories);
      setProducts(nextProducts);
      setProductTypes(nextProductTypes);
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

  function openProductTypesManager(category: ProductCategory) {
    setManagingProductTypesFor(category);
    setProductTypeForm(null);
    setProductTypeFormErrors({});
  }

  function openCreateProductTypeForm(category: ProductCategory) {
    setProductTypeFormErrors({});
    setProductTypeForm({
      mode: "create",
      productType: null,
      values: emptyProductTypeForm(category.id),
    });
  }

  function openEditProductTypeForm(productType: ProductType) {
    setProductTypeFormErrors({});
    setProductTypeForm({
      mode: "edit",
      productType,
      values: productTypeToForm(productType),
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

  async function handleProductTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!productTypeForm) {
      return;
    }

    const nextErrors = validateProductTypeForm(productTypeForm.values);
    setProductTypeFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSaveAlert({
        title: "Product type details missing",
        description:
          productValidationSummary(nextErrors) ||
          "Please complete the required product type details before saving.",
      });
      return;
    }

    try {
      setSavingProductType(true);
      if (productTypeForm.mode === "create") {
        await createProductType(profile, productTypeForm.values);
        showToast("Product type added.", "success");
      } else if (productTypeForm.productType) {
        await updateProductType(
          productTypeForm.productType.id,
          productTypeForm.values,
        );
        showToast("Product type updated.", "success");
      }

      setProductTypeForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "Product type save failed.";
      setSaveAlert({
        title: "Product type could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setSavingProductType(false);
    }
  }

  async function handleImportDefaults() {
    try {
      setImportingDefaults(true);
      const result = await importProductCatalogDefaults();
      await loadData();
      showToast(
        `Imported ${result.categories_imported ?? 0} categories and ${
          result.product_types_imported ?? 0
        } product types.`,
        "success",
      );
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
                  <th className="px-4 py-3">Product Types</th>
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
                      {categoryProductTypeCounts[category.id] ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      {categoryProductCounts[category.id] ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      {category.is_active === false ? "Inactive" : "Active"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => openProductTypesManager(category)}
                          variant="secondary"
                        >
                          Manage Types
                        </Button>
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
                      {categoryProductTypeCounts[category.id] ?? 0} types /{" "}
                      {categoryProductCounts[category.id] ?? 0} products /{" "}
                      {category.is_active === false ? "Inactive" : "Active"}
                    </p>
                  </div>
                  <ProductCategoryTypeBadge value={category.category_type} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={() => openProductTypesManager(category)}
                    variant="secondary"
                  >
                    Manage Types
                  </Button>
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

      {managingProductTypesFor ? (
        <ProductTypesManager
          canCreate={canCreate}
          canUpdate={canUpdate}
          category={managingProductTypesFor}
          productTypes={productTypes.filter(
            (productType) =>
              productType.category_id === managingProductTypesFor.id,
          )}
          onAdd={() => openCreateProductTypeForm(managingProductTypesFor)}
          onClose={() => {
            setManagingProductTypesFor(null);
            setProductTypeForm(null);
            setProductTypeFormErrors({});
          }}
          onEdit={openEditProductTypeForm}
        />
      ) : null}

      {productTypeForm ? (
        <ProductTypeFormModal
          title={
            productTypeForm.mode === "create"
              ? "Add Product Type"
              : "Edit Product Type"
          }
          values={productTypeForm.values}
          setValues={(values) =>
            setProductTypeForm({ ...productTypeForm, values })
          }
          errors={productTypeFormErrors}
          onClose={() => setProductTypeForm(null)}
          onSubmit={handleProductTypeSubmit}
          saving={savingProductType}
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

function ProductTypesManager({
  canCreate,
  canUpdate,
  category,
  productTypes,
  onAdd,
  onClose,
  onEdit,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  category: ProductCategory;
  productTypes: ProductType[];
  onAdd: () => void;
  onClose: () => void;
  onEdit: (productType: ProductType) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-4 shadow-xl sm:max-w-3xl sm:rounded-xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-normal text-slate-950">
              Product Types
            </h2>
            <p className="mt-1 text-sm text-slate-600">{category.name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate ? <Button onClick={onAdd}>Add Type</Button> : null}
            <Button onClick={onClose} variant="ghost">
              Close
            </Button>
          </div>
        </div>

        {productTypes.length === 0 ? (
          <EmptyState
            title="No product types found"
            description="No product types have been added for this category."
            action={canCreate ? <Button onClick={onAdd}>Add Type</Button> : null}
          />
        ) : (
          <div className="mt-5 overflow-hidden rounded-lg border border-stone-200">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Display Order</th>
                  <th className="px-4 py-3">Product Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-20 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 bg-white">
                {productTypes.map((productType) => (
                  <tr key={productType.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {productType.display_order}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {productType.name}
                    </td>
                    <td className="px-4 py-3">
                      {productType.is_active === false ? "Inactive" : "Active"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canUpdate ? (
                        <Button
                          onClick={() => onEdit(productType)}
                          variant="ghost"
                        >
                          Edit
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
