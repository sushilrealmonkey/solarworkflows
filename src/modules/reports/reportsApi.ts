import { supabase } from "../../services/supabaseClient";

export type DateRange = {
  startDate: string;
  endDate: string;
};

export type SalesReportRow = {
  organization_id: string;
  quotation_count: number;
  accepted_quotation_count: number;
  total_quotation_value: number;
  project_count: number;
  total_project_value: number;
  invoice_total: number;
  payment_received_total: number;
  balance_due_total: number;
};

export type ProjectStatusReportRow = {
  organization_id: string;
  project_status: string | null;
  project_count: number;
};

export type LeadStatusReportRow = {
  organization_id: string;
  status: string | null;
  lead_count: number;
};

export type PaymentReportRow = {
  organization_id: string;
  payment_source: string | null;
  payment_mode: string | null;
  total_amount: number;
  payment_count: number;
};

export type LowStockReportRow = {
  organization_id: string;
  item_id: string;
  item_code: string | null;
  item_name: string;
  item_category: string | null;
  brand: string | null;
  model: string | null;
  unit: string | null;
  current_stock: number | null;
  minimum_stock: number | null;
  status: string | null;
};

export type ReportsData = {
  sales: SalesReportRow[];
  projectStatuses: ProjectStatusReportRow[];
  leadStatuses: LeadStatusReportRow[];
  payments: PaymentReportRow[];
  lowStock: LowStockReportRow[];
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

export async function fetchReportsData(range: DateRange): Promise<ReportsData> {
  const client = requireSupabase();
  const [
    salesResult,
    projectStatusResult,
    leadStatusResult,
    paymentResult,
    lowStockResult,
  ] = await Promise.all([
    client.rpc("sales_report", {
      start_date: range.startDate,
      end_date: range.endDate,
    }),
    client.rpc("project_status_report"),
    client.rpc("lead_status_report"),
    client.rpc("payment_report", {
      start_date: range.startDate,
      end_date: range.endDate,
    }),
    client.rpc("inventory_low_stock_report"),
  ]);

  const firstError =
    salesResult.error ??
    projectStatusResult.error ??
    leadStatusResult.error ??
    paymentResult.error ??
    lowStockResult.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    sales: (salesResult.data ?? []) as SalesReportRow[],
    projectStatuses: (projectStatusResult.data ?? []) as ProjectStatusReportRow[],
    leadStatuses: (leadStatusResult.data ?? []) as LeadStatusReportRow[],
    payments: (paymentResult.data ?? []) as PaymentReportRow[],
    lowStock: (lowStockResult.data ?? []) as LowStockReportRow[],
  };
}

export function emptySalesReportRow(): SalesReportRow {
  return {
    organization_id: "all",
    quotation_count: 0,
    accepted_quotation_count: 0,
    total_quotation_value: 0,
    project_count: 0,
    total_project_value: 0,
    invoice_total: 0,
    payment_received_total: 0,
    balance_due_total: 0,
  };
}

export function aggregateSalesRows(rows: SalesReportRow[]) {
  return rows.reduce((summary, row) => {
    summary.quotation_count += Number(row.quotation_count ?? 0);
    summary.accepted_quotation_count += Number(
      row.accepted_quotation_count ?? 0,
    );
    summary.total_quotation_value += Number(row.total_quotation_value ?? 0);
    summary.project_count += Number(row.project_count ?? 0);
    summary.total_project_value += Number(row.total_project_value ?? 0);
    summary.invoice_total += Number(row.invoice_total ?? 0);
    summary.payment_received_total += Number(row.payment_received_total ?? 0);
    summary.balance_due_total += Number(row.balance_due_total ?? 0);
    return summary;
  }, emptySalesReportRow());
}
