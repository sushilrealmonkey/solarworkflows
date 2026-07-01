import { useEffect, useState, type FormEvent } from "react";
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
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  ProductCategoryTypeBadge,
} from "../product-master/ProductMasterComponents";
import { productCategoryTypeOptions } from "../product-master/productMasterUtils";
import {
  createCatalogLibraryBrand,
  createCatalogLibraryCategory,
  fetchCatalogLibraryBrands,
  fetchCatalogLibraryCategories,
  updateCatalogLibraryBrand,
  updateCatalogLibraryCategory,
} from "./catalogLibraryApi";
import {
  catalogBrandToForm,
  catalogCategoryToForm,
  catalogValidationSummary,
  emptyCatalogBrandForm,
  emptyCatalogCategoryForm,
  validateCatalogBrandForm,
  validateCatalogCategoryForm,
} from "./catalogLibraryUtils";
import type {
  CatalogLibraryBrand,
  CatalogLibraryBrandFormValues,
  CatalogLibraryCategory,
  CatalogLibraryCategoryFormValues,
} from "./types";

type CatalogTab = "categories" | "brands";

type CategoryFormState = {
  mode: "create" | "edit";
  category: CatalogLibraryCategory | null;
  values: CatalogLibraryCategoryFormValues;
};

type BrandFormState = {
  mode: "create" | "edit";
  brand: CatalogLibraryBrand | null;
  values: CatalogLibraryBrandFormValues;
};

export function CatalogLibraryPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<CatalogTab>("categories");
  const [categories, setCategories] = useState<CatalogLibraryCategory[]>([]);
  const [brands, setBrands] = useState<CatalogLibraryBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ title: string; description: string } | null>(
    null,
  );
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [brandForm, setBrandForm] = useState<BrandFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  async function loadData() {
    if (!profile?.is_super_admin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextCategories, nextBrands] = await Promise.all([
        fetchCatalogLibraryCategories(),
        fetchCatalogLibraryBrands(),
      ]);
      setCategories(nextCategories);
      setBrands(nextBrands);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load catalog library.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current admin profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.is_super_admin]);

  if (!profile?.is_super_admin) {
    return (
      <AccessDenied
        title="Catalog Library is not available"
        description="Only super admins can manage shared catalog defaults."
      />
    );
  }

  function openCreateCategoryForm() {
    setFormErrors({});
    setCategoryForm({
      mode: "create",
      category: null,
      values: emptyCatalogCategoryForm(),
    });
  }

  function openEditCategoryForm(category: CatalogLibraryCategory) {
    setFormErrors({});
    setCategoryForm({
      mode: "edit",
      category,
      values: catalogCategoryToForm(category),
    });
  }

  function openCreateBrandForm() {
    setFormErrors({});
    setBrandForm({
      mode: "create",
      brand: null,
      values: emptyCatalogBrandForm(),
    });
  }

  function openEditBrandForm(brand: CatalogLibraryBrand) {
    setFormErrors({});
    setBrandForm({
      mode: "edit",
      brand,
      values: catalogBrandToForm(brand),
    });
  }

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!categoryForm) {
      return;
    }

    const nextErrors = validateCatalogCategoryForm(categoryForm.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setAlert({
        title: "Category details missing",
        description:
          catalogValidationSummary(nextErrors) ||
          "Please complete the required category details.",
      });
      return;
    }

    try {
      setSaving(true);
      if (categoryForm.mode === "create") {
        await createCatalogLibraryCategory(categoryForm.values);
        showToast("Catalog category added.", "success");
      } else if (categoryForm.category) {
        await updateCatalogLibraryCategory(
          categoryForm.category.id,
          categoryForm.values,
        );
        showToast("Catalog category updated.", "success");
      }
      setCategoryForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error ? nextError.message : "Category save failed.";
      setAlert({ title: "Category could not be saved", description });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleBrandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!brandForm) {
      return;
    }

    const nextErrors = validateCatalogBrandForm(brandForm.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setAlert({
        title: "Brand details missing",
        description:
          catalogValidationSummary(nextErrors) ||
          "Please complete the required brand details.",
      });
      return;
    }

    try {
      setSaving(true);
      if (brandForm.mode === "create") {
        await createCatalogLibraryBrand(brandForm.values);
        showToast("Catalog brand added.", "success");
      } else if (brandForm.brand) {
        await updateCatalogLibraryBrand(brandForm.brand.id, brandForm.values);
        showToast("Catalog brand updated.", "success");
      }
      setBrandForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error ? nextError.message : "Brand save failed.";
      setAlert({ title: "Brand could not be saved", description });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Catalog Library"
          description="Manage shared defaults tenants can import or use as suggestions for their own catalog setup."
        />
        <div className="flex flex-wrap gap-2">
          {activeTab === "categories" ? (
            <Button onClick={openCreateCategoryForm}>Add Category</Button>
          ) : null}
          {activeTab === "brands" ? (
            <Button onClick={openCreateBrandForm}>Add Brand</Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm">
        <TabButton
          active={activeTab === "categories"}
          onClick={() => setActiveTab("categories")}
        >
          Categories
        </TabButton>
        <TabButton
          active={activeTab === "brands"}
          onClick={() => setActiveTab("brands")}
        >
          Brands
        </TabButton>
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load catalog library" description={error} /> : null}

      {!loading && !error && activeTab === "categories" ? (
        <CategoryLibraryList
          categories={categories}
          onEdit={openEditCategoryForm}
        />
      ) : null}
      {!loading && !error && activeTab === "brands" ? (
        <BrandLibraryList brands={brands} onEdit={openEditBrandForm} />
      ) : null}

      {categoryForm ? (
        <CatalogCategoryFormModal
          title={
            categoryForm.mode === "create"
              ? "Add Catalog Category"
              : "Edit Catalog Category"
          }
          values={categoryForm.values}
          setValues={(values) => setCategoryForm({ ...categoryForm, values })}
          errors={formErrors}
          onClose={() => setCategoryForm(null)}
          onSubmit={handleCategorySubmit}
          saving={saving}
        />
      ) : null}


      {brandForm ? (
        <CatalogBrandFormModal
          title={
            brandForm.mode === "create"
              ? "Add Catalog Brand"
              : "Edit Catalog Brand"
          }
          values={brandForm.values}
          setValues={(values) => setBrandForm({ ...brandForm, values })}
          errors={formErrors}
          onClose={() => setBrandForm(null)}
          onSubmit={handleBrandSubmit}
          saving={saving}
        />
      ) : null}

      {alert ? (
        <AlertDialog
          title={alert.title}
          description={alert.description}
          onClose={() => setAlert(null)}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold transition ${
        active
          ? "bg-orange-600 text-white shadow-sm"
          : "text-slate-600 hover:bg-stone-100"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusBadge({ active }: { active: boolean | null }) {
  return <Badge tone={active === false ? "amber" : "green"}>{active === false ? "Inactive" : "Active"}</Badge>;
}

function CategoryLibraryList({
  categories,
  onEdit,
}: {
  categories: CatalogLibraryCategory[];
  onEdit: (category: CatalogLibraryCategory) => void;
}) {
  const categoryPagination = useTablePagination(categories);
  const paginatedCategories = categoryPagination.pageItems;

  if (categories.length === 0) {
    return (
      <EmptyState
        title="No catalog categories found"
        description="Add shared category defaults that tenants can import into their own Category Master."
      />
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="hidden overflow-hidden rounded-lg border border-stone-200 md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Display Order</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="w-36 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {paginatedCategories.map((category) => (
              <tr key={category.id}>
                <td className="px-4 py-3 font-semibold text-slate-950">
                  {category.display_order}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-950">{category.name}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">
                    {category.description ?? "No description"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ProductCategoryTypeBadge value={category.category_type} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={category.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => onEdit(category)} variant="ghost">
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {paginatedCategories.map((category) => (
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
              </div>
              <ProductCategoryTypeBadge value={category.category_type} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge active={category.is_active} />
              <Button onClick={() => onEdit(category)} variant="ghost">
                Edit
              </Button>
            </div>
          </article>
        ))}
      </div>
      <TablePagination
        label="catalog categories"
        pagination={categoryPagination}
      />
    </section>
  );
}

function BrandLibraryList({
  brands,
  onEdit,
}: {
  brands: CatalogLibraryBrand[];
  onEdit: (brand: CatalogLibraryBrand) => void;
}) {
  const brandPagination = useTablePagination(brands);
  const paginatedBrands = brandPagination.pageItems;

  if (brands.length === 0) {
    return (
      <EmptyState
        title="No catalog brands found"
        description="Add known brand suggestions for product forms while keeping tenant brand entries editable."
      />
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="hidden overflow-hidden rounded-lg border border-stone-200 md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Display Order</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Status</th>
              <th className="w-20 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {paginatedBrands.map((brand) => (
              <tr key={brand.id}>
                <td className="px-4 py-3 font-semibold text-slate-950">
                  {brand.display_order}
                </td>
                <td className="px-4 py-3 font-medium text-slate-950">
                  {brand.name}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={brand.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Button onClick={() => onEdit(brand)} variant="ghost">
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {paginatedBrands.map((brand) => (
          <article
            key={brand.id}
            className="rounded-lg border border-stone-200 bg-stone-50 p-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Order {brand.display_order}
            </p>
            <h2 className="mt-1 text-sm font-semibold text-slate-950">
              {brand.name}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge active={brand.is_active} />
              <Button onClick={() => onEdit(brand)} variant="ghost">
                Edit
              </Button>
            </div>
          </article>
        ))}
      </div>
      <TablePagination label="catalog brands" pagination={brandPagination} />
    </section>
  );
}

function CatalogCategoryFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: CatalogLibraryCategoryFormValues;
  setValues: (values: CatalogLibraryCategoryFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(
    key: keyof CatalogLibraryCategoryFormValues,
    value: string | boolean,
  ) {
    setValues({ ...values, [key]: value });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      noValidate
      submitLabel="Save"
      submitting={saving}
    >
      <TextInput
        label="Category Name"
        value={values.name}
        onChange={(value) => update("name", value)}
        error={errors.name}
        required
      />
      <TextInput
        label="Display Order"
        type="number"
        value={values.display_order}
        onChange={(value) => update("display_order", value)}
        error={errors.display_order}
        required
      />
      <SelectInput
        label="Category Type"
        value={values.category_type}
        onChange={(value) => update("category_type", value)}
        options={[
          { value: "", label: "Select type" },
          ...productCategoryTypeOptions.map((categoryType) => ({
            value: categoryType,
            label: labelize(categoryType),
          })),
        ]}
      />
      {errors.category_type ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.category_type}</p>
      ) : null}
      <label className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-medium text-slate-700">
        <input
          checked={values.is_active}
          className="h-4 w-4 rounded border-stone-300 text-[#06173f] focus:ring-orange-600"
          onChange={(event) => update("is_active", event.target.checked)}
          type="checkbox"
        />
        Active
      </label>
      <TextArea
        label="Description"
        value={values.description}
        onChange={(value) => update("description", value)}
      />
    </Modal>
  );
}

function CatalogBrandFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: CatalogLibraryBrandFormValues;
  setValues: (values: CatalogLibraryBrandFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(
    key: keyof CatalogLibraryBrandFormValues,
    value: string | boolean,
  ) {
    setValues({ ...values, [key]: value });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      noValidate
      submitLabel="Save"
      submitting={saving}
      maxWidthClass="sm:max-w-xl"
    >
      <TextInput
        label="Brand Name"
        value={values.name}
        onChange={(value) => update("name", value)}
        error={errors.name}
        required
      />
      <TextInput
        label="Display Order"
        type="number"
        value={values.display_order}
        onChange={(value) => update("display_order", value)}
        error={errors.display_order}
        required
      />
      <label className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-medium text-slate-700">
        <input
          checked={values.is_active}
          className="h-4 w-4 rounded border-stone-300 text-[#06173f] focus:ring-orange-600"
          onChange={(event) => update("is_active", event.target.checked)}
          type="checkbox"
        />
        Active
      </label>
    </Modal>
  );
}
