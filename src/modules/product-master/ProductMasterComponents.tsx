import { useId, type FormEvent } from "react";
import {
  Badge,
  DetailItem,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import type {
  Product,
  ProductCategory,
  ProductCategoryFormValues,
  ProductFormValues,
  ProductPrice,
  ProductPriceFormValues,
  ProductPriceHistory,
  ProductStatus,
  ProductType,
  ProductTypeFormValues,
} from "./types";
import {
  buildGeneratedProductName,
  formatProductCurrency,
  productCategoryTypeLabel,
  productCategoryTypeOptions,
  productTypeName,
  productStatusLabel,
  productStatusOptions,
  productUnitOptions,
} from "./productMasterUtils";

export function ProductStatusBadge({
  value,
}: {
  value: ProductStatus | null | undefined;
}) {
  const tone =
    value === "active" ? "green" : value === "inactive" ? "amber" : "red";

  return <Badge tone={tone}>{productStatusLabel(value)}</Badge>;
}

export function ProductCategoryTypeBadge({
  value,
}: {
  value: ProductCategory["category_type"] | null | undefined;
}) {
  return <Badge tone="blue">{productCategoryTypeLabel(value)}</Badge>;
}

export function ProductCategoryFormModal({
  title,
  mode,
  values,
  setValues,
  errors,
  canEditCategoryType,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  mode: "create" | "edit";
  values: ProductCategoryFormValues;
  setValues: (values: ProductCategoryFormValues) => void;
  errors: Record<string, string>;
  canEditCategoryType: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(key: keyof ProductCategoryFormValues, value: string) {
    setValues({ ...values, [key]: value });
  }

  const categoryTypeEditable = mode === "create" || canEditCategoryType;

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
      {categoryTypeEditable ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Category Type<span className="text-rose-600"> *</span>
          </span>
          <select
            className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100 ${
              errors.category_type ? "border-rose-300" : "border-stone-200"
            }`}
            value={values.category_type}
            onChange={(event) => update("category_type", event.target.value)}
          >
            <option value="">Select type</option>
            {productCategoryTypeOptions.map((categoryType) => (
              <option key={categoryType} value={categoryType}>
                {categoryType}
              </option>
            ))}
          </select>
          {errors.category_type ? (
            <p className="mt-1 text-xs text-rose-700">
              {errors.category_type}
            </p>
          ) : null}
        </label>
      ) : (
        <div>
          <span className="text-sm font-medium text-slate-700">
            Category Type
          </span>
          <div className="mt-1 min-h-11 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-semibold text-slate-700">
            {values.category_type || "-"}
          </div>
        </div>
      )}
      <TextArea
        label="Description"
        value={values.description}
        onChange={(value) => update("description", value)}
      />
    </Modal>
  );
}

export function ProductTypeFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: ProductTypeFormValues;
  setValues: (values: ProductTypeFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(
    key: keyof ProductTypeFormValues,
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
        label="Product Type Name"
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
          className="h-4 w-4 rounded border-stone-300 text-brand-700 focus:ring-brand-600"
          onChange={(event) => update("is_active", event.target.checked)}
          type="checkbox"
        />
        Active
      </label>
    </Modal>
  );
}

export function ProductFormModal({
  title,
  values,
  setValues,
  categories,
  productTypes,
  brandOptions,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: ProductFormValues;
  setValues: (values: ProductFormValues) => void;
  categories: ProductCategory[];
  productTypes: ProductType[];
  brandOptions?: string[];
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const activeCategories = categories.filter(
    (category) => category.is_active !== false,
  );
  const activeProductTypes = productTypes.filter(
    (productType) =>
      productType.category_id === values.category_id &&
      (productType.is_active !== false ||
        productType.id === values.product_type_id),
  );
  const brandListId = useId();
  const nameSourceFields: Array<keyof ProductFormValues> = [
    "category_id",
    "brand",
    "model_number",
    "specifications",
  ];

  function update(key: keyof ProductFormValues, value: string) {
    const nextValues = {
      ...values,
      [key]: value,
      ...(key === "category_id" ? { product_type_id: "" } : {}),
    };

    if (nameSourceFields.includes(key)) {
      nextValues.product_name = buildGeneratedProductName(nextValues, categories);
    }

    setValues(nextValues);
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
      <SelectInput
        label="Category"
        value={values.category_id}
        onChange={(value) => update("category_id", value)}
        options={[
          { value: "", label: "Select category" },
          ...activeCategories.map((category) => ({
            value: category.id,
            label: category.name,
          })),
        ]}
      />
      {errors.category_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.category_id}</p>
      ) : null}
      <SelectInput
        label="Product Type (Optional)"
        value={values.product_type_id}
        onChange={(value) => update("product_type_id", value)}
        options={[
          { value: "", label: "No product type" },
          ...activeProductTypes.map((productType) => ({
            value: productType.id,
            label: productType.name,
          })),
        ]}
      />
      <TextInput
        label="HSN Code"
        value={values.hsn_code}
        onChange={(value) => update("hsn_code", value)}
      />
      <BrandInput
        label="Brand"
        value={values.brand}
        onChange={(value) => update("brand", value)}
        options={brandOptions ?? []}
        listId={brandListId}
      />
      <TextInput
        label="Model Number"
        value={values.model_number}
        onChange={(value) => update("model_number", value)}
      />
      <TextInput
        label="Specifications"
        value={values.specifications}
        onChange={(value) => update("specifications", value)}
      />
      <div className="md:col-span-2">
        <span className="text-sm font-medium text-slate-700">
          Auto Generated Display Name
        </span>
        <div className="mt-1 min-h-11 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-semibold text-slate-950">
          {values.product_name || "Select category and enter product details"}
        </div>
        {errors.product_name ? (
          <p className="mt-1 text-xs text-rose-700">{errors.product_name}</p>
        ) : null}
      </div>
      <SelectInput
        label="Unit"
        value={values.unit}
        onChange={(value) =>
          update("unit", value as ProductFormValues["unit"])
        }
        options={[
          { value: "", label: "Select unit" },
          ...productUnitOptions.map((unit) => ({
            value: unit,
            label: unit,
          })),
        ]}
      />
      {errors.unit ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.unit}</p>
      ) : null}
      <TextInput
        label="GST %"
        type="number"
        value={values.gst_percent}
        onChange={(value) => update("gst_percent", value)}
        error={errors.gst_percent}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) =>
          update("status", value as ProductFormValues["status"])
        }
        options={productStatusOptions.map((status) => ({
          value: status,
          label: labelize(status),
        }))}
      />
      <TextArea
        label="Warranty"
        value={values.warranty_description}
        onChange={(value) => update("warranty_description", value)}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

function BrandInput({
  label,
  value,
  onChange,
  options,
  listId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  listId: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
        list={options.length > 0 ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

export function ProductDetailGrid({ product }: { product: Product }) {
  return (
    <>
      <DetailItem label="Product Code" value={product.product_code} />
      <DetailItem label="Display Name" value={product.product_name} />
      <DetailItem label="Category" value={product.category?.name ?? "-"} />
      <DetailItem label="HSN Code" value={product.hsn_code ?? "-"} />
      <DetailItem label="Product Type" value={productTypeName(product)} />
      <DetailItem label="Brand" value={product.brand ?? "-"} />
      <DetailItem label="Model Number" value={product.model_number ?? "-"} />
      <DetailItem
        label="Specifications"
        value={product.specifications ?? "-"}
      />
      <DetailItem label="Unit" value={product.unit} />
      <DetailItem
        label="Status"
        value={<ProductStatusBadge value={product.status} />}
      />
    </>
  );
}

export function ProductPriceFormModal({
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  values: ProductPriceFormValues;
  setValues: (values: ProductPriceFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(key: keyof ProductPriceFormValues, value: string) {
    setValues({ ...values, [key]: value });
  }

  return (
    <Modal
      title="Update Product Pricing"
      onClose={onClose}
      onSubmit={onSubmit}
      noValidate
      submitLabel="Save Pricing"
      submitting={saving}
      maxWidthClass="sm:max-w-xl"
    >
      <TextInput
        label="Purchase Price"
        type="number"
        value={values.current_purchase_price}
        onChange={(value) => update("current_purchase_price", value)}
        error={errors.current_purchase_price}
      />
      <TextInput
        label="Selling Price"
        type="number"
        value={values.current_selling_price}
        onChange={(value) => update("current_selling_price", value)}
        error={errors.current_selling_price}
      />
      <TextInput
        label="GST %"
        type="number"
        value={values.gst_percent}
        onChange={(value) => update("gst_percent", value)}
        error={errors.gst_percent}
      />
      <TextInput
        label="Effective Date"
        type="date"
        value={values.effective_date}
        onChange={(value) => update("effective_date", value)}
        error={errors.effective_date}
      />
    </Modal>
  );
}

export function ProductPricingGrid({ price }: { price: ProductPrice | null }) {
  return (
    <>
      <DetailItem
        label="Purchase Price"
        value={formatProductCurrency(price?.current_purchase_price)}
      />
      <DetailItem
        label="Selling Price"
        value={formatProductCurrency(price?.current_selling_price)}
      />
      <DetailItem label="Pricing GST %" value={`${Number(price?.gst_percent ?? 0)}%`} />
      <DetailItem label="Effective Date" value={price?.effective_date ?? "-"} />
    </>
  );
}

export function ProductPriceHistoryList({
  history,
}: {
  history: ProductPriceHistory[];
}) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No pricing history has been recorded yet.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Changed</th>
              <th className="px-4 py-3">Purchase</th>
              <th className="px-4 py-3">Selling</th>
              <th className="px-4 py-3">GST</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {history.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3">{entry.effective_date ?? "-"}</td>
                <td className="px-4 py-3">
                  {formatProductCurrency(entry.old_purchase_price)} to{" "}
                  {formatProductCurrency(entry.new_purchase_price)}
                </td>
                <td className="px-4 py-3">
                  {formatProductCurrency(entry.old_selling_price)} to{" "}
                  {formatProductCurrency(entry.new_selling_price)}
                </td>
                <td className="px-4 py-3">
                  {Number(entry.old_gst_percent ?? 0)}% to{" "}
                  {Number(entry.new_gst_percent ?? 0)}%
                </td>
                <td className="px-4 py-3">{labelize(entry.source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-3 lg:hidden">
        {history.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-stone-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {entry.effective_date ?? "-"} / {labelize(entry.source)}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-950">
              Purchase {formatProductCurrency(entry.old_purchase_price)} to{" "}
              {formatProductCurrency(entry.new_purchase_price)}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Selling {formatProductCurrency(entry.old_selling_price)} to{" "}
              {formatProductCurrency(entry.new_selling_price)}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
