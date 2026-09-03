import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { formatMoneyWithPaise } from "../quotations/quotationUtils";
import { fetchProducts } from "../product-master/productMasterApi";
import type { Product } from "../product-master/types";
import {
  createQuotationPackage,
  fetchQuotationPackages,
  updateQuotationPackage,
} from "./quotationPackageApi";
import {
  emptyQuotationPackageForm,
  quotationPackageToForm,
  validateQuotationPackageForm,
} from "./quotationPackageUtils";
import type {
  QuotationPackage,
  QuotationPackageFormValues,
} from "./types";

type PackageFormState = {
  quotationPackage: QuotationPackage | null;
  values: QuotationPackageFormValues;
};

export function QuotationPackagesSection({ readOnly }: { readOnly: boolean }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [packages, setPackages] = useState<QuotationPackage[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const activeProductOptions = useMemo(
    () => {
      const packageProductIds = new Set(
        packages.flatMap((quotationPackage) =>
          quotationPackage.items.map((item) => item.product_id),
        ),
      );

      return products
        .filter(
          (product) =>
            product.status === "active" || packageProductIds.has(product.id),
        )
        .map((product) => ({
          value: product.id,
          label: productLabel(product),
        }));
    },
    [packages, products],
  );

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [nextPackages, nextProducts] = await Promise.all([
        fetchQuotationPackages(profile, true),
        fetchProducts(profile),
      ]);
      setPackages(nextPackages);
      setProducts(nextProducts);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load quotation packages.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData is intentionally refreshed when the signed-in profile changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  function openCreateForm() {
    setFormErrors({});
    setForm({ quotationPackage: null, values: emptyQuotationPackageForm() });
  }

  function openEditForm(quotationPackage: QuotationPackage) {
    setFormErrors({});
    setForm({
      quotationPackage,
      values: quotationPackageToForm(quotationPackage),
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }

    const nextErrors = validateQuotationPackageForm(form.values);
    setFormErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (form.quotationPackage) {
        await updateQuotationPackage(profile, form.quotationPackage.id, form.values);
        showToast("Quotation package updated.", "success");
      } else {
        await createQuotationPackage(profile, form.values);
        showToast("Quotation package created.", "success");
      }
      setForm(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation package could not be saved.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            Quotation Packages
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Save your offered products and a turnkey price once. Your team can
            apply a package to any enquiry, then tailor the BOM before sending.
          </p>
        </div>
        {!readOnly ? <Button onClick={openCreateForm}>Create Package</Button> : null}
      </div>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load packages" description={error} /> : null}
      {!loading && !error && packages.length === 0 ? (
        <EmptyState
          title="No quotation packages yet"
          description="Create a package with the products you commonly offer and its commercial cost."
          action={!readOnly ? <Button onClick={openCreateForm}>Create Package</Button> : null}
        />
      ) : null}

      {!loading && !error && packages.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {packages.map((quotationPackage) => (
            <article
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              key={quotationPackage.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-base font-semibold text-slate-950">
                    {quotationPackage.name}
                  </h4>
                  <p className="mt-1 text-sm font-semibold text-[#06173f]">
                    {formatMoneyWithPaise(quotationPackage.commercial_cost)} turnkey
                  </p>
                </div>
                <Badge tone={quotationPackage.is_active ? "green" : "amber"}>
                  {quotationPackage.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>

              {quotationPackage.description ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {quotationPackage.description}
                </p>
              ) : null}

              <div className="mt-4 rounded-lg bg-stone-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {quotationPackage.items.length} product{quotationPackage.items.length === 1 ? "" : "s"}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-slate-700">
                  {quotationPackage.items
                    .map((item) => `${item.product_name} × ${item.quantity}`)
                    .join(", ")}
                </p>
              </div>

              {!readOnly ? (
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => openEditForm(quotationPackage)} variant="secondary">
                    Edit Package
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {form ? (
        <QuotationPackageFormModal
          errors={formErrors}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
          products={activeProductOptions}
          saving={saving}
          setValues={(values) => setForm((current) => (current ? { ...current, values } : current))}
          title={form.quotationPackage ? "Edit Quotation Package" : "Create Quotation Package"}
          values={form.values}
        />
      ) : null}
    </div>
  );
}

function QuotationPackageFormModal({
  title,
  values,
  setValues,
  products,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: QuotationPackageFormValues;
  setValues: (values: QuotationPackageFormValues) => void;
  products: Array<{ value: string; label: string }>;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(key: "name" | "description" | "commercial_cost", value: string) {
    setValues({ ...values, [key]: value });
  }

  function updateItem(index: number, key: "product_id" | "quantity", value: string) {
    setValues({
      ...values,
      items: values.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    });
  }

  function addItem() {
    setValues({
      ...values,
      items: [...values.items, { product_id: "", quantity: "1" }],
    });
  }

  function removeItem(index: number) {
    setValues({
      ...values,
      items: values.items.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  return (
    <Modal
      maxWidthClass="sm:max-w-4xl"
      noValidate
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Package"
      submitting={saving}
      title={title}
    >
      <TextInput
        error={errors.name}
        label="Package Name"
        onChange={(value) => update("name", value)}
        required
        value={values.name}
      />
      <TextInput
        error={errors.commercial_cost}
        label="Commercial Cost (incl. GST)"
        onChange={(value) => update("commercial_cost", value)}
        required
        type="number"
        value={values.commercial_cost}
      />
      <TextArea
        className="md:col-span-2"
        label="Notes (optional)"
        onChange={(value) => update("description", value)}
        value={values.description}
      />
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700 md:col-span-2">
        <input
          checked={values.is_active}
          className="size-4 rounded border-stone-300 text-orange-600 focus:ring-orange-500"
          onChange={(event) => setValues({ ...values, is_active: event.target.checked })}
          type="checkbox"
        />
        Available to use in new quotations
      </label>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 md:col-span-2 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">Package products</h3>
            <p className="mt-1 text-sm text-slate-600">
              Product details are captured with this package and copied into the quotation BOM.
            </p>
          </div>
          <Button onClick={addItem} variant="secondary">Add Product</Button>
        </div>

        {errors.items ? <p className="mt-3 text-xs text-rose-700">{errors.items}</p> : null}
        <div className="mt-4 space-y-3">
          {values.items.map((item, index) => (
            <div className="grid gap-3 rounded-lg border border-stone-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_130px_auto]" key={`${index}-${item.product_id}`}>
              <div>
                <SelectInput
                  label={`Product ${index + 1}`}
                  onChange={(value) => updateItem(index, "product_id", value)}
                  options={[{ value: "", label: "Select product" }, ...products]}
                  value={item.product_id}
                />
                {errors[`item-${index}-product_id`] ? (
                  <p className="mt-1 text-xs text-rose-700">
                    {errors[`item-${index}-product_id`]}
                  </p>
                ) : null}
              </div>
              <TextInput
                error={errors[`item-${index}-quantity`]}
                label="Quantity"
                onChange={(value) => updateItem(index, "quantity", value)}
                type="number"
                value={item.quantity}
              />
              <div className="flex items-end">
                <Button
                  disabled={values.items.length === 1}
                  onClick={() => removeItem(index)}
                  variant="ghost"
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function productLabel(product: Product) {
  return [
    product.product_name,
    product.brand,
    product.model_number,
    product.specifications,
  ]
    .filter(Boolean)
    .join(" — ");
}
