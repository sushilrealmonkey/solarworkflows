import type {
  SurveyCustomerSummary,
  SurveyLeadSummary,
  SiteSurveyWithRelations,
} from "../site-surveys/types";
import type { BomCalculationType } from "../bom-templates/types";

export type QuotationStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export type QuotationBomStatus =
  | "not_generated"
  | "generated"
  | "edited"
  | "locked";

export type Quotation = {
  id: string;
  organization_id: string;
  quotation_code: string | null;
  customer_id: string | null;
  lead_id: string | null;
  site_survey_id: string | null;
  bom_template_id: string | null;
  bom_status: QuotationBomStatus | null;
  quotation_date: string | null;
  valid_until: string | null;
  system_capacity_kw: number | null;
  installation_location: string | null;
  site_type: string | null;
  expected_annual_generation_kwh: number | null;
  generation_notes: string | null;
  summary_module_brand: string | null;
  summary_module_wattage: number | null;
  summary_plant_size_kw: number | null;
  summary_inverter_brand: string | null;
  summary_dcdb_included: boolean | null;
  summary_acdb_included: boolean | null;
  summary_earthing_count: number | null;
  summary_lightning_arrestor_included: boolean | null;
  summary_remote_monitoring_included: boolean | null;
  summary_total_turnkey_cost: number | null;
  summary_amount_in_words: string | null;
  panel_type: string | null;
  inverter_type: string | null;
  estimated_generation_units: number | null;
  base_amount: number | null;
  gst_amount: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  subsidy_amount: number | null;
  net_payable_amount: number | null;
  payment_terms: string | null;
  terms_and_conditions: string | null;
  status: QuotationStatus | null;
  notes: string | null;
  company_name: string | null;
  company_gstin: string | null;
  company_mobile: string | null;
  tagline: string | null;
  certification_line: string | null;
  quotation_title: string | null;
  system_type: string | null;
  module_category: string | null;
  customer_type: string | null;
  customer_city_village: string | null;
  discom: string | null;
  consumer_number: string | null;
  customer_electricity_bill_url: string | null;
  material_items: QuotationMaterialItem[] | null;
  quotation_detail_snapshot: QuotationDetailSnapshot | null;
  work_description: string | null;
  pricing_total_rate: number | null;
  pricing_tax_included: boolean | null;
  pricing_remarks: string | null;
  maintenance_duration: string | null;
  maintenance_included: boolean | null;
  payment_advance_percentage: number | null;
  payment_installation_percentage: number | null;
  payment_generation_percentage: number | null;
  commercial_price_basis: string | null;
  commercial_gst_terms: string | null;
  commercial_security_deposit_terms: string | null;
  commercial_transit_insurance: string | null;
  commercial_site_storage_insurance: string | null;
  commercial_project_initiation: string | null;
  commercial_warranty_applicability: string | null;
  proposal_important_considerations: string | null;
  proposal_client_responsibilities: string | null;
  proposal_exclusions: string | null;
  proposal_included_scope: string | null;
  bank_company_name: string | null;
  bank_gst_number: string | null;
  bank_name: string | null;
  bank_ifsc_code: string | null;
  bank_account_number: string | null;
  bank_account_type: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

export type QuotationDetailSnapshot = {
  version?: number;
  saved_at?: string;
  form_values?: Partial<QuotationFormValues>;
};

export type QuotationMaterialItem = {
  inventory_item_id: string;
  bom_category_key?: string;
  bom_category_name?: string;
  product_category_id?: string;
  product_id?: string;
  hsn_code?: string;
  description: string;
  brand?: string;
  specification?: string;
  make_specification: string;
  quantity: string;
  unit: string;
};

export type QuotationWarranty = {
  id: string;
  quotation_id: string;
  component: string;
  warranty_text: string;
  sort_order: number | null;
  tenant_id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type QuotationWarrantyFormValues = {
  id?: string;
  component: string;
  warranty_text: string;
};

export type QuotationPaymentTerm = {
  id: string;
  quotation_id: string;
  milestone: string;
  percentage: number | null;
  amount: number | null;
  sort_order: number | null;
  tenant_id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type QuotationPaymentTermFormValues = {
  id?: string;
  milestone: string;
  percentage: string;
  amount: string;
};

export type QuotationItem = {
  id: string;
  organization_id: string;
  quotation_id: string;
  item_type: string | null;
  item_name: string;
  description: string | null;
  section_name: string | null;
  material: string | null;
  specification: string | null;
  make: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  gst_percent: number | null;
  line_total: number | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type QuotationBomItemCategory = {
  id: string;
  name: string;
  category_type: string;
  display_order: number | null;
};

export type QuotationBomItemProduct = {
  id: string;
  product_code: string | null;
  product_name: string;
  brand: string | null;
  model_number: string | null;
  specifications?: string | null;
  unit: string | null;
  category_type?: string | null;
  hsn_code?: string | null;
};

export type QuotationBomItem = {
  id: string;
  tenant_id: string;
  quotation_id: string;
  bom_template_rule_id: string | null;
  product_category_id: string;
  product_id: string | null;
  item_name: string | null;
  calculation_type: BomCalculationType;
  quantity: number;
  required_qty: number | null;
  reserved_qty: number | null;
  issued_qty: number | null;
  unit: string | null;
  is_required: boolean | null;
  manually_modified: boolean | null;
  manual_override: boolean | null;
  is_auto_generated: boolean | null;
  display_order: number;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  category?: QuotationBomItemCategory | null;
  product?: QuotationBomItemProduct | null;
};

export type QuotationInventoryReservationStatus =
  | "active"
  | "partial"
  | "shortage"
  | "released"
  | "converted";

export type QuotationInventoryReservation = {
  id: string;
  company_id: string | null;
  organization_id: string;
  quotation_id: string;
  project_id: string | null;
  quotation_bom_item_id: string | null;
  material_item_index: number | null;
  catalog_product_id: string | null;
  inventory_item_id: string | null;
  required_qty: number;
  reserved_qty: number;
  shortage_qty: number;
  status: QuotationInventoryReservationStatus;
  source_event: string;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  inventory_item?: {
    id: string;
    item_code: string | null;
    item_name: string;
    brand: string | null;
    model: string | null;
    unit: string | null;
    current_stock: number | null;
  } | null;
  catalog_product?: {
    id: string;
    product_code: string | null;
    product_name: string;
    brand: string | null;
    model_number: string | null;
    unit: string | null;
  } | null;
};

export type QuotationBomItemFormValues = {
  product_category_id: string;
  product_id: string;
  quantity: string;
  unit: string;
  notes: string;
};

export type QuotationWithRelations = Quotation & {
  quotation_warranties?: QuotationWarranty[] | null;
  quotation_payment_terms?: QuotationPaymentTerm[] | null;
  customer?: SurveyCustomerSummary | null;
  lead?: SurveyLeadSummary | null;
  site_survey?: SiteSurveyWithRelations | null;
  related_site_survey_id?: string | null;
  project_id?: string | null;
  created_by_profile?: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export type QuotationFormValues = {
  quotation_code: string;
  customer_id: string;
  lead_id: string;
  site_survey_id: string;
  bom_template_id: string;
  quotation_date: string;
  company_name: string;
  company_gstin: string;
  company_mobile: string;
  tagline: string;
  certification_line: string;
  quotation_title: string;
  system_type: string;
  module_category: string;
  customer_type: string;
  customer_city_village: string;
  discom: string;
  consumer_number: string;
  customer_electricity_bill_url: string;
  valid_until: string;
  system_capacity_kw: string;
  installation_location: string;
  site_type: string;
  expected_annual_generation_kwh: string;
  generation_notes: string;
  summary_module_brand: string;
  summary_module_wattage: string;
  summary_plant_size_kw: string;
  summary_inverter_brand: string;
  summary_dcdb_included: string;
  summary_acdb_included: string;
  summary_earthing_count: string;
  summary_lightning_arrestor_included: string;
  summary_remote_monitoring_included: string;
  summary_total_turnkey_cost: string;
  summary_amount_in_words: string;
  panel_type: string;
  inverter_type: string;
  estimated_generation_units: string;
  discount_amount: string;
  subsidy_amount: string;
  material_items: QuotationMaterialItem[];
  warranty_rows: QuotationWarrantyFormValues[];
  work_description: string;
  pricing_total_rate: string;
  pricing_tax_included: boolean;
  pricing_remarks: string;
  maintenance_duration: string;
  maintenance_included: boolean;
  payment_advance_percentage: string;
  payment_installation_percentage: string;
  payment_generation_percentage: string;
  payment_term_rows: QuotationPaymentTermFormValues[];
  commercial_price_basis: string;
  commercial_gst_terms: string;
  commercial_security_deposit_terms: string;
  commercial_transit_insurance: string;
  commercial_site_storage_insurance: string;
  commercial_project_initiation: string;
  commercial_warranty_applicability: string;
  proposal_important_considerations: string;
  proposal_client_responsibilities: string;
  proposal_exclusions: string;
  proposal_included_scope: string;
  bank_company_name: string;
  bank_gst_number: string;
  bank_name: string;
  bank_ifsc_code: string;
  bank_account_number: string;
  bank_account_type: string;
  payment_terms: string;
  terms_and_conditions: string;
  notes: string;
};

export type QuotationItemFormValues = {
  item_type: string;
  item_name: string;
  description: string;
  section_name: string;
  material: string;
  specification: string;
  make: string;
  quantity: string;
  unit: string;
  unit_price: string;
  gst_percent: string;
};
