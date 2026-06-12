import type { FormEvent } from "react";
import {
  Badge,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import {
  bomTemplateStatusLabel,
  bomTemplateTypeLabel,
  bomTemplateTypeOptions,
  bomCalculationTypeLabel,
  bomCalculationTypeOptions,
} from "./bomTemplateUtils";
import type {
  BomTemplate,
  BomTemplateFormValues,
  BomTemplateRuleFormValues,
} from "./types";
import type { ProductCategory } from "../product-master/types";

export function BomTemplateStatusBadge({
  value,
}: {
  value: boolean | null | undefined;
}) {
  return (
    <Badge tone={value === false ? "red" : "green"}>
      {bomTemplateStatusLabel(value)}
    </Badge>
  );
}

export function BomTemplateTypeBadge({
  value,
}: {
  value: BomTemplate["template_type"];
}) {
  return <Badge tone="blue">{bomTemplateTypeLabel(value)}</Badge>;
}

export function BomTemplateFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: BomTemplateFormValues;
  setValues: (values: BomTemplateFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update(
    key: keyof BomTemplateFormValues,
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
        label="Display Number"
        type="number"
        value={values.display_order}
        onChange={(value) => update("display_order", value)}
        error={errors.display_order}
        required
      />
      <TextInput
        label="Template Name"
        value={values.name}
        onChange={(value) => update("name", value)}
        error={errors.name}
        required
      />
      <SelectInput
        label="Template Type"
        value={values.template_type}
        onChange={(value) => update("template_type", value)}
        options={[
          { value: "", label: "Select template type" },
          ...bomTemplateTypeOptions.map((templateType) => ({
            value: templateType,
            label: bomTemplateTypeLabel(templateType),
          })),
        ]}
      />
      {errors.template_type ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.template_type}</p>
      ) : null}
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
        <input
          checked={values.is_active}
          className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-600"
          onChange={(event) => update("is_active", event.target.checked)}
          type="checkbox"
        />
        <span className="text-sm font-semibold text-slate-700">Active</span>
      </label>
      <TextArea
        label="Description"
        value={values.description}
        onChange={(value) => update("description", value)}
      />
    </Modal>
  );
}

export function BomTemplateRuleFormModal({
  title,
  values,
  setValues,
  categories,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: BomTemplateRuleFormValues;
  setValues: (values: BomTemplateRuleFormValues) => void;
  categories: ProductCategory[];
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const selectableCategories = categories.filter(
    (category) =>
      category.is_active !== false || category.id === values.product_category_id,
  );

  function update(
    key: keyof BomTemplateRuleFormValues,
    value: string | boolean,
  ) {
    const nextValues = { ...values, [key]: value };

    if (key === "calculation_type") {
      if (value === "fixed_quantity") {
        nextValues.formula_value = "";
      } else if (value === "per_kw") {
        nextValues.fixed_quantity = "";
      } else {
        nextValues.formula_value = "";
        nextValues.fixed_quantity = "";
      }
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
      <TextInput
        label="Display Number"
        type="number"
        value={values.display_order}
        onChange={(value) => update("display_order", value)}
        error={errors.display_order}
        required
      />
      <label className="block">
        <span className="text-sm font-medium text-slate-700">
          Material Category<span className="text-rose-600"> *</span>
        </span>
        <select
          className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100 ${
            errors.product_category_id ? "border-rose-300" : "border-stone-200"
          }`}
          value={values.product_category_id}
          onChange={(event) =>
            update("product_category_id", event.target.value)
          }
        >
          <option value="">Select material category</option>
          {selectableCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.product_category_id ? (
          <p className="mt-1 text-xs text-rose-700">
            {errors.product_category_id}
          </p>
        ) : null}
      </label>
      <SelectInput
        label="Calculation Type"
        value={values.calculation_type}
        onChange={(value) => update("calculation_type", value)}
        options={[
          { value: "", label: "Select calculation type" },
          ...bomCalculationTypeOptions.map((calculationType) => ({
            value: calculationType,
            label: bomCalculationTypeLabel(calculationType),
          })),
        ]}
      />
      {errors.calculation_type ? (
        <p className="-mt-3 text-xs text-rose-700">
          {errors.calculation_type}
        </p>
      ) : null}
      {values.calculation_type === "per_kw" ? (
        <div>
          <TextInput
            label="Quantity Formula"
            type="number"
            value={values.formula_value}
            onChange={(value) => update("formula_value", value)}
            error={errors.formula_value}
            required
          />
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Per kW Example: 25 = 25 units per kW
          </p>
        </div>
      ) : null}
      {values.calculation_type === "fixed_quantity" ? (
        <TextInput
          label="Fixed Quantity"
          type="number"
          value={values.fixed_quantity}
          onChange={(value) => update("fixed_quantity", value)}
          error={errors.fixed_quantity}
          required
        />
      ) : null}
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
        <input
          checked={values.is_required}
          className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-600"
          onChange={(event) => update("is_required", event.target.checked)}
          type="checkbox"
        />
        <span className="text-sm font-semibold text-slate-700">Required</span>
      </label>
    </Modal>
  );
}
