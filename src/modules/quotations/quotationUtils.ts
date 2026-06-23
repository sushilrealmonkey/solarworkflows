import {
  formatCustomerAddress,
  formatLeadAddress,
} from "../site-surveys/surveyUtils";
import type {
  SiteSurveyWithRelations,
  SurveyLeadSummary,
} from "../site-surveys/types";
import type {
  QuotationDetailSnapshot,
  QuotationFormValues,
  QuotationItem,
  QuotationItemFormValues,
  QuotationMaterialItem,
  QuotationPaymentTerm,
  QuotationPaymentTermFormValues,
  QuotationStatus,
  QuotationWarranty,
  QuotationWarrantyFormValues,
  QuotationWithRelations,
} from "./types";

export const quotationStatusOptions: QuotationStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
];

export const quotationSystemTypeOptions = [
  "On-grid",
  "Off-grid",
  "Hybrid",
];

export const quotationModuleCategoryOptions = ["DCR", "Non-DCR"];

export const quotationPanelTechnologyOptions = [
  "Monocrystalline",
  "Polycrystalline",
  "TOPCon / N-Type",
  "Bifacial",
];

export const quotationInverterTypeOptions = [
  "On-Grid",
  "Off-Grid",
  "Hybrid",
  "Microinverter",
];

export const quotationItemSectionOptions = [
  "Solar Components",
  "Electrical & Accessories",
  "Civil & Mechanical Work",
  "EPC & DISCOM Charges",
];

export const quotationCustomerTypeOptions = [
  "residential",
  "commercial",
  "industrial",
  "government",
  "other",
];

export const quotationSiteTypeOptions = [
  "RCC Roof",
  "Tin Shed",
  "Ground Mount",
  "Other",
];

export const quotationDiscomOptions = [
  "UGVCL",
  "MGVCL",
  "PGVCL",
  "DGVCL",
  "Torrent Power",
];

export const quotationUnitOptions = [
  "pcs",
  "nos",
  "set",
  "meter",
  "kg",
  "kW",
  "W",
  "sqft",
  "lot",
  "job",
];

export const defaultCertificationLine =
  "Govt. Certified Vendor For Pradhan Mantri Surya Ghar Muft Bijli Yojana";

export const defaultQuotationTerms = [
  "Warranty policies as per respective manufacturer's standard terms.",
  "Water and electricity for installation to be provided by customer.",
  "Any structural or civil modifications required at site will be charged extra.",
].join("\n");

export const defaultCommercialTerms = {
  commercial_price_basis:
    "Price is on turnkey basis for supply, installation, testing, and commissioning of the proposed solar PV system at the project site.",
  commercial_gst_terms:
    "Turnkey project cost is inclusive of GST. GST is calculated by treating 70% of the amount at 5% GST and 30% of the amount at 18% GST, with intra-state breakup shown as equal CGST and SGST.",
  commercial_security_deposit_terms:
    "Security deposit, meter testing fees, net-metering charges, DISCOM application fees, and other statutory charges shall be paid by the customer at actuals unless specifically included in this proposal.",
  commercial_transit_insurance:
    "Transit insurance for supplied material is included up to delivery at the project site. Any unloading or handling damage after delivery shall be the customer's responsibility unless otherwise agreed.",
  commercial_site_storage_insurance:
    "Safe storage space and security for delivered material at site shall be arranged by the customer. Insurance or loss after site delivery shall remain with the customer unless covered separately.",
  commercial_project_initiation:
    "Project work will be initiated after receipt of confirmed purchase order, agreed advance payment, and required technical/commercial approvals.",
  commercial_warranty_applicability:
    "Product warranties shall apply as per respective manufacturer terms. Workmanship warranty applies from commissioning, subject to proper operation, maintenance, and no unauthorized modification.",
} satisfies Pick<
  QuotationFormValues,
  | "commercial_price_basis"
  | "commercial_gst_terms"
  | "commercial_security_deposit_terms"
  | "commercial_transit_insurance"
  | "commercial_site_storage_insurance"
  | "commercial_project_initiation"
  | "commercial_warranty_applicability"
>;

export const defaultProposalScope = {
  proposal_important_considerations: [
    "Generation estimates are indicative and may vary based on site conditions, weather, grid availability, module cleaning, and equipment performance.",
    "Final design, layout, and quantities are subject to detailed site verification and statutory approval requirements.",
  ].join("\n"),
  proposal_client_responsibilities: [
    "Provide safe site access, work permissions, water, electricity, and suitable storage space for project materials.",
    "Provide required documents and approvals for DISCOM, net-metering, subsidy, and statutory processes on time.",
    "Ensure roof or installation area is structurally suitable and free from obstructions before work starts.",
  ].join("\n"),
  proposal_exclusions: [
    "Civil strengthening, roof waterproofing, hidden structural repairs, and major cable route modifications are excluded unless specifically mentioned.",
    "DISCOM charges, government fees, meter charges, statutory deposits, and third-party inspection charges are excluded unless specifically included.",
    "Any work beyond the quoted scope or caused by changes in site condition will be charged separately.",
  ].join("\n"),
  proposal_included_scope: [
    "Design, engineering, supply, installation, testing, and commissioning of the proposed solar PV system.",
    "Supply of solar modules, inverter, mounting structure, electrical protection equipment, cables, earthing, and standard installation accessories as per proposal.",
    "Coordination support for net-metering and project handover documentation.",
  ].join("\n"),
} satisfies Pick<
  QuotationFormValues,
  | "proposal_important_considerations"
  | "proposal_client_responsibilities"
  | "proposal_exclusions"
  | "proposal_included_scope"
>;

export const defaultQuotationMaterials: QuotationMaterialItem[] = [];

export type DerivedQuotationMaterialSummary = {
  summary_module_brand?: string;
  summary_module_wattage?: string;
  summary_inverter_brand?: string;
  summary_structure_type?: string;
  summary_dcdb_included?: boolean;
  summary_acdb_included?: boolean;
  summary_earthing_count?: string;
  summary_lightning_arrestor_included?: boolean;
  summary_remote_monitoring_included?: boolean;
};

export function deriveQuotationMaterialSummary(
  materialItems: QuotationMaterialItem[] | null | undefined,
): DerivedQuotationMaterialSummary {
  const items = (materialItems ?? []).filter(hasMeaningfulMaterialDetails);
  const moduleItem = firstMatchingMaterial(items, [
    "solar pv module",
    "solar module",
    "pv module",
    "module",
    "solar panel",
    "pv panel",
  ]);
  const inverterItem = firstMatchingMaterial(items, ["inverter"]);
  const structureItem = firstMatchingMaterial(items, [
    "mounting structure",
    "structure",
  ]);
  const earthingItem = firstMatchingMaterial(items, ["earthing"]);

  return {
    summary_module_brand: brandFromMaterial(moduleItem),
    summary_module_wattage: moduleItem
      ? wattageFromMaterial(moduleItem)
      : undefined,
    summary_inverter_brand: brandFromMaterial(inverterItem),
    summary_structure_type: structureFromMaterial(structureItem),
    summary_dcdb_included: inferIncluded(items, ["dcdb"]),
    summary_acdb_included: inferIncluded(items, ["acdb"]),
    summary_earthing_count: earthingItem?.quantity?.trim() || undefined,
    summary_lightning_arrestor_included: inferIncluded(items, [
      "lightning arrestor",
      "lightning arrester",
      "la kit",
    ]),
    summary_remote_monitoring_included: inferIncluded(items, [
      "remote monitoring",
      "monitoring",
      "data logger",
      "wifi logger",
      "wi-fi logger",
    ]),
  };
}

export function buildQuotationDetailSnapshot(
  values: QuotationFormValues,
): QuotationDetailSnapshot {
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    form_values: {
      ...values,
      material_items: values.material_items.map((item) => ({ ...item })),
      warranty_rows: values.warranty_rows.map((item) => ({ ...item })),
      payment_term_rows: values.payment_term_rows.map((item) => ({ ...item })),
    },
  };
}

export function quotationSnapshotFormValues(
  quotation: Pick<QuotationWithRelations, "quotation_detail_snapshot">,
): Partial<QuotationFormValues> {
  const formValues = quotation.quotation_detail_snapshot?.form_values;

  if (!formValues || typeof formValues !== "object") {
    return {};
  }

  return formValues;
}

export const defaultQuotationWarranties: QuotationWarrantyFormValues[] = [
  {
    component: "Solar Modules",
    warranty_text:
      "10 years product warranty and 25 years linear generation guarantee",
  },
  {
    component: "Inverter",
    warranty_text: "10 years",
  },
  {
    component: "Structure",
    warranty_text: "5 years",
  },
];

export const defaultTechnicalPaymentTerms: QuotationPaymentTermFormValues[] = [
  {
    milestone: "Mobilization Advance",
    percentage: "65",
    amount: "",
  },
  {
    milestone: "Material Arrival",
    percentage: "25",
    amount: "",
  },
  {
    milestone: "Final Commissioning",
    percentage: "10",
    amount: "",
  },
];

export function emptyQuotationForm(): QuotationFormValues {
  const today = new Date();
  const validUntil = new Date(today);
  const originalDay = today.getDate();
  validUntil.setDate(1);
  validUntil.setMonth(today.getMonth() + 1);
  validUntil.setDate(
    Math.min(
      originalDay,
      new Date(validUntil.getFullYear(), validUntil.getMonth() + 1, 0).getDate(),
    ),
  );

  return {
    quotation_code: "",
    customer_id: "",
    lead_id: "",
    site_survey_id: "",
    bom_template_id: "",
    quotation_date: toDateInput(today),
    company_name: "",
    company_gstin: "",
    company_mobile: "",
    tagline: "",
    certification_line: defaultCertificationLine,
    quotation_title: "",
    system_type: "",
    module_category: "",
    customer_type: "",
    customer_city_village: "",
    discom: "",
    consumer_number: "",
    customer_electricity_bill_url: "",
    valid_until: toDateInput(validUntil),
    system_capacity_kw: "",
    installation_location: "",
    site_type: "",
    expected_annual_generation_kwh: "",
    generation_notes: "",
    summary_module_brand: "",
    summary_module_wattage: "",
    summary_plant_size_kw: "",
    summary_inverter_brand: "",
    summary_structure_type: "",
    summary_dcdb_included: "",
    summary_acdb_included: "",
    summary_earthing_count: "",
    summary_lightning_arrestor_included: "",
    summary_remote_monitoring_included: "",
    summary_total_turnkey_cost: "",
    summary_amount_in_words: "",
    panel_type: "",
    inverter_type: "",
    structure_type: "",
    estimated_generation_units: "",
    discount_amount: "",
    subsidy_amount: "",
    material_items: defaultQuotationMaterials.map((item) => ({ ...item })),
    warranty_rows: defaultQuotationWarranties.map((item) => ({ ...item })),
    work_description:
      "Supply of balance system for on-grid solar power plant\nDesign, engineering, installation and commissioning",
    pricing_total_rate: "",
    pricing_tax_included: true,
    pricing_remarks: "Rates are including all taxes/GST",
    maintenance_duration: "5 years",
    maintenance_included: true,
    payment_advance_percentage: "70",
    payment_installation_percentage: "20",
    payment_generation_percentage: "10",
    payment_term_rows: defaultTechnicalPaymentTerms.map((item) => ({ ...item })),
    ...defaultCommercialTerms,
    ...defaultProposalScope,
    bank_company_name: "",
    bank_gst_number: "",
    bank_name: "",
    bank_ifsc_code: "",
    bank_account_number: "",
    bank_account_type: "",
    payment_terms: "",
    terms_and_conditions: defaultQuotationTerms,
    notes: "",
  };
}

export function quotationToForm(quotation: QuotationWithRelations): QuotationFormValues {
  const snapshotValues = quotationSnapshotFormValues(quotation);
  const materialSummary = deriveQuotationMaterialSummary(
    quotation.material_items && quotation.material_items.length > 0
      ? quotation.material_items
      : snapshotValues.material_items,
  );
  const linkedAddress = quotation.lead
    ? formatLeadAddress(quotation.lead)
    : quotation.customer
      ? formatCustomerAddress(quotation.customer)
      : "";
  const linkedCity = quotation.lead?.city || quotation.customer?.city || "";
  const linkedCustomerType = normalizeQuotationCustomerType(
    quotation.customer?.customer_type,
  );
  const linkedSiteType =
    quotation.site_survey?.structure_type ||
    quotation.lead?.roof_type ||
    quotation.lead?.property_type ||
    "";

  return {
    quotation_code: quotation.quotation_code ?? snapshotValues.quotation_code ?? "",
    customer_id: quotation.customer_id ?? snapshotValues.customer_id ?? "",
    lead_id: quotation.lead_id ?? snapshotValues.lead_id ?? "",
    site_survey_id: quotation.site_survey_id ?? snapshotValues.site_survey_id ?? "",
    bom_template_id:
      quotation.bom_template_id ?? snapshotValues.bom_template_id ?? "",
    quotation_date: quotation.quotation_date ?? snapshotValues.quotation_date ?? "",
    company_name: quotation.company_name ?? snapshotValues.company_name ?? "",
    company_gstin: quotation.company_gstin ?? snapshotValues.company_gstin ?? "",
    company_mobile: quotation.company_mobile ?? snapshotValues.company_mobile ?? "",
    tagline: quotation.tagline ?? snapshotValues.tagline ?? "",
    certification_line:
      quotation.certification_line ??
      snapshotValues.certification_line ??
      defaultCertificationLine,
    quotation_title: quotation.quotation_title ?? snapshotValues.quotation_title ?? "",
    system_type: quotation.system_type ?? snapshotValues.system_type ?? "",
    module_category: quotation.module_category ?? snapshotValues.module_category ?? "",
    customer_type:
      normalizeQuotationCustomerType(quotation.customer_type) ||
      normalizeQuotationCustomerType(snapshotValues.customer_type) ||
      linkedCustomerType ||
      "",
    customer_city_village:
      quotation.customer_city_village ??
      snapshotValues.customer_city_village ??
      linkedCity,
    discom: quotation.discom ?? snapshotValues.discom ?? "",
    consumer_number: quotation.consumer_number ?? snapshotValues.consumer_number ?? "",
    customer_electricity_bill_url:
      quotation.customer_electricity_bill_url ??
      snapshotValues.customer_electricity_bill_url ??
      "",
    valid_until: quotation.valid_until ?? snapshotValues.valid_until ?? "",
    system_capacity_kw:
      numberToInput(quotation.system_capacity_kw) ||
      snapshotValues.system_capacity_kw ||
      "",
    installation_location:
      quotation.installation_location ??
      snapshotValues.installation_location ??
      linkedAddress,
    site_type: quotation.site_type ?? snapshotValues.site_type ?? linkedSiteType,
    expected_annual_generation_kwh: numberToInput(
      quotation.expected_annual_generation_kwh ??
        quotation.estimated_generation_units,
    ) || snapshotValues.expected_annual_generation_kwh || "",
    generation_notes: quotation.generation_notes ?? snapshotValues.generation_notes ?? "",
    summary_module_brand:
      quotation.summary_module_brand ??
      snapshotValues.summary_module_brand ??
      materialSummary.summary_module_brand ??
      "",
    summary_module_wattage:
      numberToInput(quotation.summary_module_wattage) ||
      snapshotValues.summary_module_wattage ||
      materialSummary.summary_module_wattage ||
      "",
    summary_plant_size_kw:
      numberToInput(quotation.summary_plant_size_kw) ||
      snapshotValues.summary_plant_size_kw ||
      numberToInput(quotation.system_capacity_kw) ||
      snapshotValues.system_capacity_kw ||
      "",
    summary_inverter_brand:
      quotation.summary_inverter_brand ??
      snapshotValues.summary_inverter_brand ??
      materialSummary.summary_inverter_brand ??
      "",
    summary_structure_type:
      quotation.summary_structure_type ??
      snapshotValues.summary_structure_type ??
      quotation.structure_type ??
      snapshotValues.structure_type ??
      materialSummary.summary_structure_type ??
      "",
    summary_dcdb_included:
      booleanToInput(quotation.summary_dcdb_included) ||
      snapshotValues.summary_dcdb_included ||
      booleanToInput(materialSummary.summary_dcdb_included) ||
      "",
    summary_acdb_included:
      booleanToInput(quotation.summary_acdb_included) ||
      snapshotValues.summary_acdb_included ||
      booleanToInput(materialSummary.summary_acdb_included) ||
      "",
    summary_earthing_count:
      numberToInput(quotation.summary_earthing_count) ||
      snapshotValues.summary_earthing_count ||
      materialSummary.summary_earthing_count ||
      "",
    summary_lightning_arrestor_included:
      booleanToInput(quotation.summary_lightning_arrestor_included) ||
      snapshotValues.summary_lightning_arrestor_included ||
      booleanToInput(materialSummary.summary_lightning_arrestor_included) ||
      "",
    summary_remote_monitoring_included:
      booleanToInput(quotation.summary_remote_monitoring_included) ||
      snapshotValues.summary_remote_monitoring_included ||
      booleanToInput(materialSummary.summary_remote_monitoring_included) ||
      "",
    summary_total_turnkey_cost:
      numberToInput(quotation.summary_total_turnkey_cost) ||
      snapshotValues.summary_total_turnkey_cost ||
      "",
    summary_amount_in_words:
      quotation.summary_amount_in_words ?? snapshotValues.summary_amount_in_words ?? "",
    panel_type: quotation.panel_type ?? snapshotValues.panel_type ?? "",
    inverter_type: quotation.inverter_type ?? snapshotValues.inverter_type ?? "",
    structure_type: quotation.structure_type ?? snapshotValues.structure_type ?? "",
    estimated_generation_units:
      numberToInput(quotation.estimated_generation_units) ||
      snapshotValues.estimated_generation_units ||
      snapshotValues.expected_annual_generation_kwh ||
      "",
    discount_amount:
      numberToInput(quotation.discount_amount) ||
      snapshotValues.discount_amount ||
      "",
    subsidy_amount:
      numberToInput(quotation.subsidy_amount) ||
      snapshotValues.subsidy_amount ||
      "",
    material_items:
      quotation.material_items && quotation.material_items.length > 0
        ? quotation.material_items.map(normalizeQuotationMaterialItem)
        : snapshotValues.material_items && snapshotValues.material_items.length > 0
          ? snapshotValues.material_items.map(normalizeQuotationMaterialItem)
        : defaultQuotationMaterials.map((item) => ({ ...item })),
    warranty_rows:
      quotation.quotation_warranties && quotation.quotation_warranties.length > 0
        ? quotation.quotation_warranties
            .slice()
            .sort((first, second) => {
              const firstOrder = first.sort_order ?? 0;
              const secondOrder = second.sort_order ?? 0;
              return firstOrder - secondOrder;
            })
            .map(normalizeQuotationWarranty)
        : snapshotValues.warranty_rows && snapshotValues.warranty_rows.length > 0
          ? snapshotValues.warranty_rows.map(normalizeQuotationWarranty)
        : defaultQuotationWarranties.map((item) => ({ ...item })),
    work_description: quotation.work_description ?? snapshotValues.work_description ?? "",
    pricing_total_rate:
      numberToInput(quotation.pricing_total_rate) ||
      snapshotValues.pricing_total_rate ||
      "",
    pricing_tax_included:
      quotation.pricing_tax_included ?? snapshotValues.pricing_tax_included ?? true,
    pricing_remarks: quotation.pricing_remarks ?? snapshotValues.pricing_remarks ?? "",
    maintenance_duration:
      quotation.maintenance_duration ?? snapshotValues.maintenance_duration ?? "",
    maintenance_included:
      quotation.maintenance_included ?? snapshotValues.maintenance_included ?? true,
    payment_advance_percentage:
      numberToInput(quotation.payment_advance_percentage) ||
      snapshotValues.payment_advance_percentage ||
      "70",
    payment_installation_percentage:
      numberToInput(quotation.payment_installation_percentage) ||
      snapshotValues.payment_installation_percentage ||
      "20",
    payment_generation_percentage:
      numberToInput(quotation.payment_generation_percentage) ||
      snapshotValues.payment_generation_percentage ||
      "10",
    payment_term_rows:
      quotation.quotation_payment_terms && quotation.quotation_payment_terms.length > 0
        ? quotation.quotation_payment_terms
            .slice()
            .sort((first, second) => {
              const firstOrder = first.sort_order ?? 0;
              const secondOrder = second.sort_order ?? 0;
              return firstOrder - secondOrder;
            })
            .map(normalizeQuotationPaymentTerm)
        : snapshotValues.payment_term_rows && snapshotValues.payment_term_rows.length > 0
          ? snapshotValues.payment_term_rows.map((item) => ({ ...item }))
        : defaultTechnicalPaymentTerms.map((item) => ({ ...item })),
    commercial_price_basis:
      quotation.commercial_price_basis ??
      snapshotValues.commercial_price_basis ??
      defaultCommercialTerms.commercial_price_basis,
    commercial_gst_terms:
      quotation.commercial_gst_terms ??
      snapshotValues.commercial_gst_terms ??
      defaultCommercialTerms.commercial_gst_terms,
    commercial_security_deposit_terms:
      quotation.commercial_security_deposit_terms ??
      snapshotValues.commercial_security_deposit_terms ??
      defaultCommercialTerms.commercial_security_deposit_terms,
    commercial_transit_insurance:
      quotation.commercial_transit_insurance ??
      snapshotValues.commercial_transit_insurance ??
      defaultCommercialTerms.commercial_transit_insurance,
    commercial_site_storage_insurance:
      quotation.commercial_site_storage_insurance ??
      snapshotValues.commercial_site_storage_insurance ??
      defaultCommercialTerms.commercial_site_storage_insurance,
    commercial_project_initiation:
      quotation.commercial_project_initiation ??
      snapshotValues.commercial_project_initiation ??
      defaultCommercialTerms.commercial_project_initiation,
    commercial_warranty_applicability:
      quotation.commercial_warranty_applicability ??
      snapshotValues.commercial_warranty_applicability ??
      defaultCommercialTerms.commercial_warranty_applicability,
    proposal_important_considerations:
      quotation.proposal_important_considerations ??
      snapshotValues.proposal_important_considerations ??
      defaultProposalScope.proposal_important_considerations,
    proposal_client_responsibilities:
      quotation.proposal_client_responsibilities ??
      snapshotValues.proposal_client_responsibilities ??
      defaultProposalScope.proposal_client_responsibilities,
    proposal_exclusions:
      quotation.proposal_exclusions ??
      snapshotValues.proposal_exclusions ??
      defaultProposalScope.proposal_exclusions,
    proposal_included_scope:
      quotation.proposal_included_scope ??
      snapshotValues.proposal_included_scope ??
      defaultProposalScope.proposal_included_scope,
    bank_company_name:
      quotation.bank_company_name ?? snapshotValues.bank_company_name ?? "",
    bank_gst_number: quotation.bank_gst_number ?? snapshotValues.bank_gst_number ?? "",
    bank_name: quotation.bank_name ?? snapshotValues.bank_name ?? "",
    bank_ifsc_code: quotation.bank_ifsc_code ?? snapshotValues.bank_ifsc_code ?? "",
    bank_account_number:
      quotation.bank_account_number ?? snapshotValues.bank_account_number ?? "",
    bank_account_type:
      quotation.bank_account_type ?? snapshotValues.bank_account_type ?? "",
    payment_terms: quotation.payment_terms ?? snapshotValues.payment_terms ?? "",
    terms_and_conditions:
      quotation.terms_and_conditions ??
      snapshotValues.terms_and_conditions ??
      defaultQuotationTerms,
    notes: quotation.notes ?? snapshotValues.notes ?? "",
  };
}

export function surveyToQuotationForm(
  survey: SiteSurveyWithRelations,
): QuotationFormValues {
  const values = survey.lead
    ? leadToQuotationForm(survey.lead)
    : emptyQuotationForm();
  values.customer_id =
    survey.customer_id ??
    survey.lead?.converted_customer_id ??
    survey.lead?.customer_id ??
    "";
  values.lead_id = survey.lead_id ?? "";
  values.site_survey_id = survey.id;
  values.customer_type =
    normalizeQuotationCustomerType(survey.customer?.customer_type) ||
    values.customer_type;
  values.system_capacity_kw =
    numberToInput(survey.recommended_capacity_kw) || values.system_capacity_kw;
  values.expected_annual_generation_kwh =
    calculateExpectedAnnualGenerationInput(values.system_capacity_kw);
  values.estimated_generation_units = values.expected_annual_generation_kwh;
  values.summary_plant_size_kw =
    values.summary_plant_size_kw || values.system_capacity_kw;
  values.customer_city_village =
    values.customer_city_village || survey.lead?.city || survey.customer?.city || "";
  values.quotation_title = buildQuotationTitle(
    values.system_capacity_kw,
    values.module_category,
    values.customer_type,
  );
  values.structure_type = survey.structure_type ?? values.structure_type;
  values.summary_structure_type =
    values.summary_structure_type || values.structure_type;
  values.installation_location =
    values.installation_location ||
    (survey.lead
      ? formatLeadAddress(survey.lead)
      : survey.customer
        ? formatCustomerAddress(survey.customer)
        : "");
  return values;
}

export function leadToQuotationForm(lead: SurveyLeadSummary): QuotationFormValues {
  const values = emptyQuotationForm();
  values.customer_id = lead.converted_customer_id ?? lead.customer_id ?? "";
  values.lead_id = lead.id;
  values.system_capacity_kw = numberToInput(lead.estimated_load_kw);
  values.expected_annual_generation_kwh =
    calculateExpectedAnnualGenerationInput(values.system_capacity_kw);
  values.estimated_generation_units = values.expected_annual_generation_kwh;
  values.summary_total_turnkey_cost = numberToInput(lead.offered_price);
  values.pricing_total_rate = values.summary_total_turnkey_cost;
  values.summary_plant_size_kw = values.system_capacity_kw;
  values.customer_city_village = lead.city ?? "";
  values.customer_type = customerTypeFromLead(lead) || values.customer_type;
  values.site_type = lead.roof_type ?? lead.property_type ?? "";
  values.system_type =
    systemTypeFromLeadRequirement(lead.requirement_type) || values.system_type;
  values.quotation_title = buildQuotationTitle(
    values.system_capacity_kw,
    values.module_category,
    values.customer_type,
  );
  values.structure_type = lead.roof_type ?? "";
  values.summary_structure_type = lead.roof_type ?? "";
  values.installation_location = formatLeadAddress(lead);
  return values;
}

export function applySurveyToQuotationForm(
  values: QuotationFormValues,
  survey: SiteSurveyWithRelations,
): QuotationFormValues {
  const leadValues = survey.lead ? leadToQuotationForm(survey.lead) : null;
  const baseValues = leadValues
    ? {
        ...values,
        customer_id: leadValues.customer_id || values.customer_id,
        lead_id: leadValues.lead_id || values.lead_id,
        system_capacity_kw: leadValues.system_capacity_kw || values.system_capacity_kw,
        summary_total_turnkey_cost:
          leadValues.summary_total_turnkey_cost ||
          values.summary_total_turnkey_cost,
        pricing_total_rate:
          leadValues.pricing_total_rate || values.pricing_total_rate,
        summary_plant_size_kw:
          leadValues.summary_plant_size_kw || values.summary_plant_size_kw,
        system_type: leadValues.system_type || values.system_type,
        customer_type: leadValues.customer_type || values.customer_type,
        customer_city_village:
          leadValues.customer_city_village || values.customer_city_village,
        site_type: leadValues.site_type || values.site_type,
        structure_type: leadValues.structure_type || values.structure_type,
        summary_structure_type:
          leadValues.summary_structure_type || values.summary_structure_type,
        installation_location:
          leadValues.installation_location || values.installation_location,
      }
    : values;
  const systemCapacity =
    survey.recommended_capacity_kw === null ||
    survey.recommended_capacity_kw === undefined
      ? baseValues.system_capacity_kw
      : String(survey.recommended_capacity_kw);
  const expectedGeneration =
    calculateExpectedAnnualGenerationInput(systemCapacity);

  return {
    ...baseValues,
    site_survey_id: survey.id,
    customer_id:
      survey.customer_id ??
      survey.lead?.converted_customer_id ??
      survey.lead?.customer_id ??
      baseValues.customer_id,
    lead_id: survey.lead_id ?? baseValues.lead_id,
    customer_type:
      normalizeQuotationCustomerType(survey.customer?.customer_type) ||
      baseValues.customer_type,
    system_capacity_kw: systemCapacity,
    expected_annual_generation_kwh: expectedGeneration,
    estimated_generation_units: expectedGeneration,
    quotation_title: buildQuotationTitle(
      systemCapacity,
      baseValues.module_category,
      normalizeQuotationCustomerType(survey.customer?.customer_type) ||
        baseValues.customer_type,
    ),
    customer_city_village:
      baseValues.customer_city_village ||
      survey.lead?.city ||
      survey.customer?.city ||
      values.customer_city_village,
    structure_type: survey.structure_type || baseValues.structure_type,
    summary_structure_type:
      baseValues.summary_structure_type || survey.structure_type || "",
    installation_location:
      baseValues.installation_location ||
      (survey.lead
        ? formatLeadAddress(survey.lead)
        : survey.customer
          ? formatCustomerAddress(survey.customer)
          : values.installation_location),
  };
}

function systemTypeFromLeadRequirement(value: string | null | undefined) {
  const normalized = (value ?? "").toLowerCase();

  if (normalized.includes("hybrid")) {
    return "Hybrid";
  }

  if (normalized.includes("off")) {
    return "Off-grid";
  }

  if (normalized.includes("on")) {
    return "On-grid";
  }

  return "";
}

export function normalizeQuotationCustomerType(
  value: string | null | undefined,
) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (!normalized) {
    return "";
  }

  if (normalized.includes("industrial") || normalized.includes("factory")) {
    return "industrial";
  }

  if (normalized.includes("government")) {
    return "government";
  }

  if (
    normalized.includes("commercial") ||
    normalized.includes("shop") ||
    normalized.includes("office") ||
    normalized.includes("school") ||
    normalized.includes("hospital") ||
    normalized.includes("warehouse")
  ) {
    return "commercial";
  }

  if (
    normalized.includes("residential") ||
    normalized.includes("house") ||
    normalized.includes("home") ||
    normalized.includes("apartment")
  ) {
    return "residential";
  }

  if (normalized.includes("other")) {
    return "other";
  }

  return "";
}

function customerTypeFromLead(lead: SurveyLeadSummary) {
  return (
    normalizeQuotationCustomerType(lead.requirement_type) ||
    normalizeQuotationCustomerType(lead.property_type)
  );
}

function normalizeQuotationMaterialItem(
  item: Partial<QuotationMaterialItem>,
): QuotationMaterialItem {
  return {
    inventory_item_id: item.inventory_item_id ?? "",
    product_category_id: item.product_category_id ?? "",
    product_id: item.product_id ?? "",
    hsn_code: item.hsn_code ?? "",
    description: item.description ?? "",
    brand: item.brand ?? "",
    specification: item.specification ?? item.make_specification ?? "",
    make_specification: item.make_specification ?? "",
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
  };
}

function normalizeQuotationWarranty(
  warranty: Partial<QuotationWarranty>,
): QuotationWarrantyFormValues {
  return {
    id: warranty.id,
    component: warranty.component ?? "",
    warranty_text: warranty.warranty_text ?? "",
  };
}

function normalizeQuotationPaymentTerm(
  paymentTerm: Partial<QuotationPaymentTerm>,
): QuotationPaymentTermFormValues {
  return {
    id: paymentTerm.id,
    milestone: paymentTerm.milestone ?? "",
    percentage: numberToInput(paymentTerm.percentage),
    amount: numberToInput(paymentTerm.amount),
  };
}

export function buildQuotationTitle(
  capacity: string,
  moduleCategory: string,
  customerType = "",
) {
  const capacityText = quotationTitleCapacity(capacity);
  const parts = [
    capacityText,
    titleCaseQuotationValue(moduleCategory),
    titleCaseQuotationValue(customerType),
    "Solar System",
  ].filter(Boolean);
  return parts.length > 1 ? `Quotation For ${parts.join(" ")}` : "";
}

export function calculateExpectedAnnualGenerationInput(capacity: string) {
  const systemCapacity = Number(capacity);

  if (!capacity.trim() || !Number.isFinite(systemCapacity) || systemCapacity < 0) {
    return "";
  }

  return String(Math.round(systemCapacity * 4 * 365 * 100) / 100);
}

function quotationTitleCapacity(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const withoutUnit = normalized.replace(/\s*kW$/i, "").trim();
  return withoutUnit ? `${withoutUnit} kW` : "";
}

function titleCaseQuotationValue(value: string) {
  const normalized = value
    .trim()
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (["non-dcr", "non dcr"].includes(normalized.toLowerCase())) {
    return "Non-DCR";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["dcr", "rcc", "ac", "dc", "gst", "pv"].includes(lower)) {
        return lower.toUpperCase();
      }

      return lower
        .split("-")
        .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
        .join("-");
    })
    .join(" ");
}

export function emptyQuotationItemForm(): QuotationItemFormValues {
  return {
    item_type: "",
    item_name: "",
    description: "",
    section_name: quotationItemSectionOptions[0],
    material: "",
    specification: "",
    make: "",
    quantity: "1",
    unit: "",
    unit_price: "",
    gst_percent: "0",
  };
}

export function quotationItemToForm(
  item: QuotationItem,
): QuotationItemFormValues {
  return {
    item_type: item.item_type ?? "",
    item_name: item.item_name ?? "",
    description: item.description ?? "",
    section_name: item.section_name ?? "",
    material: item.material ?? "",
    specification: item.specification ?? "",
    make: item.make ?? "",
    quantity: numberToInput(item.quantity) || "1",
    unit: item.unit ?? "",
    unit_price: numberToInput(item.unit_price),
    gst_percent: numberToInput(item.gst_percent) || "0",
  };
}

export function numberToInput(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function hasMeaningfulMaterialDetails(item: QuotationMaterialItem) {
  return [
    item.brand,
    item.specification,
    item.make_specification,
    item.quantity,
    item.unit,
  ].some((value) => Boolean(value?.trim()));
}

function firstMatchingMaterial(
  items: QuotationMaterialItem[],
  terms: string[],
) {
  return items.find((item) => materialMatches(item, terms));
}

function materialMatches(item: QuotationMaterialItem, terms: string[]) {
  const haystack = normalizeSummaryText(
    [
      item.description,
      item.brand,
      item.specification,
      item.make_specification,
    ].join(" "),
  );

  return terms.some((term) => haystack.includes(normalizeSummaryText(term)));
}

function brandFromMaterial(item: QuotationMaterialItem | undefined) {
  const brand = item?.brand?.trim();
  if (brand) {
    return brand;
  }

  const makeSpecification = item?.make_specification?.trim();
  if (!makeSpecification?.includes("/")) {
    return undefined;
  }

  const [firstPart] = makeSpecification.split("/");
  const inferredBrand = firstPart.trim();

  return wattageFromText(inferredBrand) ? undefined : inferredBrand || undefined;
}

function structureFromMaterial(item: QuotationMaterialItem | undefined) {
  return (
    item?.specification?.trim() ||
    item?.make_specification?.trim() ||
    undefined
  );
}

function wattageFromMaterial(item: QuotationMaterialItem) {
  return wattageFromText(
    [item.specification, item.make_specification, item.description].join(" "),
  );
}

function wattageFromText(value: string | undefined) {
  const match = value?.match(/(\d+(?:\.\d+)?)\s*(?:wp|watt(?:s)?|w)\b/i);
  return match?.[1];
}

function inferIncluded(items: QuotationMaterialItem[], terms: string[]) {
  return items.some((item) => materialMatches(item, terms)) ? true : undefined;
}

function normalizeSummaryText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function booleanToInput(value: boolean | null | undefined) {
  if (value === true) {
    return "yes";
  }

  if (value === false) {
    return "no";
  }

  return "";
}

export function formatYesNo(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "-";
}

export function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatMoneyWithPaise(value: number | null | undefined) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type TurnkeyGstBreakdown = {
  inclusiveAmount: number;
  solarInclusiveAmount: number;
  solarGstAmount: number;
  serviceInclusiveAmount: number;
  serviceGstAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  taxableAmount: number;
};

export type DiscountedTurnkeyTotals = {
  baseAmount: number;
  discountAmount: number;
  taxableAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
};

export function calculateTurnkeyGstBreakdown(
  inclusiveAmount: number | null | undefined,
): TurnkeyGstBreakdown {
  const amount = Math.max(Number(inclusiveAmount ?? 0), 0);
  const solarInclusiveAmount = roundMoney(amount * 0.7);
  const serviceInclusiveAmount = roundMoney(amount * 0.3);
  const solarGstAmount = roundMoney(solarInclusiveAmount * 5 / 105);
  const serviceGstAmount = roundMoney(serviceInclusiveAmount * 18 / 118);
  const gstAmount = roundMoney(solarGstAmount + serviceGstAmount);
  const cgstAmount = roundMoney(gstAmount / 2);
  const sgstAmount = roundMoney(gstAmount - cgstAmount);

  return {
    inclusiveAmount: roundMoney(amount),
    solarInclusiveAmount,
    solarGstAmount,
    serviceInclusiveAmount,
    serviceGstAmount,
    gstAmount,
    cgstAmount,
    sgstAmount,
    taxableAmount: roundMoney(amount - gstAmount),
  };
}

export function calculateDiscountedTurnkeyTotals(
  inclusiveAmount: number | null | undefined,
  discountAmount: number | null | undefined,
): DiscountedTurnkeyTotals {
  const breakdown = calculateTurnkeyGstBreakdown(inclusiveAmount);
  const discount = Math.min(
    Math.max(Number(discountAmount ?? 0), 0),
    breakdown.taxableAmount,
  );
  const taxableAmount = roundMoney(breakdown.taxableAmount - discount);
  const taxFactor =
    breakdown.taxableAmount > 0 ? taxableAmount / breakdown.taxableAmount : 0;
  const gstAmount = roundMoney(breakdown.gstAmount * taxFactor);
  const cgstAmount = roundMoney(gstAmount / 2);

  return {
    baseAmount: breakdown.taxableAmount,
    discountAmount: roundMoney(discount),
    taxableAmount,
    gstAmount,
    cgstAmount,
    sgstAmount: roundMoney(gstAmount - cgstAmount),
    totalAmount: roundMoney(taxableAmount + gstAmount),
  };
}

export function hasTurnkeyGstAmount(value: number | string | null | undefined) {
  const amount =
    typeof value === "string" && value.trim() === "" ? 0 : Number(value ?? 0);

  return Number.isFinite(amount) && amount > 0;
}

export function formatKw(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value} kW`;
}

export function lineGstAmount(item: QuotationItem) {
  return Number(item.line_total ?? 0) * Number(item.gst_percent ?? 0) / 100;
}

export function lineGrossAmount(item: QuotationItem) {
  return Number(item.line_total ?? 0) + lineGstAmount(item);
}

export function quotationItemMaterial(item: QuotationItem) {
  return item.material || item.item_name || "-";
}

export function quotationItemSpecification(item: QuotationItem) {
  return item.specification || item.description || "-";
}

export function quotationItemSection(item: QuotationItem) {
  return item.section_name || "Unsectioned";
}

export function getQuotationContact(quotation: QuotationWithRelations) {
  const customerAddress = quotation.customer
    ? formatCustomerAddress(quotation.customer)
    : quotation.lead
      ? formatLeadAddress(quotation.lead)
      : "";

  return {
    customerName: quotation.customer?.full_name ?? quotation.lead?.full_name ?? "-",
    leadName: quotation.lead?.full_name ?? "-",
    phone: quotation.customer?.phone ?? quotation.lead?.phone ?? "-",
    address: quotation.installation_location || customerAddress,
  };
}

export function quotationStatusTone(value: string | null | undefined) {
  if (value === "accepted") {
    return "green" as const;
  }

  if (value === "rejected" || value === "cancelled" || value === "expired") {
    return "red" as const;
  }

  if (value === "sent") {
    return "blue" as const;
  }

  return "neutral" as const;
}

function toDateInput(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
