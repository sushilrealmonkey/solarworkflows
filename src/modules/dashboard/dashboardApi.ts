import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { Lead, LeadFollowupWithLead } from "../crm/types";
import type { OrganizationDocumentWithRelations } from "../documents/types";
import type { InventoryItem } from "../inventory/types";
import type { PaymentWithRelations } from "../payments/types";
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
};

export type DashboardOperationalData = {
  followups: LeadFollowupWithLead[];
  upcomingSurveys: SiteSurveyWithRelations[];
  recentLeads: Lead[];
  recentPayments: PaymentWithRelations[];
  lowStockItems: InventoryItem[];
  pendingDocuments: OrganizationDocumentWithRelations[];
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
      lead:leads(id, lead_code, full_name, phone, city)
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
      customer:customers(id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to)
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

export async function fetchDashboardRecentLeads(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Lead[];
}

export async function fetchDashboardRecentPayments(profile: UserProfile | null) {
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
    .limit(6);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as PaymentWithRelations[];
}

export async function fetchDashboardLowStockItems(profile: UserProfile | null) {
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
    .slice(0, 6);
}

export async function fetchDashboardPendingDocuments(profile: UserProfile | null) {
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
    .limit(6);

  query = applyOrganizationScope(query, profile);

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as unknown as OrganizationDocumentWithRelations[];
}
