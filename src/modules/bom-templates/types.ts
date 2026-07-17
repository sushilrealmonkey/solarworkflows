export type BomTemplateType =
  | "residential"
  | "commercial"
  | "industrial"
  | "ground_mount"
  | "agricultural"
  | "custom";

export type BomTemplate = {
  id: string;
  tenant_id: string;
  name: string;
  template_type: BomTemplateType;
  description: string | null;
  is_active: boolean | null;
  display_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

export type BomCalculationType =
  | "fixed_quantity"
  | "per_kw"
  | "panel_count"
  | "inverter_count"
  | "manual";

export type BomTemplateRuleCategory = {
  id: string;
  name: string;
  category_type: string;
  display_order: number;
};

export type BomTemplateRule = {
  id: string;
  tenant_id: string;
  bom_template_id: string;
  product_category_id: string;
  calculation_type: BomCalculationType;
  formula_value: number | null;
  fixed_quantity: number | null;
  unit: string | null;
  display_order: number;
  is_required: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  category?: BomTemplateRuleCategory | null;
};

export type BomTemplateFormValues = {
  display_order: string;
  name: string;
  template_type: BomTemplateType | "";
  description: string;
  is_active: boolean;
};

export type BomTemplateRuleFormValues = {
  display_order: string;
  product_category_id: string;
  calculation_type: BomCalculationType | "";
  formula_value: string;
  fixed_quantity: string;
  is_required: boolean;
};

export type BomTemplateSortKey =
  | "display_order"
  | "name"
  | "template_type"
  | "status"
  | "updated_at";
