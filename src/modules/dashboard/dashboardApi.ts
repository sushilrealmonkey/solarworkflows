import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { B2BSaleWithRelations } from "../b2b-sales/types";
import type { Lead, LeadFollowupWithLead } from "../crm/types";
import type { OrganizationDocumentWithRelations } from "../documents/types";
import type { InventoryItem } from "../inventory/types";
import type { PaymentWithRelations } from "../payments/types";
import type { PaymentProjectSummary } from "../payments/types";
import type { ProjectWithRelations } from "../projects/types";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import type { QuotationInventoryReservation, QuotationWithRelations } from "../quotations/types";
import type { SiteSurveyWithRelations } from "../site-surveys/types";

export type DashboardSummaryRow = {
  organization_id: string;
  total_customers: number;
  total_leads: number;
  active_projects: number;
  completed_projects: number;
  pending_site_surveys: number;
  quotations_sent: number;
  quotations_accepted: number;
  total_project_value: number;
  total_received_amount: number;
  total_balance_due: number;
  low_stock_items: number;
  pending_documents: number;
  b2b_customers: number;
  active_b2b_customers: number;
  b2b_sales_count: number;
  b2b_sales_value: number;
  b2b_sales_received_amount: number;
  b2b_sales_balance_due: number;
};

export type DashboardOperationalData = {
  followups: LeadFollowupWithLead[];
  upcomingSurveys: SiteSurveyWithRelations[];
  recentLeads: Lead[];
  recentPayments: PaymentWithRelations[];
  recentB2BSales: B2BSaleWithRelations[];
  lowStockItems: InventoryItem[];
  pendingDocuments: OrganizationDocumentWithRelations[];
};

export type DashboardActivityLog = {
  id: string;
  module: string | null;
  action: string | null;
  record_id: string | null;
  created_at: string | null;
  user_profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export type EpcAdminDashboardSnapshot = DashboardOperationalData & {
  summaryRows: DashboardSummaryRow[];
  quotations: QuotationWithRelations[];
  projects: ProjectWithRelations[];
  paymentSummaries: PaymentProjectSummary[];
  inventoryReservations: QuotationInventoryReservation[];
  purchaseOrders: PurchaseOrderWithRelations[];
  recentActivity: DashboardActivityLog[];
};

type EpcAdminDashboardSnapshotOptions = {
  includeB2BSales?: boolean;
};

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

function applyOrganizationScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  profile: UserProfile | null,
) {
  if (!profile?.is_super_admin) {
    return query.eq("organization_id", requireOrganization(profile));
  }

  return query;
}

export async function fetchDashboardSummary() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("dashboard_summary");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DashboardSummaryRow[];
}

export async function fetchEpcAdminDashboardSnapshot(
  profile: UserProfile | null,
  options: EpcAdminDashboardSnapshotOptions = {},
): Promise<EpcAdminDashboardSnapshot> {
  const [
    summaryRows,
    followups,
    upcomingSurveys,
    recentLeads,
    recentPayments,
    recentB2BSales,
    lowStockItems,
    pendingDocuments,
    quotations,
    projects,
    paymentSummaries,
    inventoryReservations,
    purchaseOrders,
    recentActivity,
  ] = await Promise.all([
    fetchDashboardSummary(),
    fetchDashboardFollowups(profile),
    fetchDashboardUpcomingSurveys(profile),
    fetchDashboardRecentLeads(profile, 120),
    fetchDashboardRecentPayments(profile, 12),
    options.includeB2BSales
      ? fetchDashboardRecentB2BSales(profile, 8)
      : Promise.resolve([]),
    fetchDashboardLowStockItems(profile, 12),
    fetchDashboardPendingDocuments(profile, 12),
    fetchDashboardQuotations(profile),
    fetchDashboardProjects(profile),
    fetchDashboardPaymentSummaries(profile),
    fetchDashboardInventoryReservations(profile),
    fetchDashboardPurchaseOrders(profile),
    fetchDashboardActivity(profile),
  ]);

  return {
    summaryRows,
    followups,
    upcomingSurveys,
    recentLeads,
    recentPayments,
    recentB2BSales,
    lowStockItems,
    pendingDocuments,
    quotations,
    projects,
    paymentSummaries,
    inventoryReservations,
    purchaseOrders,
    recentActivity,
  };
}

export function emptyDashboardSummary(): DashboardSummaryRow {
  return {
    organization_id: "all",
    total_customers: 0,
    total_leads: 0,
    active_projects: 0,
    completed_projects: 0,
    pending_site_surveys: 0,
    quotations_sent: 0,
    quotations_accepted: 0,
    total_project_value: 0,
    total_received_amount: 0,
    total_balance_due: 0,
    low_stock_items: 0,
    pending_documents: 0,
    b2b_customers: 0,
    active_b2b_customers: 0,
    b2b_sales_count: 0,
    b2b_sales_value: 0,
    b2b_sales_received_amount: 0,
    b2b_sales_balance_due: 0,
  };
}

export function aggregateDashboardSummary(rows: DashboardSummaryRow[]) {
  return rows.reduce((summary, row) => {
    summary.total_customers += Number(row.total_customers ?? 0);
    summary.total_leads += Number(row.total_leads ?? 0);
    summary.active_projects += Number(row.active_projects ?? 0);
    summary.completed_projects += Number(row.completed_projects ?? 0);
    summary.pending_site_surveys += Number(row.pending_site_surveys ?? 0);
    summary.quotations_sent += Number(row.quotations_sent ?? 0);
    summary.quotations_accepted += Number(row.quotations_accepted ?? 0);
    summary.total_project_value += Number(row.total_project_value ?? 0);
    summary.total_received_amount += Number(row.total_received_amount ?? 0);
    summary.total_balance_due += Number(row.total_balance_due ?? 0);
    summary.low_stock_items += Number(row.low_stock_items ?? 0);
    summary.pending_documents += Number(row.pending_documents ?? 0);
    summary.b2b_customers += Number(row.b2b_customers ?? 0);
    summary.active_b2b_customers += Number(row.active_b2b_customers ?? 0);
    summary.b2b_sales_count += Number(row.b2b_sales_count ?? 0);
    summary.b2b_sales_value += Number(row.b2b_sales_value ?? 0);
    summary.b2b_sales_received_amount += Number(
      row.b2b_sales_received_amount ?? 0,
    );
    summary.b2b_sales_balance_due += Number(row.b2b_sales_balance_due ?? 0);
    return summary;
  }, emptyDashboardSummary());
}

export async function fetchDashboardFollowups(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("lead_followups")
    .select(
      `
      *,
      lead:leads(id, lead_code, full_name, phone, city),
      assigned_staff:users_profile!lead_followups_assigned_to_fkey(id, full_name)
    `,
    )
    .in("status", ["pending", "missed"])
    .order("followup_date", { ascending: true })
    .limit(80);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LeadFollowupWithLead[];
}

export async function fetchDashboardUpcomingSurveys(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("site_surveys")
    .select(
      `
      *,
      lead:leads(id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, roof_type, estimated_load_kw, assigned_to),
      customer:customers(id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to),
      assigned_staff:users_profile!site_surveys_assigned_to_fkey(id, full_name)
    `,
    )
    .in("survey_status", ["scheduled", "in_progress", "rescheduled"])
    .gte("scheduled_date", new Date().toISOString().slice(0, 10))
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(6);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as SiteSurveyWithRelations[];
}

export async function fetchDashboardRecentLeads(
  profile: UserProfile | null,
  limit = 6,
) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Lead[];
}

export async function fetchDashboardRecentPayments(
  profile: UserProfile | null,
  limit = 6,
) {
  const client = requireSupabase();
  let query = client
    .from("payments")
    .select(
      `
      *,
      customer:customers(id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to),
      project:projects(id, organization_id, project_code, project_name, customer_id, quotation_id)
    `,
    )
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as PaymentWithRelations[];
}

export async function fetchDashboardRecentB2BSales(
  profile: UserProfile | null,
  limit = 6,
) {
  if (!profile?.is_super_admin && !profile?.company_id) {
    return [] as B2BSaleWithRelations[];
  }

  const client = requireSupabase();
  let query = client
    .from("b2b_sales")
    .select(
      `
      *,
      customer:customers(id, customer_code, full_name, business_name, gst_number, contact_person_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, customer_segment, customer_type, assigned_to),
      proforma_invoice:proforma_invoices!b2b_sales_proforma_invoice_id_fkey(id, proforma_code, total_amount, amount_paid, balance_due, status),
      invoice:invoices!b2b_sales_invoice_id_fkey(id, invoice_code, total_amount, amount_paid, balance_due, status),
      created_by_profile:users_profile!b2b_sales_created_by_fkey(id, full_name, phone, email)
    `,
    )
    .neq("status", "cancelled")
    .order("sale_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!profile?.is_super_admin) {
    query = query
      .eq("organization_id", requireOrganization(profile))
      .eq("company_id", profile.company_id);
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
    if (profile.company_id) {
      query = query.eq("company_id", profile.company_id);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as B2BSaleWithRelations[];
}

export async function fetchDashboardLowStockItems(
  profile: UserProfile | null,
  limit = 6,
) {
  const client = requireSupabase();
  let query = client
    .from("inventory_items")
    .select(
      `
      id,
      organization_id,
      item_code,
      item_name,
      item_category,
      unit,
      current_stock,
      minimum_stock,
      status,
      created_at,
      updated_at
    `,
    )
    .eq("status", "active")
    .order("item_name", { ascending: true });

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as InventoryItem[])
    .filter(
      (item) => Number(item.current_stock ?? 0) <= Number(item.minimum_stock ?? 0),
    )
    .slice(0, limit);
}

export async function fetchDashboardPendingDocuments(
  profile: UserProfile | null,
  limit = 6,
) {
  const client = requireSupabase();
  let query = client
    .from("documents")
    .select(
      `
      *,
      customer:customers(id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to),
      lead:leads(id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, roof_type, estimated_load_kw, assigned_to),
      project:projects(id, project_code, project_name, customer_id, quotation_id),
      quotation:quotations(id, quotation_code, customer_id)
    `,
    )
    .in("status", ["pending", "rejected", "expired"])
    .order("created_at", { ascending: false })
    .limit(limit);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as OrganizationDocumentWithRelations[];
}

export async function fetchDashboardQuotations(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("quotations")
    .select(
      `
      id,
      organization_id,
      quotation_code,
      customer_id,
      lead_id,
      site_survey_id,
      quotation_date,
      valid_until,
      system_capacity_kw,
      total_amount,
      net_payable_amount,
      status,
      sent_at,
      accepted_at,
      rejected_at,
      created_at,
      customer:customers(id, customer_code, full_name, business_name, phone, city),
      lead:leads(id, lead_code, full_name, phone, city)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(160);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as QuotationWithRelations[];
}

export async function fetchDashboardProjects(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select(
      `
      id,
      organization_id,
      project_code,
      customer_id,
      lead_id,
      quotation_id,
      site_survey_id,
      project_name,
      system_capacity_kw,
      project_type,
      project_status,
      priority,
      start_date,
      expected_completion_date,
      completed_at,
      created_at,
      customer:customers(id, customer_code, full_name, business_name, phone, city),
      quotation:quotations(id, quotation_code, total_amount, net_payable_amount, status),
      project_manager:users_profile!projects_assigned_project_manager_fkey(id, full_name, phone, email, status, organization_id)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(160);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as ProjectWithRelations[];
}

export async function fetchDashboardPaymentSummaries(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("project_payment_summary")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(160);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PaymentProjectSummary[];
}

export async function fetchDashboardInventoryReservations(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("inventory_reservations")
    .select(
      `
      *,
      project:projects(id, project_code, project_name, system_capacity_kw),
      inventory_item:inventory_items(id, item_code, item_name, brand, model, unit, current_stock),
      catalog_product:products(id, product_code, product_name, brand, model_number, unit)
    `,
    )
    .in("status", ["active", "partial", "shortage"])
    .order("created_at", { ascending: false })
    .limit(120);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    return [] as QuotationInventoryReservation[];
  }

  return (data ?? []) as unknown as QuotationInventoryReservation[];
}

export async function fetchDashboardPurchaseOrders(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("purchase_orders")
    .select(
      `
      *,
      vendor:vendors(id, vendor_code, vendor_name, contact_person, phone, email)
    `,
    )
    .in("status", ["draft", "ordered", "partially_received"])
    .order("expected_delivery_date", { ascending: true })
    .limit(30);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    return [] as PurchaseOrderWithRelations[];
  }

  return (data ?? []) as unknown as PurchaseOrderWithRelations[];
}

export async function fetchDashboardActivity(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("activity_logs")
    .select(
      `
      id,
      module,
      action,
      record_id,
      created_at,
      user_profile:users_profile!activity_logs_user_profile_id_fkey(id, full_name, email, phone)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(8);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    return [] as DashboardActivityLog[];
  }

  return (data ?? []) as unknown as DashboardActivityLog[];
}
