import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "../site-surveys/types";
import type {
  Quotation,
  QuotationBomItem,
  QuotationBomItemFormValues,
  QuotationFormValues,
  QuotationInventoryReservation,
  QuotationItem,
  QuotationItemFormValues,
  QuotationPaymentTerm,
  QuotationPaymentTermFormValues,
  QuotationWarranty,
  QuotationWarrantyFormValues,
  QuotationWithRelations,
} from "./types";
import {
  buildQuotationDetailSnapshot,
  calculateTurnkeyGstBreakdown,
  deriveQuotationMaterialSummary,
  hasTurnkeyGstAmount,
  normalizeQuotationCustomerType,
} from "./quotationUtils";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireOrganization(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function nullableBoolean(value: string) {
  if (value === "yes") {
    return true;
  }

  if (value === "no") {
    return false;
  }

  return null;
}

async function customerBelongsToOrganization(
  customerId: string,
  organizationId: string,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

async function resolveLinkedCustomerId(
  values: QuotationFormValues,
  organizationId: string,
) {
  const client = requireSupabase();
  const siteSurveyId = values.site_survey_id.trim();
  let leadId = values.lead_id.trim();

  if (siteSurveyId) {
    const { data, error } = await client
      .from("site_surveys")
      .select("customer_id, lead_id")
      .eq("id", siteSurveyId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const surveyCustomerId =
      typeof data?.customer_id === "string" ? data.customer_id : "";
    if (
      surveyCustomerId &&
      (await customerBelongsToOrganization(surveyCustomerId, organizationId))
    ) {
      return surveyCustomerId;
    }

    leadId = typeof data?.lead_id === "string" ? data.lead_id : leadId;
  }

  if (!leadId) {
    return "";
  }

  const { data, error } = await client
    .from("leads")
    .select("customer_id, converted_customer_id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const leadCustomerId =
    typeof data?.converted_customer_id === "string"
      ? data.converted_customer_id
      : typeof data?.customer_id === "string"
        ? data.customer_id
        : "";

  if (
    leadCustomerId &&
    (await customerBelongsToOrganization(leadCustomerId, organizationId))
  ) {
    return leadCustomerId;
  }

  return "";
}

async function normalizeQuotationLinks(
  profile: UserProfile | null,
  values: QuotationFormValues,
) {
  const customerId = values.customer_id.trim();
  const hasLinkedSource = Boolean(
    values.lead_id.trim() || values.site_survey_id.trim(),
  );
  const organizationId = requireOrganization(profile);

  if (!customerId) {
    if (!hasLinkedSource) {
      return values;
    }

    const linkedCustomerId = await resolveLinkedCustomerId(values, organizationId);
    return linkedCustomerId ? { ...values, customer_id: linkedCustomerId } : values;
  }

  if (await customerBelongsToOrganization(customerId, organizationId)) {
    return values;
  }

  if (hasLinkedSource) {
    const linkedCustomerId = await resolveLinkedCustomerId(values, organizationId);
    return { ...values, customer_id: linkedCustomerId };
  }

  throw new Error(
    "Selected customer is not available in your organization. Choose a customer from this organization or link a lead/site survey.",
  );
}

function quotationPayload(values: QuotationFormValues) {
  const materialSummary = deriveQuotationMaterialSummary(values.material_items);
  const inclusiveTurnkeyAmount =
    nullableNumber(values.summary_total_turnkey_cost) ??
    nullableNumber(values.pricing_total_rate);
  const discountAmount = nullableNumber(values.discount_amount) ?? 0;
  const subsidyAmount = nullableNumber(values.subsidy_amount) ?? 0;
  const turnkeyGst = hasTurnkeyGstAmount(inclusiveTurnkeyAmount)
    ? calculateTurnkeyGstBreakdown(inclusiveTurnkeyAmount)
    : null;
  const totalAmount = turnkeyGst
    ? Math.max(turnkeyGst.inclusiveAmount - discountAmount, 0)
    : null;
  const summaryStructureType =
    values.summary_structure_type ||
    values.structure_type ||
    materialSummary.summary_structure_type ||
    "";
  const summaryDcdbIncluded =
    nullableBoolean(values.summary_dcdb_included) ??
    materialSummary.summary_dcdb_included ??
    null;
  const summaryAcdbIncluded =
    nullableBoolean(values.summary_acdb_included) ??
    materialSummary.summary_acdb_included ??
    null;
  const summaryLightningArrestorIncluded =
    nullableBoolean(values.summary_lightning_arrestor_included) ??
    materialSummary.summary_lightning_arrestor_included ??
    null;
  const summaryRemoteMonitoringIncluded =
    nullableBoolean(values.summary_remote_monitoring_included) ??
    materialSummary.summary_remote_monitoring_included ??
    null;

  return {
    quotation_code: nullable(values.quotation_code),
    customer_id: nullable(values.customer_id),
    lead_id: nullable(values.lead_id),
    site_survey_id: nullable(values.site_survey_id),
    bom_template_id: null,
    quotation_date: nullable(values.quotation_date),
    company_name: null,
    company_gstin: null,
    company_mobile: null,
    tagline: null,
    certification_line: null,
    quotation_title: nullable(values.quotation_title),
    system_type: nullable(values.system_type),
    module_category: nullable(values.module_category),
    customer_type: nullable(
      normalizeQuotationCustomerType(values.customer_type) || values.customer_type,
    ),
    customer_city_village: nullable(values.customer_city_village),
    discom: nullable(values.discom),
    consumer_number: null,
    customer_electricity_bill_url: null,
    quotation_detail_snapshot: buildQuotationDetailSnapshot(values),
    valid_until: nullable(values.valid_until),
    system_capacity_kw: nullableNumber(values.system_capacity_kw),
    installation_location: nullable(values.installation_location),
    site_type: nullable(values.site_type),
    expected_annual_generation_kwh: nullableNumber(
      values.expected_annual_generation_kwh,
    ),
    generation_notes: nullable(values.generation_notes),
    summary_module_brand: nullable(
      values.summary_module_brand || materialSummary.summary_module_brand || "",
    ),
    summary_module_wattage: nullableNumber(
      values.summary_module_wattage ||
        materialSummary.summary_module_wattage ||
        "",
    ),
    summary_plant_size_kw: nullableNumber(values.summary_plant_size_kw),
    summary_inverter_brand: nullable(
      values.summary_inverter_brand ||
        materialSummary.summary_inverter_brand ||
        "",
    ),
    summary_structure_type: nullable(summaryStructureType),
    summary_dcdb_included: summaryDcdbIncluded,
    summary_acdb_included: summaryAcdbIncluded,
    summary_earthing_count: nullableNumber(
      values.summary_earthing_count ||
        materialSummary.summary_earthing_count ||
        "",
    ),
    summary_lightning_arrestor_included: summaryLightningArrestorIncluded,
    summary_remote_monitoring_included: summaryRemoteMonitoringIncluded,
    summary_total_turnkey_cost: nullableNumber(values.summary_total_turnkey_cost),
    summary_amount_in_words: nullable(values.summary_amount_in_words),
    panel_type: nullable(values.panel_type),
    inverter_type: nullable(values.inverter_type),
    structure_type: nullable(values.structure_type || summaryStructureType),
    estimated_generation_units:
      nullableNumber(values.estimated_generation_units) ??
      nullableNumber(values.expected_annual_generation_kwh),
    base_amount: turnkeyGst?.taxableAmount,
    gst_amount: turnkeyGst?.gstAmount,
    discount_amount: discountAmount,
    total_amount: totalAmount,
    subsidy_amount: subsidyAmount,
    net_payable_amount:
      totalAmount === null ? null : Math.max(totalAmount - subsidyAmount, 0),
    material_items: values.material_items,
    work_description: nullable(values.work_description),
    pricing_total_rate: nullableNumber(values.pricing_total_rate),
    pricing_tax_included: values.pricing_tax_included,
    pricing_remarks: nullable(values.pricing_remarks),
    maintenance_duration: nullable(values.maintenance_duration),
    maintenance_included: values.maintenance_included,
    payment_advance_percentage:
      nullableNumber(values.payment_advance_percentage) ?? 70,
    payment_installation_percentage:
      nullableNumber(values.payment_installation_percentage) ?? 20,
    payment_generation_percentage:
      nullableNumber(values.payment_generation_percentage) ?? 10,
    commercial_price_basis: nullable(values.commercial_price_basis),
    commercial_gst_terms: nullable(values.commercial_gst_terms),
    commercial_security_deposit_terms: nullable(
      values.commercial_security_deposit_terms,
    ),
    commercial_transit_insurance: nullable(values.commercial_transit_insurance),
    commercial_site_storage_insurance: nullable(
      values.commercial_site_storage_insurance,
    ),
    commercial_project_initiation: nullable(values.commercial_project_initiation),
    commercial_warranty_applicability: nullable(
      values.commercial_warranty_applicability,
    ),
    proposal_important_considerations: nullable(
      values.proposal_important_considerations,
    ),
    proposal_client_responsibilities: nullable(
      values.proposal_client_responsibilities,
    ),
    proposal_exclusions: nullable(values.proposal_exclusions),
    proposal_included_scope: nullable(values.proposal_included_scope),
    bank_company_name: nullable(values.bank_company_name),
    bank_gst_number: nullable(values.bank_gst_number),
    bank_name: nullable(values.bank_name),
    bank_ifsc_code: nullable(values.bank_ifsc_code),
    bank_account_number: nullable(values.bank_account_number),
    bank_account_type: nullable(values.bank_account_type),
    payment_terms: nullable(values.payment_terms),
    terms_and_conditions: nullable(values.terms_and_conditions),
    notes: nullable(values.notes),
  };
}

function missingSchemaColumn(message: string) {
  const match = message.match(
    /Could not find the '([^']+)' column of 'quotations' in the schema cache/,
  );

  return match?.[1] ?? "";
}

const requiredQuotationStorageColumns = new Set([
  "quotation_detail_snapshot",
  "installation_location",
  "site_type",
  "expected_annual_generation_kwh",
  "generation_notes",
  "summary_module_brand",
  "summary_module_wattage",
  "summary_plant_size_kw",
  "summary_inverter_brand",
  "summary_structure_type",
  "summary_dcdb_included",
  "summary_acdb_included",
  "summary_earthing_count",
  "summary_lightning_arrestor_included",
  "summary_remote_monitoring_included",
  "summary_total_turnkey_cost",
  "summary_amount_in_words",
  "material_items",
  "work_description",
  "pricing_total_rate",
  "pricing_tax_included",
  "pricing_remarks",
  "maintenance_duration",
  "maintenance_included",
  "payment_advance_percentage",
  "payment_installation_percentage",
  "payment_generation_percentage",
  "commercial_price_basis",
  "commercial_gst_terms",
  "commercial_security_deposit_terms",
  "commercial_transit_insurance",
  "commercial_site_storage_insurance",
  "commercial_project_initiation",
  "commercial_warranty_applicability",
  "proposal_important_considerations",
  "proposal_client_responsibilities",
  "proposal_exclusions",
  "proposal_included_scope",
]);

function missingRequiredQuotationColumnMessage(column: string) {
  return `Quotation save failed because the database is missing the "${column}" storage column. Apply the latest Supabase migrations, then save the quotation again.`;
}

function isMissingOptionalQuotationStorage(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("schema cache") ||
    normalized.includes("quotation_warranties") ||
    normalized.includes("quotation_payment_terms")
  ) && (
    normalized.includes("could not find") ||
    normalized.includes("does not exist") ||
    normalized.includes("not found")
  );
}

function isMissingOptionalQuotationBomStorage(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("quotation_bom_items") ||
    normalized.includes("schema cache")
  ) && (
    normalized.includes("could not find") ||
    normalized.includes("does not exist") ||
    normalized.includes("not found")
  );
}

function isInvalidCustomerTenantLink(message: string) {
  return message
    .toLowerCase()
    .includes("customer_id must belong to the same organization as the quotation");
}

function canRetryWithoutCustomer(payload: Record<string, unknown>) {
  return Boolean(payload.customer_id && (payload.lead_id || payload.site_survey_id));
}

function retryWithoutCustomer(payload: Record<string, unknown>) {
  return { ...payload, customer_id: null };
}

async function insertQuotationRecord(
  payload: Record<string, unknown>,
): Promise<Quotation> {
  const client = requireSupabase();
  let nextPayload = { ...payload };
  const maxAttempts = Object.keys(nextPayload).length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await client
      .from("quotations")
      .insert(nextPayload)
      .select("*")
      .single();

    if (!error) {
      return data as Quotation;
    }

    if (isInvalidCustomerTenantLink(error.message) && canRetryWithoutCustomer(nextPayload)) {
      nextPayload = retryWithoutCustomer(nextPayload);
      continue;
    }

    const column = missingSchemaColumn(error.message);
    if (!column || !(column in nextPayload)) {
      throw new Error(error.message);
    }

    if (requiredQuotationStorageColumns.has(column)) {
      throw new Error(missingRequiredQuotationColumnMessage(column));
    }

    delete nextPayload[column];
  }

  throw new Error(
    "Quotation save failed because the database schema is missing required quotation columns.",
  );
}

async function updateQuotationRecord(
  id: string,
  payload: Record<string, unknown>,
): Promise<Quotation> {
  const client = requireSupabase();
  let nextPayload = { ...payload };
  const maxAttempts = Object.keys(nextPayload).length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await client
      .from("quotations")
      .update(nextPayload)
      .eq("id", id)
      .select("*")
      .single();

    if (!error) {
      return data as Quotation;
    }

    if (isInvalidCustomerTenantLink(error.message) && canRetryWithoutCustomer(nextPayload)) {
      nextPayload = retryWithoutCustomer(nextPayload);
      continue;
    }

    const column = missingSchemaColumn(error.message);
    if (!column || !(column in nextPayload)) {
      throw new Error(error.message);
    }

    if (requiredQuotationStorageColumns.has(column)) {
      throw new Error(missingRequiredQuotationColumnMessage(column));
    }

    delete nextPayload[column];
  }

  throw new Error(
    "Quotation save failed because the database schema is missing required quotation columns.",
  );
}

function itemPayload(values: QuotationItemFormValues, sortOrder?: number) {
  const material = nullable(values.material);
  const itemName = values.item_name.trim() || material || "";

  return {
    item_type: nullable(values.item_type),
    item_name: itemName,
    description: nullable(values.description),
    section_name: nullable(values.section_name),
    material,
    specification: nullable(values.specification),
    make: nullable(values.make),
    quantity: nullableNumber(values.quantity) ?? 1,
    unit: nullable(values.unit),
    unit_price: nullableNumber(values.unit_price) ?? 0,
    gst_percent: nullableNumber(values.gst_percent) ?? 0,
    ...(sortOrder === undefined ? {} : { sort_order: sortOrder }),
  };
}

function warrantyPayload(
  quotationId: string,
  values: QuotationWarrantyFormValues,
  sortOrder: number,
) {
  return {
    quotation_id: quotationId,
    component: values.component.trim(),
    warranty_text: values.warranty_text.trim(),
    sort_order: sortOrder,
  };
}

function paymentTermPayload(
  quotationId: string,
  values: QuotationPaymentTermFormValues,
  sortOrder: number,
) {
  return {
    quotation_id: quotationId,
    milestone: values.milestone.trim(),
    percentage: nullableNumber(values.percentage),
    amount: nullableNumber(values.amount),
    sort_order: sortOrder,
  };
}

const customerSelect =
  "id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, customer_type, assigned_to";
const leadSelect =
  "id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, lead_source, requirement_type, electricity_bill_amount, offered_price, property_type, roof_type, estimated_load_kw, priority, assigned_to, notes";
const quotationBomItemSelect =
  "*, category:product_categories!quotation_bom_items_product_category_id_fkey(id, name, category_type, display_order), product:products!quotation_bom_items_product_id_fkey(id, product_code, product_name, brand, model_number, specifications, unit, category_type, hsn_code, product_type:product_types(id, name))";
const quotationReservationSelect =
  "*, inventory_item:inventory_items(id, item_code, item_name, brand, model, unit, current_stock), catalog_product:products(id, product_code, product_name, brand, model_number, unit)";

const quotationSelect = `
  *,
  customer:customers(${customerSelect}),
  lead:leads(${leadSelect}),
  site_survey:site_surveys(
    *,
      customer:customers(${customerSelect}),
      lead:leads(${leadSelect})
  ),
  created_by_profile:users_profile!quotations_created_by_fkey(
    id,
    full_name,
    phone,
    email
  )
`;

async function fetchQuotationWarrantiesForQuotations(
  profile: UserProfile | null,
  quotationIds: string[],
) {
  if (quotationIds.length === 0) {
    return [] as QuotationWarranty[];
  }

  const client = requireSupabase();
  let query = client
    .from("quotation_warranties")
    .select("*")
    .in("quotation_id", quotationIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("tenant_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationWarranty[];
  }

  return (data ?? []) as QuotationWarranty[];
}

async function fetchQuotationPaymentTermsForQuotations(
  profile: UserProfile | null,
  quotationIds: string[],
) {
  if (quotationIds.length === 0) {
    return [] as QuotationPaymentTerm[];
  }

  const client = requireSupabase();
  let query = client
    .from("quotation_payment_terms")
    .select("*")
    .in("quotation_id", quotationIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("tenant_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationPaymentTerm[];
  }

  return (data ?? []) as QuotationPaymentTerm[];
}

async function attachQuotationChildRows(
  profile: UserProfile | null,
  quotations: QuotationWithRelations[],
) {
  const quotationIds = quotations.map((quotation) => quotation.id);
  const [warranties, paymentTerms] = await Promise.all([
    fetchQuotationWarrantiesForQuotations(profile, quotationIds),
    fetchQuotationPaymentTermsForQuotations(profile, quotationIds),
  ]);

  const warrantiesByQuotation = new Map<string, QuotationWarranty[]>();
  warranties.forEach((warranty) => {
    const rows = warrantiesByQuotation.get(warranty.quotation_id) ?? [];
    rows.push(warranty);
    warrantiesByQuotation.set(warranty.quotation_id, rows);
  });

  const paymentTermsByQuotation = new Map<string, QuotationPaymentTerm[]>();
  paymentTerms.forEach((paymentTerm) => {
    const rows = paymentTermsByQuotation.get(paymentTerm.quotation_id) ?? [];
    rows.push(paymentTerm);
    paymentTermsByQuotation.set(paymentTerm.quotation_id, rows);
  });

  return quotations.map((quotation) => ({
    ...quotation,
    quotation_warranties: warrantiesByQuotation.get(quotation.id) ?? [],
    quotation_payment_terms: paymentTermsByQuotation.get(quotation.id) ?? [],
  }));
}

export async function fetchQuotations(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("quotations")
    .select(quotationSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return attachQuotationChildRows(profile, (data ?? []) as QuotationWithRelations[]);
}

export async function fetchQuotation(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("quotations").select(quotationSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const [quotation] = await attachQuotationChildRows(profile, [
    data as QuotationWithRelations,
  ]);
  return quotation;
}

export async function fetchQuotationItems(
  profile: UserProfile | null,
  quotationId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as QuotationItem[];
}

export async function fetchNextQuotationCode(
  profile: UserProfile | null,
  prefix: string | null | undefined,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);
  const quotationPrefix = prefix?.trim() || "QUO";
  const { count, error } = await client
    .from("quotations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(error.message);
  }

  return `${quotationPrefix}-${String(Number(count ?? 0) + 1).padStart(4, "0")}`;
}

export async function fetchQuotationBomItems(
  profile: UserProfile | null,
  quotationId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("quotation_bom_items")
    .select(quotationBomItemSelect)
    .eq("quotation_id", quotationId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("tenant_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingOptionalQuotationBomStorage(error.message)) {
      return [] as QuotationBomItem[];
    }

    throw new Error(error.message);
  }

  return (data ?? []) as QuotationBomItem[];
}

export async function fetchQuotationReservations(
  profile: UserProfile | null,
  quotationId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_reservations")
    .select(quotationReservationSelect)
    .eq("quotation_id", quotationId)
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationInventoryReservation[];
  }

  return (data ?? []) as unknown as QuotationInventoryReservation[];
}

function bomItemPayload(values: QuotationBomItemFormValues) {
  return {
    selected_product_category_id: values.product_category_id,
    selected_product_id: nullable(values.product_id),
    entered_item_name: null,
    entered_quantity: nullableNumber(values.quantity) ?? 0,
    entered_unit: nullable(values.unit),
    entered_notes: nullable(values.notes),
  };
}

export async function createQuotationBomItem(
  quotationId: string,
  values: QuotationBomItemFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_quotation_bom_item", {
    target_quotation_id: quotationId,
    ...bomItemPayload(values),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as QuotationBomItem;
}

export async function updateQuotationBomItem(
  itemId: string,
  values: QuotationBomItemFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_quotation_bom_item", {
    target_item_id: itemId,
    ...bomItemPayload(values),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as QuotationBomItem;
}

export async function deleteQuotationBomItem(itemId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("delete_quotation_bom_item", {
    target_item_id: itemId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function createQuotation(
  profile: UserProfile | null,
  values: QuotationFormValues,
) {
  const normalizedValues = await normalizeQuotationLinks(profile, values);
  const data = await insertQuotationRecord({
    organization_id: requireOrganization(profile),
    created_by: profile?.id ?? null,
    status: "draft",
    ...quotationPayload(normalizedValues),
  });

  try {
    await syncQuotationWarranties(data.id, normalizedValues.warranty_rows, false);
    await syncQuotationPaymentTerms(
      data.id,
      normalizedValues.payment_term_rows,
      false,
    );
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        isMissingOptionalQuotationStorage(error.message)
      )
    ) {
      throw error;
    }
  }

  return data as Quotation;
}

export async function updateQuotation(
  profile: UserProfile | null,
  id: string,
  values: QuotationFormValues,
) {
  const normalizedValues = await normalizeQuotationLinks(profile, values);
  const data = await updateQuotationRecord(id, quotationPayload(normalizedValues));

  try {
    await syncQuotationWarranties(id, normalizedValues.warranty_rows);
    await syncQuotationPaymentTerms(id, normalizedValues.payment_term_rows);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        isMissingOptionalQuotationStorage(error.message)
      )
    ) {
      throw error;
    }
  }
  await recalculateQuotationTotals(id);
  return data as Quotation;
}

export async function deleteQuotation(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("quotations").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createQuotationItem(
  quotationId: string,
  values: QuotationItemFormValues,
  sortOrder: number,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("quotation_items")
    .insert({
      quotation_id: quotationId,
      ...itemPayload(values, sortOrder),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await recalculateQuotationTotals(quotationId);
  return data as QuotationItem;
}

export async function updateQuotationItem(
  quotationId: string,
  itemId: string,
  values: QuotationItemFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("quotation_items")
    .update(itemPayload(values))
    .eq("id", itemId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await recalculateQuotationTotals(quotationId);
  return data as QuotationItem;
}

export async function deleteQuotationItem(
  quotationId: string,
  itemId: string,
) {
  const client = requireSupabase();
  const { error } = await client.from("quotation_items").delete().eq("id", itemId);

  if (error) {
    throw new Error(error.message);
  }

  await recalculateQuotationTotals(quotationId);
}

async function syncQuotationWarranties(
  quotationId: string,
  warranties: QuotationWarrantyFormValues[],
  clearExisting = true,
) {
  const client = requireSupabase();
  const normalizedWarranties = warranties
    .map((warranty) => ({
      component: warranty.component.trim(),
      warranty_text: warranty.warranty_text.trim(),
    }))
    .filter((warranty) => warranty.component || warranty.warranty_text);

  if (clearExisting) {
    const { error: deleteError } = await client
      .from("quotation_warranties")
      .delete()
      .eq("quotation_id", quotationId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (normalizedWarranties.length === 0) {
    return;
  }

  const { error: insertError } = await client
    .from("quotation_warranties")
    .insert(
      normalizedWarranties.map((warranty, index) =>
        warrantyPayload(quotationId, warranty, index + 1),
      ),
    );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function syncQuotationPaymentTerms(
  quotationId: string,
  paymentTerms: QuotationPaymentTermFormValues[],
  clearExisting = true,
) {
  const client = requireSupabase();
  const normalizedPaymentTerms = paymentTerms
    .map((paymentTerm) => ({
      milestone: paymentTerm.milestone.trim(),
      percentage: paymentTerm.percentage.trim(),
      amount: paymentTerm.amount.trim(),
    }))
    .filter(
      (paymentTerm) =>
        paymentTerm.milestone || paymentTerm.percentage || paymentTerm.amount,
    );

  if (clearExisting) {
    const { error: deleteError } = await client
      .from("quotation_payment_terms")
      .delete()
      .eq("quotation_id", quotationId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (normalizedPaymentTerms.length === 0) {
    return;
  }

  const { error: insertError } = await client
    .from("quotation_payment_terms")
    .insert(
      normalizedPaymentTerms.map((paymentTerm, index) =>
        paymentTermPayload(quotationId, paymentTerm, index + 1),
      ),
    );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export async function recalculateQuotationTotals(quotationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("recalculate_quotation_totals", {
    target_quotation_id: quotationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Quotation;
}

export async function markQuotationSent(quotationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("mark_quotation_sent", {
    target_quotation_id: quotationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Quotation;
}

export async function acceptQuotation(quotationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("accept_quotation", {
    target_quotation_id: quotationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Quotation;
}

export async function rejectQuotation(quotationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("reject_quotation", {
    target_quotation_id: quotationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Quotation;
}

export async function fetchQuotationCustomers(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("customers")
    .select(customerSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SurveyCustomerSummary[];
  }

  return (data ?? []) as SurveyCustomerSummary[];
}

export async function fetchQuotationLeads(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select(leadSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SurveyLeadSummary[];
  }

  return (data ?? []) as SurveyLeadSummary[];
}

export async function fetchQuotationLead(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  let query = client.from("leads").select(leadSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as SurveyLeadSummary | null;
}

export async function fetchQuotationSiteSurveys(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("site_surveys")
    .select(
      `*, customer:customers(${customerSelect}), lead:leads(${leadSelect})`,
    )
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SiteSurveyWithRelations[];
  }

  return (data ?? []) as SiteSurveyWithRelations[];
}

export async function fetchQuotationSiteSurvey(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  let query = client
    .from("site_surveys")
    .select(
      `*, customer:customers(${customerSelect}), lead:leads(${leadSelect})`,
    )
    .eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as SiteSurveyWithRelations | null;
}
