import { labelize, requiredError } from "../crm/crmUtils";
import type {
  BomCalculationType,
  BomTemplate,
  BomTemplateFormValues,
  BomTemplateRule,
  BomTemplateRuleFormValues,
  BomTemplateSortKey,
  BomTemplateType,
} from "./types";

export const bomTemplateStatusOptions = ["active", "inactive"] as const;
export const bomCalculationTypeOptions: BomCalculationType[] = [
  "fixed_quantity",
  "per_kw",
  "panel_count",
  "inverter_count",
  "manual",
];
export const bomTemplateTypeOptions: BomTemplateType[] = [
  "residential",
  "commercial",
  "industrial",
  "ground_mount",
  "agricultural",
  "custom",
];

export const bomTemplateSortOptions: Array<{
  value: BomTemplateSortKey;
  label: string;
}> = [
  { value: "display_order", label: "Display Number" },
  { value: "name", label: "Template Name" },
  { value: "template_type", label: "Template Type" },
  { value: "status", label: "Status" },
  { value: "updated_at", label: "Last Updated" },
];

export function emptyBomTemplateForm(
  displayOrder = 1,
): BomTemplateFormValues {
  return {
    display_order: String(displayOrder),
    name: "",
    template_type: "",
    description: "",
    is_active: true,
  };
}

export function emptyBomTemplateRuleForm(
  displayOrder = 1,
): BomTemplateRuleFormValues {
  return {
    display_order: String(displayOrder),
    product_category_id: "",
    calculation_type: "",
    formula_value: "",
    fixed_quantity: "",
    is_required: true,
  };
}

export function bomTemplateToForm(
  template: BomTemplate,
): BomTemplateFormValues {
  return {
    display_order: numberToInput(template.display_order),
    name: template.name ?? "",
    template_type: template.template_type ?? "",
    description: template.description ?? "",
    is_active: template.is_active !== false,
  };
}

export function bomTemplateRuleToForm(
  rule: BomTemplateRule,
): BomTemplateRuleFormValues {
  return {
    display_order: numberToInput(rule.display_order),
    product_category_id: rule.product_category_id ?? "",
    calculation_type: rule.calculation_type ?? "",
    formula_value: numberToOptionalInput(rule.formula_value),
    fixed_quantity: numberToOptionalInput(rule.fixed_quantity),
    is_required: rule.is_required !== false,
  };
}

export function bomTemplateTypeLabel(
  templateType: BomTemplateType | "" | null | undefined,
) {
  return labelize(templateType);
}

export function bomCalculationTypeLabel(
  calculationType: BomCalculationType | "" | null | undefined,
) {
  return labelize(calculationType);
}

export function bomTemplateStatusLabel(isActive: boolean | null | undefined) {
  return isActive === false ? "Inactive" : "Active";
}

export function validateBomTemplateForm(values: BomTemplateFormValues) {
  return {
    display_order: positiveIntegerError(values.display_order, "Display number"),
    name: requiredError(values.name, "Template name"),
    template_type: requiredError(values.template_type, "Template type"),
  };
}

export function validateBomTemplateRuleForm(values: BomTemplateRuleFormValues) {
  const errors = {
    display_order: positiveIntegerError(values.display_order, "Display number"),
    product_category_id: requiredError(
      values.product_category_id,
      "Material category",
    ),
    calculation_type: requiredError(
      values.calculation_type,
      "Calculation type",
    ),
    formula_value: "",
    fixed_quantity: "",
  };

  if (values.calculation_type === "per_kw") {
    errors.formula_value = positiveNumberError(
      values.formula_value,
      "Quantity formula",
    );
  }

  if (values.calculation_type === "fixed_quantity") {
    errors.fixed_quantity = positiveNumberError(
      values.fixed_quantity,
      "Fixed quantity",
    );
  }

  return errors;
}

export function bomTemplateValidationSummary(errors: Record<string, string>) {
  return Object.values(errors)
    .filter(Boolean)
    .map((error) => `- ${error}`)
    .join("\n");
}

export function bomTemplateRuleQuantityLabel(rule: BomTemplateRule) {
  if (rule.calculation_type === "fixed_quantity") {
    return rule.fixed_quantity ? String(rule.fixed_quantity) : "-";
  }

  if (rule.calculation_type === "per_kw") {
    return rule.formula_value ? `${rule.formula_value} per kW` : "-";
  }

  return "-";
}

function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "0" : String(value);
}

function numberToOptionalInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function positiveIntegerError(value: string, label: string) {
  if (!value.trim()) {
    return `${label} is required.`;
  }

  const nextValue = Number(value);

  if (!Number.isInteger(nextValue)) {
    return `${label} must be a whole number.`;
  }

  if (nextValue <= 0) {
    return `${label} must be greater than 0.`;
  }

  return "";
}

function positiveNumberError(value: string, label: string) {
  if (!value.trim()) {
    return `${label} is required.`;
  }

  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return `${label} must be a valid number.`;
  }

  if (nextValue <= 0) {
    return `${label} must be greater than 0.`;
  }

  return "";
}
