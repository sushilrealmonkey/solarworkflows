import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { hasPermission, labelize } from "../crm/crmUtils";
import { formatStock } from "../inventory/inventoryUtils";
import {
  aggregateSalesRows,
  fetchReportsData,
  type DateRange,
  type LeadStatusReportRow,
  type LowStockReportRow,
  type PaymentReportRow,
  type ProjectStatusReportRow,
  type ReportsData,
  type SalesReportRow,
} from "./reportsApi";

type DatePreset = "today" | "week" | "month" | "custom";

const emptyReportsData: ReportsData = {
  sales: [],
  projectStatuses: [],
  leadStatuses: [],
  payments: [],
  lowStock: [],
};

export function ReportsPage() {
  const { profile, permissions, organization } = useAuth();
  const canViewReports = hasPermission(profile, permissions, "reports", "view");
  const [preset, setPreset] = useState<DatePreset>("month");
  const [customStartDate, setCustomStartDate] = useState(todayInput());
  const [customEndDate, setCustomEndDate] = useState(todayInput());
  const [reportsData, setReportsData] = useState<ReportsData>(emptyReportsData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateRange = useMemo(
    () =>
      preset === "custom"
        ? normalizeCustomRange(customStartDate, customEndDate)
        : presetDateRange(preset),
    [customEndDate, customStartDate, preset],
  );

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: organization.currency || "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [organization.currency],
  );

  useEffect(() => {
    if (!canViewReports) {
      return;
    }

    let isMounted = true;

    async function loadReports() {
      try {
        setLoading(true);
        setError(null);
        const nextReports = await fetchReportsData(dateRange);
        if (isMounted) {
          setReportsData(nextReports);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load reports.",
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadReports();

    return () => {
      isMounted = false;
    };
  }, [canViewReports, dateRange]);

  const salesSummary = useMemo(
    () => aggregateSalesRows(reportsData.sales),
    [reportsData.sales],
  );
  const projectChartRows = useMemo(
    () =>
      reportsData.projectStatuses.map((row) => ({
        label: labelize(row.project_status),
        value: Number(row.project_count ?? 0),
      })),
    [reportsData.projectStatuses],
  );
  const leadChartRows = useMemo(
    () =>
      reportsData.leadStatuses.map((row) => ({
        label: labelize(row.status),
        value: Number(row.lead_count ?? 0),
      })),
    [reportsData.leadStatuses],
  );

  if (!canViewReports) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Operational reporting for users with reporting access."
        />
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            Reports access required
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your account is active, but it does not have reports:view permission.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Sales, project, lead, payment, and inventory reports from Supabase reporting functions."
      />

      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-950">Date filters</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["today", "Today"],
                ["week", "This week"],
                ["month", "This month"],
                ["custom", "Custom"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    preset === value
                      ? "border-orange-500 bg-orange-50 text-[#06173f]"
                      : "border-stone-200 bg-white text-slate-700 hover:bg-stone-50"
                  }`}
                  onClick={() => setPreset(value as DatePreset)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <DateInput
                  label="Start date"
                  value={customStartDate}
                  onChange={setCustomStartDate}
                />
                <DateInput
                  label="End date"
                  value={customEndDate}
                  onChange={setCustomEndDate}
                />
              </div>
            ) : null}
          </div>
          <div className="text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Current range</p>
            <p className="mt-1">
              {formatDateLabel(dateRange.startDate)} to{" "}
              {formatDateLabel(dateRange.endDate)}
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
          {error}
        </section>
      ) : null}

      <SalesReportSection
        currencyFormatter={currencyFormatter}
        loading={loading}
        rows={reportsData.sales}
        summary={salesSummary}
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <StatusReportSection
          title="Project Status Report"
          loading={loading}
          chartRows={projectChartRows}
          tableRows={reportsData.projectStatuses}
          countKey="project_count"
          labelKey="project_status"
        />
        <StatusReportSection
          title="Lead Status Report"
          loading={loading}
          chartRows={leadChartRows}
          tableRows={reportsData.leadStatuses}
          countKey="lead_count"
          labelKey="status"
        />
      </section>

      <PaymentReportSection
        currencyFormatter={currencyFormatter}
        loading={loading}
        rows={reportsData.payments}
      />

      <LowStockReportSection loading={loading} rows={reportsData.lowStock} />
    </div>
  );
}

function SalesReportSection({
  loading,
  rows,
  summary,
  currencyFormatter,
}: {
  loading: boolean;
  rows: SalesReportRow[];
  summary: SalesReportRow;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <ReportSection title="Sales Report">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Quotations"
          loading={loading}
          value={summary.quotation_count}
        />
        <SummaryCard
          label="Accepted"
          loading={loading}
          value={summary.accepted_quotation_count}
        />
        <SummaryCard
          label="Project Value"
          loading={loading}
          value={currencyFormatter.format(summary.total_project_value)}
        />
        <SummaryCard
          label="Balance Due"
          loading={loading}
          value={currencyFormatter.format(summary.balance_due_total)}
        />
      </div>
      <ResponsiveTable
        emptyText="No sales report rows for this date range."
        headers={[
          "Quotations",
          "Accepted",
          "Quotation Value",
          "Projects",
          "Project Value",
          "Tax Invoices",
          "Received",
          "Balance",
        ]}
        loading={loading}
        rows={rows.map((row) => [
          row.quotation_count,
          row.accepted_quotation_count,
          currencyFormatter.format(Number(row.total_quotation_value ?? 0)),
          row.project_count,
          currencyFormatter.format(Number(row.total_project_value ?? 0)),
          currencyFormatter.format(Number(row.invoice_total ?? 0)),
          currencyFormatter.format(Number(row.payment_received_total ?? 0)),
          currencyFormatter.format(Number(row.balance_due_total ?? 0)),
        ])}
      />
    </ReportSection>
  );
}

function StatusReportSection<
  T extends ProjectStatusReportRow | LeadStatusReportRow,
>({
  title,
  loading,
  chartRows,
  tableRows,
  labelKey,
  countKey,
}: {
  title: string;
  loading: boolean;
  chartRows: Array<{ label: string; value: number }>;
  tableRows: T[];
  labelKey: keyof T;
  countKey: keyof T;
}) {
  return (
    <ReportSection title={title}>
      {loading ? <LoadingRows /> : <BarChart rows={chartRows} />}
      <ResponsiveTable
        emptyText={`No ${title.toLowerCase()} rows yet.`}
        headers={["Status", "Count"]}
        loading={loading}
        rows={tableRows.map((row) => [
          labelize(row[labelKey] as string | null),
          Number(row[countKey] ?? 0),
        ])}
      />
    </ReportSection>
  );
}

function PaymentReportSection({
  loading,
  rows,
  currencyFormatter,
}: {
  loading: boolean;
  rows: PaymentReportRow[];
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <ReportSection title="Payment Report">
      <ResponsiveTable
        emptyText="No received payments in this date range."
        headers={["Source", "Mode", "Payments", "Total Amount"]}
        loading={loading}
        rows={rows.map((row) => [
          labelize(row.payment_source),
          labelize(row.payment_mode),
          row.payment_count,
          currencyFormatter.format(Number(row.total_amount ?? 0)),
        ])}
      />
    </ReportSection>
  );
}

function LowStockReportSection({
  loading,
  rows,
}: {
  loading: boolean;
  rows: LowStockReportRow[];
}) {
  return (
    <ReportSection title="Low Stock Report">
      <ResponsiveTable
        emptyText="No low stock items."
        headers={["Item", "Category", "Brand", "Current", "Minimum", "Status"]}
        loading={loading}
        rows={rows.map((row) => [
          row.item_code ? `${row.item_name} (${row.item_code})` : row.item_name,
          labelize(row.item_category),
          row.brand ?? "-",
          formatStock(row.current_stock, row.unit),
          formatStock(row.minimum_stock, row.unit),
          labelize(row.status),
        ])}
      />
    </ReportSection>
  );
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <button
          className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold text-slate-500"
          disabled
          type="button"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
}) {
  return (
    <article className="rounded-lg border border-stone-100 bg-stone-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-stone-200" />
      ) : (
        <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      )}
    </article>
  );
}

function BarChart({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const maxValue = Math.max(...rows.map((row) => row.value), 0);

  if (rows.length === 0 || maxValue === 0) {
    return <EmptyState>No chart data yet.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-2 sm:grid-cols-[9rem_1fr_3rem]">
          <p className="truncate text-sm font-medium text-slate-700">{row.label}</p>
          <div className="h-8 overflow-hidden rounded-lg bg-stone-100">
            <div
              className="h-full rounded-lg bg-orange-500"
              style={{ width: `${Math.max((row.value / maxValue) * 100, 8)}%` }}
            />
          </div>
          <p className="text-sm font-semibold text-slate-950">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function ResponsiveTable({
  headers,
  rows,
  loading,
  emptyText,
}: {
  headers: string[];
  rows: ReactNode[][];
  loading: boolean;
  emptyText: string;
}) {
  if (loading) {
    return <LoadingRows />;
  }

  if (rows.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-100">
      <table className="min-w-full divide-y divide-stone-100 text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="whitespace-nowrap px-3 py-3 text-slate-700"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-orange-500 focus:outline-none"
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-11 animate-pulse rounded-lg bg-stone-100" />
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-slate-600">{children}</p>;
}

function todayInput() {
  return toInputDate(new Date());
}

function toInputDate(value: Date) {
  const offsetDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function presetDateRange(preset: Exclude<DatePreset, "custom">): DateRange {
  const today = new Date();
  const start = new Date(today);

  if (preset === "today") {
    return {
      startDate: toInputDate(today),
      endDate: toInputDate(today),
    };
  }

  if (preset === "week") {
    const day = today.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    start.setDate(today.getDate() - daysFromMonday);
    return {
      startDate: toInputDate(start),
      endDate: toInputDate(today),
    };
  }

  start.setDate(1);
  return {
    startDate: toInputDate(start),
    endDate: toInputDate(today),
  };
}

function normalizeCustomRange(startDate: string, endDate: string): DateRange {
  if (!startDate || !endDate) {
    return {
      startDate: startDate || todayInput(),
      endDate: endDate || todayInput(),
    };
  }

  if (startDate > endDate) {
    return {
      startDate: endDate,
      endDate: startDate,
    };
  }

  return { startDate, endDate };
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
