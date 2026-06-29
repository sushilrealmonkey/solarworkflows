import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import {
  classifyFollowupDueDate,
  formatDate,
  formatDateTime,
  getFollowupDueDate,
  hasPermission,
  isActiveFollowup,
  labelize,
} from "../crm/crmUtils";
import type { Lead, LeadFollowupWithLead } from "../crm/types";
import { documentRelatedLabel } from "../documents/documentUtils";
import type { OrganizationDocumentWithRelations } from "../documents/types";
import { formatStock } from "../inventory/inventoryUtils";
import type { InventoryItem } from "../inventory/types";
import type { PaymentWithRelations } from "../payments/types";
import { formatKw } from "../projects/projectUtils";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import { getSurveyContact } from "../site-surveys/surveyUtils";
import type { SiteSurveyWithRelations } from "../site-surveys/types";
import {
  fetchPlatformDashboardSnapshot,
} from "../companies/companyApi";
import type { PlatformDashboardSnapshot } from "../companies/types";
import {
  aggregateDashboardSummary,
  emptyDashboardSummary,
  fetchDashboardFollowups,
  fetchDashboardLowStockItems,
  fetchDashboardPendingDocuments,
  fetchDashboardRecentLeads,
  fetchDashboardRecentPayments,
  fetchDashboardSummary,
  fetchDashboardUpcomingSurveys,
  fetchEpcAdminDashboardSnapshot,
  type DashboardSummaryRow,
  type EpcAdminDashboardSnapshot,
} from "./dashboardApi";

export function DashboardPage() {
  const { profile, roleNames } = useAuth();

  if (profile?.is_super_admin) {
    return <PlatformDashboard />;
  }

  return isTenantAdmin(roleNames) ? <EpcAdminDashboard /> : <TenantDashboard />;
}

function isTenantAdmin(roleNames: string[]) {
  return roleNames.some((roleName) =>
    ["admin", "administrator"].includes(roleName.trim().toLowerCase()),
  );
}

function EpcAdminDashboard() {
  const { profile, organization } = useAuth();
  const [snapshot, setSnapshot] = useState<EpcAdminDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSnapshot() {
      try {
        setLoading(true);
        setError(null);
        const nextSnapshot = await fetchEpcAdminDashboardSnapshot(profile);
        if (isMounted) {
          setSnapshot(nextSnapshot);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load EPC command dashboard.",
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      isMounted = false;
    };
  }, [profile]);

  const summary = useMemo(
    () =>
      snapshot?.summaryRows.length
        ? aggregateDashboardSummary(snapshot.summaryRows)
        : emptyDashboardSummary(),
    [snapshot?.summaryRows],
  );

  const compactCurrencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: organization.currency || "INR",
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [organization.currency],
  );

  const adminData = useMemo(
    () => buildEpcDashboardModel(snapshot, summary),
    [snapshot, summary],
  );
  const reportDate = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="space-y-3 sm:space-y-5">
      <section className="rounded-lg border border-orange-100 bg-white p-3 shadow-sm shadow-orange-950/5 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start xl:items-center">
          <SolarOperationsBrandGraphic
            className="sm:hidden"
            logoUrl={organization.logoUrl}
            organizationName={organization.name}
          />
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-slate-950 sm:text-3xl">
              Your Solar Business Overview
            </p>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              {reportDate}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickAction to="/leads" label="Add Lead" />
              <QuickAction to="/site-surveys" label="Site Survey" />
              <QuickAction to="/quotations" label="Quotation" />
              <QuickAction to="/payments" label="Payment" />
              <QuickAction to="/inventory" label="Material" />
            </div>
          </div>
          <SolarOperationsBrandGraphic
            className="hidden sm:flex"
            logoUrl={organization.logoUrl}
            organizationName={organization.name}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 xl:grid-cols-4">
          <HealthSignal
            label="Urgent actions today"
            value={adminData.urgentActions}
            tone="rose"
            loading={loading}
          />
          <HealthSignal
            label="Overdue payments"
            value={compactCurrencyFormatter.format(adminData.overdueAmount)}
            tone="amber"
            loading={loading}
          />
          <HealthSignal
            label="Projects delayed"
            value={adminData.delayedProjects.length}
            tone="blue"
            loading={loading}
          />
          <HealthSignal
            label="Quotations awaiting response"
            value={adminData.awaitingQuotations.length}
            tone="violet"
            loading={loading}
          />
        </div>
      </section>

      {error ? <ErrorPanel message={error} /> : null}

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
        <CommandMetricCard
          label="Pipeline Value"
          value={compactCurrencyFormatter.format(adminData.pipelineValue)}
          detail={`${adminData.activeLeads.length} active leads`}
          trend={`${adminData.newLeadsThisMonth} new this month`}
          visual={
            <MiniSparkline
              color="#2563eb"
              values={adminData.monthlyRows.map((row) => row.quotationValue)}
            />
          }
          loading={loading}
        />
        <CommandMetricCard
          label="Quotations Sent"
          value={adminData.sentQuotations.length}
          detail={`${compactCurrencyFormatter.format(adminData.quotedValue)} quoted`}
          trend={`${adminData.awaitingQuotations.length} awaiting response`}
          visual={
            <MiniSparkline
              color="#7c3aed"
              values={adminData.monthlyRows.map((row) => row.projectValue)}
            />
          }
          loading={loading}
        />
        <CommandMetricCard
          label="Quote Acceptance Rate"
          value={`${adminData.quoteAcceptanceRate}%`}
          detail={`${adminData.acceptedQuotations.length} accepted out of ${adminData.decisionQuotationCount}`}
          trend="This workspace"
          visual={<MiniDonut percent={adminData.quoteAcceptanceRate} tone="green" />}
          loading={loading}
        />
        <CommandMetricCard
          label="Active Project Value"
          value={compactCurrencyFormatter.format(adminData.activeProjectValue)}
          detail={`${adminData.activeProjects.length} active projects`}
          trend={`${adminData.activeCapacityKw.toFixed(1)} kW capacity`}
          visual={
            <MiniSparkline
              color="#f97316"
              values={adminData.monthlyRows.map((row) => row.projectValue)}
            />
          }
          loading={loading}
        />
        <CommandMetricCard
          label="Outstanding Collection"
          value={compactCurrencyFormatter.format(summary.total_balance_due)}
          detail={`${compactCurrencyFormatter.format(adminData.overdueAmount)} overdue`}
          trend={`${adminData.collectionEfficiency}% collection efficiency`}
          warning={adminData.overdueAmount > 0}
          visual={
            <MiniDonut
              percent={Math.max(100 - adminData.collectionEfficiency, 0)}
              tone="rose"
            />
          }
          loading={loading}
        />
      </section>

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <TodaysWorkPanel
          loading={loading}
          followups={adminData.todayFollowups}
        />
        <OverduePanel
          loading={loading}
          overdueFollowups={adminData.overdueFollowups.length}
          pendingSurveyReports={adminData.pendingSurveyReports}
          overdueAmount={adminData.overdueAmount}
          delayedProjects={adminData.delayedProjects.length}
          currencyFormatter={compactCurrencyFormatter}
        />
        <SchedulePanel loading={loading} rows={adminData.scheduleRows} />
      </section>

      <section className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <SalesPipelinePanel
          currencyFormatter={compactCurrencyFormatter}
          loading={loading}
          rows={adminData.pipelineRows}
        />
        <ProjectExecutionPanel
          loading={loading}
          rows={adminData.projectStageRows}
        />
      </section>

      <section>
        <RevenueCollectionPanel
          currencyFormatter={compactCurrencyFormatter}
          loading={loading}
          rows={adminData.monthlyRows}
        />
      </section>

      <section className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SurveyStatusPanel loading={loading} data={adminData} />
        <QuotationInsightsPanel
          currencyFormatter={compactCurrencyFormatter}
          loading={loading}
          data={adminData}
        />
        <MaterialRiskPanel
          loading={loading}
          reservations={snapshot?.inventoryReservations ?? []}
          lowStockItems={snapshot?.lowStockItems ?? []}
          purchaseOrders={snapshot?.purchaseOrders ?? []}
        />
        <CollectionHealthPanel
          currencyFormatter={compactCurrencyFormatter}
          loading={loading}
          data={adminData}
          summary={summary}
        />
        <DocumentsActivityPanel
          loading={loading}
          documents={snapshot?.pendingDocuments ?? []}
          activity={snapshot?.recentActivity ?? []}
        />
      </section>
    </div>
  );
}

type EpcDashboardModel = ReturnType<typeof buildEpcDashboardModel>;

function buildEpcDashboardModel(
  snapshot: EpcAdminDashboardSnapshot | null,
  summary: DashboardSummaryRow,
) {
  const today = startOfLocalDay(new Date());
  const endOfNextWeek = addDays(today, 7);
  const leads = snapshot?.recentLeads ?? [];
  const quotations = snapshot?.quotations ?? [];
  const projects = snapshot?.projects ?? [];
  const paymentSummaries = snapshot?.paymentSummaries ?? [];
  const followups = snapshot?.followups.filter(isActiveFollowup) ?? [];
  const surveys = snapshot?.upcomingSurveys ?? [];
  const reservations = snapshot?.inventoryReservations ?? [];
  const purchaseOrders = snapshot?.purchaseOrders ?? [];
  const activeLeadStatuses = new Set([
    "new",
    "contacted",
    "site_visit_scheduled",
    "qualified",
    "quotation_sent",
  ]);
  const completedProjectStatuses = new Set([
    "installation_completed",
    "inspection_completed",
    "commissioned",
    "cancelled",
  ]);

  const activeLeads = leads.filter((lead) => activeLeadStatuses.has(lead.status ?? ""));
  const newLeadsThisMonth = leads.filter((lead) =>
    isSameMonth(lead.created_at, today),
  ).length;
  const sentQuotations = quotations.filter((quotation) => quotation.status === "sent");
  const acceptedQuotations = quotations.filter(
    (quotation) => quotation.status === "accepted",
  );
  const rejectedQuotations = quotations.filter((quotation) =>
    ["rejected", "expired"].includes(quotation.status ?? ""),
  );
  const awaitingQuotations = sentQuotations.filter(
    (quotation) => !quotation.accepted_at && !quotation.rejected_at,
  );
  const decisionQuotationCount =
    sentQuotations.length + acceptedQuotations.length + rejectedQuotations.length;
  const quoteAcceptanceRate =
    decisionQuotationCount > 0
      ? Math.round((acceptedQuotations.length / decisionQuotationCount) * 100)
      : 0;
  const activeProjects = projects.filter(
    (project) => !completedProjectStatuses.has(project.project_status ?? ""),
  );
  const delayedProjects = activeProjects.filter(
    (project) =>
      Boolean(project.expected_completion_date) &&
      startOfLocalDay(new Date(`${project.expected_completion_date}T00:00:00`)) <
        today,
  );
  const overduePaymentSummaries = paymentSummaries.filter(
    (row) => row.payment_status === "overdue" && Number(row.balance_due ?? 0) > 0,
  );
  const overdueAmount = overduePaymentSummaries.reduce(
    (total, row) => total + Number(row.balance_due ?? 0),
    0,
  );
  const receivedTotal = Number(summary.total_received_amount ?? 0);
  const dueTotal = Number(summary.total_balance_due ?? 0);
  const collectionEfficiency =
    receivedTotal + dueTotal > 0
      ? Math.round((receivedTotal / (receivedTotal + dueTotal)) * 100)
      : 0;
  const shortageReservations = reservations.filter(
    (reservation) => Number(reservation.shortage_qty ?? 0) > 0,
  );
  const todayFollowups = followups
    .filter((followup) => classifyFollowupDueDate(followup) === "today")
    .sort(sortFollowupsByDueDate);
  const overdueFollowups = followups
    .filter((followup) => classifyFollowupDueDate(followup) === "overdue")
    .sort(sortFollowupsByDueDate);
  const pendingSurveyReports = surveys.filter(
    (survey) => survey.survey_status === "completed" && !survey.completed_at,
  ).length;

  const pipelineRows = [
    {
      label: "New Enquiries",
      count: leads.filter((lead) => lead.status === "new").length,
      value: sumLeadValue(leads.filter((lead) => lead.status === "new")),
      tone: "blue",
    },
    {
      label: "Site Survey Scheduled",
      count: leads.filter((lead) => lead.status === "site_visit_scheduled").length,
      value: sumLeadValue(
        leads.filter((lead) => lead.status === "site_visit_scheduled"),
      ),
      tone: "violet",
    },
    {
      label: "Quotation Sent",
      count: sentQuotations.length,
      value: sumQuotationValue(sentQuotations),
      tone: "orange",
    },
    {
      label: "Negotiation",
      count: leads.filter((lead) => lead.status === "qualified").length,
      value: sumLeadValue(leads.filter((lead) => lead.status === "qualified")),
      tone: "amber",
    },
    {
      label: "Won",
      count: acceptedQuotations.length,
      value: sumQuotationValue(acceptedQuotations),
      tone: "green",
    },
    {
      label: "Lost",
      count:
        leads.filter((lead) => lead.status === "lost").length +
        rejectedQuotations.length,
      value:
        sumLeadValue(leads.filter((lead) => lead.status === "lost")) +
        sumQuotationValue(rejectedQuotations),
      tone: "slate",
    },
  ];

  const projectStageRows = [
    stageRow("Site Survey Pending", ["created"], projects),
    stageRow("Design / Proposal", ["inspection_pending"], projects),
    stageRow("Material Procurement", ["material_pending"], projects),
    stageRow("Installation Scheduled", ["installation_scheduled"], projects),
    stageRow("Installation In Progress", ["installation_in_progress"], projects),
    stageRow("Net Metering / DISCOM", ["net_metering_pending"], projects),
    stageRow("Handover Pending", ["inspection_completed"], projects),
  ];
  const monthlyRows = buildMonthlyRows(
    quotations,
    projects,
    snapshot?.recentPayments ?? [],
    paymentSummaries,
  );
  const activeProjectValue =
    paymentSummaries.reduce(
      (total, row) => total + Number(row.total_project_amount ?? 0),
      0,
    ) || Number(summary.total_project_value ?? 0);
  const activeCapacityKw = activeProjects.reduce(
    (total, project) => total + Number(project.system_capacity_kw ?? 0),
    0,
  );
  const pipelineValue =
    sumLeadValue(activeLeads) ||
    pipelineRows.reduce((total, row) => total + row.value, 0);

  const scheduleRows = [
    ...surveys
      .filter((survey) => dateInRange(survey.scheduled_date, today, endOfNextWeek))
      .map((survey) => ({
        date: scheduleDateLabel(survey.scheduled_date, today),
        activity: "Site Survey",
        project: getSurveyContact(survey).name,
        to: `/site-surveys/${survey.id}`,
      })),
    ...purchaseOrders
      .filter((order) =>
        dateInRange(order.expected_delivery_date, today, endOfNextWeek),
      )
      .map((order) => ({
        date: scheduleDateLabel(order.expected_delivery_date, today),
        activity: "Material Delivery",
        project: order.vendor?.vendor_name ?? order.purchase_code ?? "Purchase order",
        to: "/purchases",
      })),
    ...activeProjects
      .filter((project) =>
        dateInRange(project.expected_completion_date, today, endOfNextWeek),
      )
      .map((project) => ({
        date: scheduleDateLabel(project.expected_completion_date, today),
        activity: "Project Milestone",
        project: project.project_name ?? project.project_code ?? "Project",
        to: `/projects/${project.id}`,
      })),
  ].slice(0, 6);

  return {
    activeCapacityKw,
    activeLeads,
    activeProjects,
    activeProjectValue,
    acceptedQuotations,
    awaitingQuotations,
    collectionEfficiency,
    decisionQuotationCount,
    delayedProjects,
    newLeadsThisMonth,
    overdueAmount,
    overdueFollowups,
    overduePaymentSummaries,
    pendingSurveyReports,
    pipelineRows,
    pipelineValue,
    projectStageRows,
    quoteAcceptanceRate,
    quotedValue: sumQuotationValue(quotations),
    scheduleRows,
    sentQuotations,
    shortageReservations,
    surveyCompleted: surveys.filter((survey) => survey.survey_status === "completed")
      .length,
    surveyScheduled: surveys.filter((survey) =>
      ["scheduled", "in_progress", "rescheduled"].includes(
        survey.survey_status ?? "",
      ),
    ).length,
    todayFollowups,
    urgentActions:
      todayFollowups.length +
      overdueFollowups.length +
      delayedProjects.length +
      shortageReservations.length +
      overduePaymentSummaries.length,
    monthlyRows,
  };
}

function QuickAction({ to, label }: { to: string; label: string }) {
  return (
    <Link
      className="inline-flex min-h-8 items-center justify-center rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs font-semibold leading-none text-[#06173f] transition hover:border-orange-200 hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      to={to}
    >
      {label}
    </Link>
  );
}

function HealthSignal({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  tone: "rose" | "amber" | "blue" | "violet";
  loading: boolean;
}) {
  const toneClass = {
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];

  return (
    <article className="rounded-lg border border-stone-100 bg-stone-50 p-2.5 sm:p-3">
      {loading ? (
        <div className="h-12 animate-pulse rounded-md bg-white" />
      ) : (
        <div className="flex items-center gap-2 sm:gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold sm:h-10 sm:w-10 sm:text-lg ${toneClass}`}>
            {value}
          </span>
          <p className="min-w-0 text-xs font-semibold leading-4 text-slate-800 sm:text-sm sm:leading-5">
            {label}
          </p>
        </div>
      )}
    </article>
  );
}

function CommandMetricCard({
  label,
  value,
  detail,
  trend,
  visual,
  warning = false,
  loading,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  trend: string;
  visual?: ReactNode;
  warning?: boolean;
  loading: boolean;
}) {
  return (
    <article
      className={`rounded-lg border bg-white p-3 shadow-sm sm:p-4 ${
        warning ? "border-rose-100" : "border-stone-200"
      }`}
    >
      <p className="min-h-8 text-xs font-semibold leading-4 text-slate-700 sm:min-h-0 sm:text-sm">
        {label}
      </p>
      {loading ? (
        <div className="mt-3 h-20 animate-pulse rounded-lg bg-stone-100 sm:mt-4 sm:h-16" />
      ) : (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_3.25rem] items-end gap-2 sm:mt-3 sm:grid-cols-[minmax(0,1fr)_4.5rem] sm:gap-3">
          <div className="min-w-0">
            <p className="text-xl font-semibold text-slate-950 sm:text-2xl">{value}</p>
            <p className="mt-1 text-xs leading-4 text-slate-600 sm:mt-2 sm:text-sm">
              {detail}
            </p>
            <p className={`mt-1 text-[11px] font-semibold leading-4 sm:text-xs ${warning ? "text-rose-600" : "text-emerald-700"}`}>
              {trend}
            </p>
          </div>
          <div className="flex h-12 items-end justify-end overflow-hidden sm:h-16">
            {visual}
          </div>
        </div>
      )}
    </article>
  );
}

function AdminPanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950 sm:text-base">{title}</h2>
        {action}
      </div>
      <div className="mt-3 sm:mt-4">{children}</div>
    </section>
  );
}

function SalesPipelinePanel({
  rows,
  loading,
  currencyFormatter,
}: {
  rows: EpcDashboardModel["pipelineRows"];
  loading: boolean;
  currencyFormatter: Intl.NumberFormat;
}) {
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <AdminPanel
      title="Sales Pipeline"
      action={<Link className="text-sm font-semibold text-[#06173f]" to="/leads">View pipeline</Link>}
    >
      {loading ? <LoadingRows /> : null}
      {!loading && rows.every((row) => row.count === 0) ? (
        <GuidedEmptyState to="/leads" action="Add Lead">
          No leads or quotations yet. Start by adding a lead so the pipeline can show real movement.
        </GuidedEmptyState>
      ) : null}
      {!loading && rows.some((row) => row.count > 0) ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2 rounded-lg border border-stone-100 bg-stone-50 p-2.5 sm:grid-cols-[minmax(0,1fr)_3rem_5rem] sm:p-3"
              key={row.label}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800 sm:text-sm">
                  {row.label}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full rounded-full ${pipelineTone(row.tone)}`}
                    style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }}
                  />
                </div>
              </div>
              <p className="text-right text-sm font-semibold text-slate-950 sm:text-left">
                {row.count}
              </p>
              <p className="col-span-2 text-xs font-semibold text-slate-700 sm:col-span-1 sm:text-sm">
                {currencyFormatter.format(row.value)}
              </p>
            </div>
          ))}
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 sm:text-sm">
            Bottleneck: {rows.find((row) => row.label === "Quotation Sent")?.count ?? 0} quotations need active follow-up.
          </p>
        </div>
      ) : null}
    </AdminPanel>
  );
}

function ProjectExecutionPanel({
  rows,
  loading,
}: {
  rows: EpcDashboardModel["projectStageRows"];
  loading: boolean;
}) {
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <AdminPanel
      title="Project Execution"
      action={<Link className="text-sm font-semibold text-[#06173f]" to="/projects">View all</Link>}
    >
      {loading ? <LoadingRows /> : null}
      {!loading && rows.every((row) => row.count === 0) ? (
        <GuidedEmptyState to="/projects" action="Open Projects">
          No active project stages yet. Accepted quotations can be converted into projects.
        </GuidedEmptyState>
      ) : null}
      {!loading && rows.some((row) => row.count > 0) ? (
        <div className="space-y-2.5 sm:space-y-3">
          {rows.map((row, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-3" key={row.label}>
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold text-slate-700 sm:text-sm">
                    <StageMarker index={index} />
                    <span className="truncate">{row.label}</span>
                  </p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }}
                  />
                </div>
              </div>
              <p className="text-right text-sm font-semibold text-slate-950">
                {row.count}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </AdminPanel>
  );
}

function RevenueCollectionPanel({
  rows,
  loading,
  currencyFormatter,
}: {
  rows: EpcDashboardModel["monthlyRows"];
  loading: boolean;
  currencyFormatter: Intl.NumberFormat;
}) {
  const maxValue = Math.max(
    ...rows.flatMap((row) => [
      row.quotationValue,
      row.projectValue,
      row.receivedAmount,
      row.balanceDue,
    ]),
    1,
  );

  return (
    <AdminPanel title="Revenue & Collection Overview">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600 sm:gap-3 sm:text-xs">
            <Legend color="bg-blue-500" label="Quotation" />
            <Legend color="bg-violet-500" label="Project" />
            <Legend color="bg-emerald-500" label="Received" />
            <Legend color="bg-orange-500" label="Balance" />
          </div>
          <ComboRevenueChart
            currencyFormatter={currencyFormatter}
            maxValue={maxValue}
            rows={rows}
          />
        </div>
      ) : null}
    </AdminPanel>
  );
}

function TodaysWorkPanel({
  followups,
  loading,
}: {
  followups: LeadFollowupWithLead[];
  loading: boolean;
}) {
  return (
    <AdminPanel
      title="Today's Follow-ups"
      action={<span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{followups.length}</span>}
    >
      {loading ? <LoadingRows count={3} /> : null}
      {!loading && followups.length === 0 ? (
        <GuidedEmptyState to="/leads" action="Review Enquiries">
          Nothing due today. Schedule follow-ups on active leads to keep sales moving.
        </GuidedEmptyState>
      ) : null}
      {!loading && followups.length > 0 ? (
        <div className="space-y-2">
          {followups.slice(0, 5).map((followup, index) => (
            <Link
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-stone-100 bg-stone-50 p-2.5 hover:bg-orange-50 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:gap-3 sm:p-3"
              key={followup.id}
              to={`/leads/${followup.lead_id}`}
            >
              <span className="text-sm font-semibold text-[#06173f]">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {followup.lead?.full_name ?? "Lead follow-up"}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {formatDateTime(getFollowupDueDate(followup))}
                </span>
              </span>
              <span className="col-span-2 text-xs font-semibold text-slate-600 sm:col-span-1">
                {labelize(followup.followup_type)}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </AdminPanel>
  );
}

function OverduePanel({
  loading,
  overdueFollowups,
  pendingSurveyReports,
  overdueAmount,
  delayedProjects,
  currencyFormatter,
}: {
  loading: boolean;
  overdueFollowups: number;
  pendingSurveyReports: number;
  overdueAmount: number;
  delayedProjects: number;
  currencyFormatter: Intl.NumberFormat;
}) {
  const alerts = [
    [`${overdueFollowups} lead follow-ups overdue`, "/leads"],
    [`${pendingSurveyReports} site survey reports pending`, "/site-surveys"],
    [`${currencyFormatter.format(overdueAmount)} payment overdue`, "/payments"],
    [`${delayedProjects} installation/project delayed`, "/projects"],
  ];

  return (
    <AdminPanel title="Overdue & Alerts">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <div className="space-y-2">
          {alerts.map(([label, to]) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-orange-50 sm:text-sm"
              key={label}
              to={to}
            >
              <span>{label}</span>
              <span className="text-[#06173f]">Open</span>
            </Link>
          ))}
        </div>
      ) : null}
    </AdminPanel>
  );
}

function SchedulePanel({
  rows,
  loading,
}: {
  rows: EpcDashboardModel["scheduleRows"];
  loading: boolean;
}) {
  return (
    <AdminPanel
      title="Upcoming Schedule"
      action={<Link className="text-sm font-semibold text-[#06173f]" to="/site-surveys">View calendar</Link>}
    >
      {loading ? <LoadingRows count={4} /> : null}
      {!loading && rows.length === 0 ? (
        <GuidedEmptyState to="/site-surveys" action="Schedule Work">
          No scheduled work in the next 7 days.
        </GuidedEmptyState>
      ) : null}
      {!loading && rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link
              className="grid gap-1 rounded-lg border border-stone-100 bg-stone-50 p-2.5 text-xs hover:bg-orange-50 sm:grid-cols-[5rem_minmax(0,1fr)] sm:p-3 sm:text-sm"
              key={`${row.date}-${row.activity}-${row.project}`}
              to={row.to}
            >
              <span className="font-semibold text-slate-500">{row.date}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-900">
                  {row.activity}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {row.project}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </AdminPanel>
  );
}

function SurveyStatusPanel({
  loading,
  data,
}: {
  loading: boolean;
  data: EpcDashboardModel;
}) {
  const total = data.surveyScheduled + data.surveyCompleted + data.pendingSurveyReports;
  const surveyRows = [
    { label: "Scheduled", value: data.surveyScheduled, color: "#2563eb" },
    { label: "Completed", value: data.surveyCompleted, color: "#10b981" },
    { label: "Report Pending", value: data.pendingSurveyReports, color: "#f59e0b" },
  ];

  return (
    <AdminPanel title="Site Survey Status">
      {loading ? <LoadingRows count={3} /> : null}
      {!loading ? (
        <div className="grid gap-4 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-center xl:grid-cols-1">
          <MultiDonutChart centerLabel={String(total)} rows={surveyRows} />
          <SmallStatList
            rows={[
              ["Scheduled", data.surveyScheduled],
              ["Completed", data.surveyCompleted],
              ["Report Pending", data.pendingSurveyReports],
              ["Avg. survey-to-quote", total > 0 ? "Track next" : "-"],
            ]}
          />
        </div>
      ) : null}
    </AdminPanel>
  );
}

function QuotationInsightsPanel({
  loading,
  data,
  currencyFormatter,
}: {
  loading: boolean;
  data: EpcDashboardModel;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <AdminPanel title="Quotation Insights">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <div className="space-y-4">
          <GaugeChart
            label="Acceptance"
            percent={data.quoteAcceptanceRate}
            tone="#10b981"
          />
          <SmallStatList
            rows={[
              ["Total Sent", data.sentQuotations.length],
              ["Accepted Value", currencyFormatter.format(sumQuotationValue(data.acceptedQuotations))],
              ["Awaiting Response", data.awaitingQuotations.length],
              ["Acceptance Rate", `${data.quoteAcceptanceRate}%`],
            ]}
          />
        </div>
      ) : null}
    </AdminPanel>
  );
}

function MaterialRiskPanel({
  loading,
  reservations,
  lowStockItems,
  purchaseOrders,
}: {
  loading: boolean;
  reservations: EpcAdminDashboardSnapshot["inventoryReservations"];
  lowStockItems: InventoryItem[];
  purchaseOrders: PurchaseOrderWithRelations[];
}) {
  const shortages = reservations.filter(
    (reservation) => Number(reservation.shortage_qty ?? 0) > 0,
  );
  const reservedValue = reservations.reduce(
    (total, reservation) => total + Number(reservation.reserved_qty ?? 0),
    0,
  );
  const riskRows = [
    { label: "BOM unavailable", value: shortages.length, color: "#ef4444" },
    { label: "Low stock", value: lowStockItems.length, color: "#f59e0b" },
    { label: "Pending POs", value: purchaseOrders.length, color: "#2563eb" },
    { label: "Reserved qty", value: reservedValue, color: "#7c3aed" },
  ];

  return (
    <AdminPanel title="Material Risk">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <>
          <HorizontalBarSet rows={riskRows} />
          <SmallStatList
            rows={[
              ["BOM items unavailable", shortages.length],
              ["Low stock items", lowStockItems.length],
              ["Pending purchase orders", purchaseOrders.length],
              ["Reserved quantity", reservedValue.toLocaleString("en-IN")],
            ]}
          />
          {shortages.slice(0, 3).length > 0 ? (
            <div className="mt-3 space-y-2">
              {shortages.slice(0, 3).map((reservation) => (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800" key={reservation.id}>
                  {materialReservationLabel(reservation)}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </AdminPanel>
  );
}

function CollectionHealthPanel({
  loading,
  data,
  summary,
  currencyFormatter,
}: {
  loading: boolean;
  data: EpcDashboardModel;
  summary: DashboardSummaryRow;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <AdminPanel title="Collection Health">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <div className="space-y-4">
          <CollectionMeter percent={data.collectionEfficiency} />
          <SmallStatList
            rows={[
              ["Received", currencyFormatter.format(summary.total_received_amount)],
              ["Outstanding", currencyFormatter.format(summary.total_balance_due)],
              ["Overdue", currencyFormatter.format(data.overdueAmount)],
              ["Efficiency", `${data.collectionEfficiency}%`],
            ]}
          />
        </div>
      ) : null}
    </AdminPanel>
  );
}

function DocumentsActivityPanel({
  loading,
  documents,
  activity,
}: {
  loading: boolean;
  documents: OrganizationDocumentWithRelations[];
  activity: EpcAdminDashboardSnapshot["recentActivity"];
}) {
  return (
    <AdminPanel title="Documents & Activity">
      {loading ? <LoadingRows count={4} /> : null}
      {!loading ? (
        <div className="space-y-4">
          <DocumentMiniChart
            rows={[
              { label: "KYC", value: documents.filter((doc) => ["aadhaar", "pan"].includes(doc.document_type)).length, color: "#ef4444" },
              { label: "Bills", value: documents.filter((doc) => doc.document_type === "electricity_bill").length, color: "#f97316" },
              { label: "Photos", value: documents.filter((doc) => doc.document_type === "site_photo").length, color: "#2563eb" },
              { label: "Approvals", value: documents.filter((doc) => doc.document_type === "subsidy_document").length, color: "#10b981" },
            ]}
          />
          <SmallStatList
            rows={[
              ["KYC / Customer Docs", documents.filter((doc) => ["aadhaar", "pan"].includes(doc.document_type)).length],
              ["Electricity Bills", documents.filter((doc) => doc.document_type === "electricity_bill").length],
              ["Site Photos", documents.filter((doc) => doc.document_type === "site_photo").length],
              ["Net Metering Docs", documents.filter((doc) => doc.document_type === "subsidy_document").length],
            ]}
          />
          <div className="space-y-2">
            {activity.slice(0, 3).map((item) => (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-slate-600" key={item.id}>
                <span className="font-semibold text-slate-900">
                  {labelize(item.module)} / {labelize(item.action)}
                </span>{" "}
                {formatDateTime(item.created_at)}
              </p>
            ))}
            {activity.length === 0 ? (
              <p className="text-sm leading-6 text-slate-600">No recent activity yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </AdminPanel>
  );
}

function SmallStatList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 last:border-b-0 last:pb-0" key={label}>
          <span className="text-sm text-slate-600">{label}</span>
          <span className="text-sm font-semibold text-slate-950">{value}</span>
        </div>
      ))}
    </div>
  );
}

function SolarOperationsBrandGraphic({
  className = "",
  logoUrl,
  organizationName,
}: {
  className?: string;
  logoUrl: string | null;
  organizationName: string;
}) {
  if (logoUrl) {
    return (
      <div className={`h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-orange-100 bg-white shadow-sm sm:h-20 sm:w-36 ${className}`}>
        <img
          alt={`${organizationName} logo`}
          className="h-full w-full object-cover"
          src={logoUrl}
        />
      </div>
    );
  }

  return (
    <div className={`h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 to-blue-50 p-2 sm:h-20 sm:w-36 ${className}`}>
      <svg aria-hidden="true" className="h-full w-full" viewBox="0 0 160 92">
        <path d="M12 70h132" stroke="#cbd5e1" strokeLinecap="round" strokeWidth="4" />
        <path d="M25 63V38l27-18 29 18v25" fill="#e0f2fe" stroke="#0f172a" strokeLinejoin="round" strokeWidth="2" />
        <path d="M45 63V47h15v16" fill="#fdba74" stroke="#0f172a" strokeLinejoin="round" strokeWidth="2" />
        <path d="M60 30h43l12 23H72L60 30Z" fill="#2563eb" stroke="#0f172a" strokeLinejoin="round" strokeWidth="2" />
        <path d="M72 34l10 19M86 34l8 19M101 34l7 19M68 42h41" stroke="#bfdbfe" strokeWidth="2" />
        <circle cx="127" cy="22" fill="#f59e0b" r="9" />
        <path d="M127 6v7M127 31v7M111 22h7M136 22h7M116 11l5 5M133 28l5 5M138 11l-5 5M121 28l-5 5" stroke="#f59e0b" strokeLinecap="round" strokeWidth="2" />
        <path d="M20 70c1-14 8-20 16-20s15 6 16 20" fill="#22c55e" opacity="0.8" />
        <path d="M116 70c1-10 6-15 12-15s11 5 12 15" fill="#22c55e" opacity="0.75" />
      </svg>
    </div>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const normalizedValues = values.length > 0 ? values : [0];
  const maxValue = Math.max(...normalizedValues, 1);
  const points = normalizedValues.map((value, index) => {
    const x =
      normalizedValues.length === 1
        ? 4
        : 4 + (index / (normalizedValues.length - 1)) * 64;
    const y = 48 - (Number(value) / maxValue) * 38;
    return `${x},${Number.isFinite(y) ? y : 48}`;
  });
  const areaPoints = [`4,52`, ...points, `68,52`].join(" ");

  return (
    <svg aria-hidden="true" className="h-12 w-14 sm:h-16 sm:w-20" viewBox="0 0 72 56">
      <polygon fill={color} opacity="0.1" points={areaPoints} />
      <polyline
        fill="none"
        points={points.join(" ")}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <circle cx={points.at(-1)?.split(",")[0] ?? "68"} cy={points.at(-1)?.split(",")[1] ?? "48"} fill={color} r="3" />
    </svg>
  );
}

function MiniDonut({
  percent,
  tone,
}: {
  percent: number;
  tone: "green" | "rose";
}) {
  const clampedPercent = clampPercent(percent);
  const color = tone === "green" ? "#10b981" : "#ef4444";

  return (
    <svg aria-hidden="true" className="h-12 w-12 -rotate-90 sm:h-16 sm:w-16" viewBox="0 0 44 44">
      <circle cx="22" cy="22" fill="none" r="16" stroke="#e5e7eb" strokeWidth="7" />
      <circle
        cx="22"
        cy="22"
        fill="none"
        pathLength="100"
        r="16"
        stroke={color}
        strokeDasharray={`${clampedPercent} ${100 - clampedPercent}`}
        strokeLinecap="round"
        strokeWidth="7"
      />
    </svg>
  );
}

function StageMarker({ index }: { index: number }) {
  const colors = [
    "bg-blue-500",
    "bg-violet-500",
    "bg-orange-500",
    "bg-amber-500",
    "bg-blue-500",
    "bg-emerald-500",
    "bg-rose-500",
  ];

  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${colors[index % colors.length]}`}
    >
      {index + 1}
    </span>
  );
}

function ComboRevenueChart({
  rows,
  maxValue,
  currencyFormatter,
}: {
  rows: EpcDashboardModel["monthlyRows"];
  maxValue: number;
  currencyFormatter: Intl.NumberFormat;
}) {
  const linePoints = rows.map((row, index) => {
    const x = rows.length === 1 ? 24 : 24 + (index / (rows.length - 1)) * 312;
    const y = 146 - (Number(row.balanceDue) / maxValue) * 120;
    return `${x},${Number.isFinite(y) ? y : 146}`;
  });

  return (
    <div className="relative min-h-52 overflow-hidden rounded-lg bg-stone-50 p-3">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-3 h-32 w-[calc(100%-1.5rem)] sm:h-40" viewBox="0 0 360 160" preserveAspectRatio="none">
        {[32, 64, 96, 128].map((y) => (
          <line key={y} stroke="#e7e5e4" strokeWidth="1" x1="0" x2="360" y1={y} y2={y} />
        ))}
        <polyline
          fill="none"
          points={linePoints.join(" ")}
          stroke="#f97316"
          strokeDasharray="5 5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </svg>
      <div className="relative grid min-h-36 grid-cols-6 items-end gap-1 pt-2 sm:min-h-44 sm:gap-2">
        {rows.map((row) => (
          <div className="flex min-w-0 flex-col items-center gap-2" key={row.label}>
            <div className="grid h-28 w-full grid-cols-3 items-end gap-0.5 sm:h-36 sm:gap-1">
              {[
                ["bg-blue-500", row.quotationValue],
                ["bg-violet-500", row.projectValue],
                ["bg-emerald-500", row.receivedAmount],
              ].map(([color, value], index) => (
                <div
                  className={`${color} min-h-1 rounded-t`}
                  key={`${row.label}-${index}`}
                  title={currencyFormatter.format(Number(value))}
                  style={{
                    height: `${Math.max((Number(value) / maxValue) * 100, Number(value) > 0 ? 8 : 1)}%`,
                  }}
                />
              ))}
            </div>
            <p className="truncate text-xs font-medium text-slate-500">{row.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiDonutChart({
  rows,
  centerLabel,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
}) {
  const total = Math.max(rows.reduce((sum, row) => sum + row.value, 0), 1);
  let offset = 0;

  return (
    <svg aria-label="Survey status chart" className="h-28 w-28" viewBox="0 0 90 90">
      <circle cx="45" cy="45" fill="none" pathLength="100" r="32" stroke="#e5e7eb" strokeWidth="12" />
      {rows.map((row) => {
        const length = (row.value / total) * 100;
        const segment = (
          <circle
            key={row.label}
            cx="45"
            cy="45"
            fill="none"
            pathLength="100"
            r="32"
            stroke={row.color}
            strokeDasharray={`${length} ${100 - length}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            strokeWidth="12"
            transform="rotate(-90 45 45)"
          />
        );
        offset += length;
        return segment;
      })}
      <text fill="#0f172a" fontSize="16" fontWeight="700" textAnchor="middle" x="45" y="42">
        {centerLabel}
      </text>
      <text fill="#64748b" fontSize="8" fontWeight="600" textAnchor="middle" x="45" y="54">
        total
      </text>
    </svg>
  );
}

function GaugeChart({
  percent,
  label,
  tone,
}: {
  percent: number;
  label: string;
  tone: string;
}) {
  const clampedPercent = clampPercent(percent);

  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <svg aria-label={`${label} gauge`} className="h-24 w-full" viewBox="0 0 160 90">
        <path d="M25 78a55 55 0 0 1 110 0" fill="none" stroke="#e5e7eb" strokeLinecap="round" strokeWidth="14" />
        <path
          d="M25 78a55 55 0 0 1 110 0"
          fill="none"
          pathLength="100"
          stroke={tone}
          strokeDasharray={`${clampedPercent} ${100 - clampedPercent}`}
          strokeLinecap="round"
          strokeWidth="14"
        />
        <text fill="#0f172a" fontSize="20" fontWeight="700" textAnchor="middle" x="80" y="66">
          {clampedPercent}%
        </text>
        <text fill="#64748b" fontSize="10" fontWeight="600" textAnchor="middle" x="80" y="82">
          {label}
        </text>
      </svg>
    </div>
  );
}

function HorizontalBarSet({
  rows,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="mb-4 space-y-2 rounded-lg bg-stone-50 p-3">
      {rows.map((row) => (
        <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2" key={row.label}>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-600">{row.label}</p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: row.color,
                  width: `${Math.max((row.value / maxValue) * 100, row.value > 0 ? 8 : 1)}%`,
                }}
              />
            </div>
          </div>
          <p className="text-right text-xs font-bold text-slate-950">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function CollectionMeter({ percent }: { percent: number }) {
  const clampedPercent = clampPercent(percent);

  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-semibold text-slate-700">Collection efficiency</p>
        <p className="text-xl font-semibold text-slate-950">{clampedPercent}%</p>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  );
}

function DocumentMiniChart({
  rows,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="grid h-24 grid-cols-4 items-end gap-2 rounded-lg bg-stone-50 p-3">
      {rows.map((row) => (
        <div className="flex min-w-0 flex-col items-center gap-1" key={row.label}>
          <div
            className="w-full rounded-t"
            style={{
              backgroundColor: row.color,
              height: `${Math.max((row.value / maxValue) * 64, row.value > 0 ? 8 : 2)}px`,
            }}
          />
          <span className="truncate text-[10px] font-semibold text-slate-500">
            {row.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function GuidedEmptyState({
  children,
  to,
  action,
}: {
  children: ReactNode;
  to: string;
  action: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-4">
      <p className="text-sm leading-6 text-slate-600">{children}</p>
      <Link
        className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#06173f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b255f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        to={to}
      >
        {action}
      </Link>
    </div>
  );
}

function pipelineTone(tone: string) {
  const tones: Record<string, string> = {
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    orange: "bg-orange-500",
    slate: "bg-slate-400",
    violet: "bg-violet-500",
  };

  return tones[tone] ?? "bg-slate-400";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function sortFollowupsByDueDate(
  left: LeadFollowupWithLead,
  right: LeadFollowupWithLead,
) {
  return (
    new Date(getFollowupDueDate(left)).getTime() -
    new Date(getFollowupDueDate(right)).getTime()
  );
}

function sumLeadValue(leads: Lead[]) {
  return leads.reduce((total, lead) => total + Number(lead.offered_price ?? 0), 0);
}

function sumQuotationValue(quotations: EpcAdminDashboardSnapshot["quotations"]) {
  return quotations.reduce(
    (total, quotation) =>
      total +
      Number(
        quotation.net_payable_amount ??
          quotation.total_amount ??
          quotation.summary_total_turnkey_cost ??
          0,
      ),
    0,
  );
}

function stageRow(
  label: string,
  statuses: string[],
  projects: EpcAdminDashboardSnapshot["projects"],
) {
  const statusSet = new Set(statuses);
  const matchingProjects = projects.filter((project) =>
    statusSet.has(project.project_status ?? ""),
  );

  return {
    label,
    count: matchingProjects.length,
  };
}

function buildMonthlyRows(
  quotations: EpcAdminDashboardSnapshot["quotations"],
  projects: EpcAdminDashboardSnapshot["projects"],
  payments: PaymentWithRelations[],
  paymentSummaries: EpcAdminDashboardSnapshot["paymentSummaries"],
) {
  const now = new Date();

  return Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const label = new Intl.DateTimeFormat("en-IN", {
      month: "short",
      year: "2-digit",
    }).format(monthDate);

    return {
      label,
      quotationValue: sumQuotationValue(
        quotations.filter((quotation) =>
          isSameMonth(quotation.quotation_date ?? quotation.created_at, monthDate),
        ),
      ),
      projectValue: sumQuotationValue(
        projects
          .filter((project) => isSameMonth(project.created_at, monthDate))
          .map((project) => project.quotation)
          .filter(Boolean) as EpcAdminDashboardSnapshot["quotations"],
      ),
      receivedAmount: payments
        .filter((payment) => isSameMonth(payment.payment_date ?? payment.created_at, monthDate))
        .reduce((total, payment) => total + Number(payment.amount ?? 0), 0),
      balanceDue: paymentSummaries
        .filter((summaryRow) => isSameMonth(summaryRow.updated_at, monthDate))
        .reduce((total, summaryRow) => total + Number(summaryRow.balance_due ?? 0), 0),
    };
  });
}

function materialReservationLabel(
  reservation: EpcAdminDashboardSnapshot["inventoryReservations"][number],
) {
  const reservationWithProject = reservation as typeof reservation & {
    project?: { project_name: string | null; project_code: string | null; system_capacity_kw: number | null } | null;
  };
  const projectName =
    reservationWithProject.project?.project_name ??
    reservationWithProject.project?.project_code ??
    "Project";
  const itemName =
    reservation.inventory_item?.item_name ??
    reservation.catalog_product?.product_name ??
    "Material";
  const capacity = formatKw(reservationWithProject.project?.system_capacity_kw);

  return `${projectName} / ${capacity} / ${itemName} short`;
}

function startOfLocalDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function isSameMonth(value: string | null | undefined, monthDate: Date) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return (
    date.getFullYear() === monthDate.getFullYear() &&
    date.getMonth() === monthDate.getMonth()
  );
}

function dateInRange(value: string | null | undefined, start: Date, end: Date) {
  if (!value) {
    return false;
  }

  const date = startOfLocalDay(new Date(`${value}T00:00:00`));
  return date >= start && date <= end;
}

function scheduleDateLabel(value: string | null | undefined, today: Date) {
  if (!value) {
    return "-";
  }

  const date = startOfLocalDay(new Date(`${value}T00:00:00`));
  const tomorrow = addDays(today, 1);

  if (date.getTime() === today.getTime()) {
    return "Today";
  }

  if (date.getTime() === tomorrow.getTime()) {
    return "Tomorrow";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function TenantDashboard() {
  const { profile, permissions, organization } = useAuth();
  const [summaryRows, setSummaryRows] = useState<DashboardSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [followups, setFollowups] = useState<LeadFollowupWithLead[]>([]);
  const [upcomingSurveys, setUpcomingSurveys] = useState<SiteSurveyWithRelations[]>(
    [],
  );
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  const [recentPayments, setRecentPayments] = useState<PaymentWithRelations[]>([]);
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<
    OrganizationDocumentWithRelations[]
  >([]);
  const [operationalLoading, setOperationalLoading] = useState(true);
  const [operationalError, setOperationalError] = useState<string | null>(null);

  const canViewLeads = hasPermission(profile, permissions, "leads", "view");
  const canViewSurveys = hasPermission(
    profile,
    permissions,
    "site_surveys",
    "view",
  );
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
  const canViewInventory = hasPermission(
    profile,
    permissions,
    "inventory",
    "view",
  );
  const canViewDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "view",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSummary() {
      try {
        setSummaryLoading(true);
        setSummaryError(null);
        const rows = await fetchDashboardSummary();
        if (isMounted) {
          setSummaryRows(rows);
        }
      } catch (error) {
        if (isMounted) {
          setSummaryError(
            error instanceof Error
              ? error.message
              : "Unable to load dashboard metrics.",
          );
        }
      } finally {
        if (isMounted) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadOperationalData() {
      try {
        setOperationalLoading(true);
        setOperationalError(null);

        const [
          nextFollowups,
          nextSurveys,
          nextLeads,
          nextPayments,
          nextLowStock,
          nextDocuments,
        ] = await Promise.all([
          canViewLeads ? fetchDashboardFollowups(profile) : Promise.resolve([]),
          canViewSurveys
            ? fetchDashboardUpcomingSurveys(profile)
            : Promise.resolve([]),
          canViewLeads ? fetchDashboardRecentLeads(profile) : Promise.resolve([]),
          canViewPayments
            ? fetchDashboardRecentPayments(profile)
            : Promise.resolve([]),
          canViewInventory
            ? fetchDashboardLowStockItems(profile)
            : Promise.resolve([]),
          canViewDocuments
            ? fetchDashboardPendingDocuments(profile)
            : Promise.resolve([]),
        ]);

        if (isMounted) {
          setFollowups(nextFollowups);
          setUpcomingSurveys(nextSurveys);
          setRecentLeads(nextLeads);
          setRecentPayments(nextPayments);
          setLowStockItems(nextLowStock);
          setPendingDocuments(nextDocuments);
        }
      } catch (error) {
        if (isMounted) {
          setOperationalError(
            error instanceof Error
              ? error.message
              : "Unable to load operational widgets.",
          );
        }
      } finally {
        if (isMounted) {
          setOperationalLoading(false);
        }
      }
    }

    void loadOperationalData();

    return () => {
      isMounted = false;
    };
  }, [
    canViewDocuments,
    canViewInventory,
    canViewLeads,
    canViewPayments,
    canViewSurveys,
    profile,
  ]);

  const summary = useMemo(
    () =>
      summaryRows.length > 0
        ? aggregateDashboardSummary(summaryRows)
        : emptyDashboardSummary(),
    [summaryRows],
  );

  const followupBuckets = useMemo(() => {
    const activeFollowups = followups.filter(isActiveFollowup);
    const sortByDueDate = (left: LeadFollowupWithLead, right: LeadFollowupWithLead) =>
      new Date(getFollowupDueDate(left)).getTime() -
      new Date(getFollowupDueDate(right)).getTime();

    return {
      today: activeFollowups
        .filter((followup) => classifyFollowupDueDate(followup) === "today")
        .sort(sortByDueDate),
      overdue: activeFollowups
        .filter((followup) => classifyFollowupDueDate(followup) === "overdue")
        .sort(sortByDueDate),
    };
  }, [followups]);

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

  const metricCards = [
    ["Total Customers", summary.total_customers],
    ["Total Enquiries", summary.total_leads],
    ["Active Projects", summary.active_projects],
    ["Completed Projects", summary.completed_projects],
    ["Pending Site Surveys", summary.pending_site_surveys],
    ["Quotations Sent", summary.quotations_sent],
    ["Quotations Accepted", summary.quotations_accepted],
    ["Total Project Value", currencyFormatter.format(summary.total_project_value)],
    ["Amount Received", currencyFormatter.format(summary.total_received_amount)],
    ["Balance Due", currencyFormatter.format(summary.total_balance_due)],
    ["Low Stock Items", summary.low_stock_items],
    ["Pending Documents", summary.pending_documents],
  ] satisfies Array<[string, ReactNode]>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live solar operations metrics and the work that needs attention now."
      />

      {summaryError ? <ErrorPanel message={summaryError} /> : null}
      {operationalError ? <ErrorPanel message={operationalError} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([label, value]) => (
          <MetricCard
            key={label}
            label={label}
            loading={summaryLoading}
            value={value}
          />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <FollowupWidget
          title="Today's Follow-ups"
          loading={operationalLoading}
          followups={followupBuckets.today}
          emptyText="Nothing due today."
          locked={!canViewLeads}
        />
        <FollowupWidget
          title="Overdue Follow-ups"
          loading={operationalLoading}
          followups={followupBuckets.overdue}
          emptyText="No overdue follow-ups."
          locked={!canViewLeads}
        />
        <SurveyWidget
          loading={operationalLoading}
          surveys={upcomingSurveys}
          locked={!canViewSurveys}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RecentLeadsWidget
          leads={recentLeads}
          loading={operationalLoading}
          locked={!canViewLeads}
        />
        <RecentPaymentsWidget
          currencyFormatter={currencyFormatter}
          loading={operationalLoading}
          locked={!canViewPayments}
          payments={recentPayments}
        />
        <LowStockWidget
          items={lowStockItems}
          loading={operationalLoading}
          locked={!canViewInventory}
        />
        <PendingDocumentsWidget
          documents={pendingDocuments}
          loading={operationalLoading}
          locked={!canViewDocuments}
        />
      </section>
    </div>
  );
}

function PlatformDashboard() {
  const [snapshot, setSnapshot] = useState<PlatformDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSnapshot() {
      try {
        setLoading(true);
        setError(null);
        const nextSnapshot = await fetchPlatformDashboardSnapshot();
        if (isMounted) {
          setSnapshot(nextSnapshot);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load platform dashboard.",
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  const metrics = [
    ["Total EPC Companies", snapshot?.totalCompanies ?? 0],
    ["Active Companies", snapshot?.activeCompanies ?? 0],
    ["Inactive Companies", snapshot?.inactiveCompanies ?? 0],
    ["Pending Admin Setup", snapshot?.pendingAdminSetup ?? 0],
    ["Active EPC Admins", snapshot?.activeAdmins ?? 0],
    ["Total Users", snapshot?.totalUsers ?? 0],
    ["Customers", snapshot?.totalCustomers ?? 0],
    ["Leads", snapshot?.totalLeads ?? 0],
    ["Active Projects", snapshot?.activeProjects ?? 0],
    ["Completed Projects", snapshot?.completedProjects ?? 0],
    ["Pending Surveys", snapshot?.pendingSiteSurveys ?? 0],
    ["Pending Documents", snapshot?.pendingDocuments ?? 0],
  ] satisfies Array<[string, number]>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Dashboard"
        description="Platform-level snapshot across EPC company workspaces, admins, setup status, and activity."
      />

      {error ? <ErrorPanel message={error} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <MetricCard key={label} label={label} loading={loading} value={value} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <WidgetFrame
          title="EPC Companies"
          locked={false}
          action={
            <Link className="text-sm font-semibold text-[#06173f]" to="/companies">
              Open
            </Link>
          }
        >
          {loading ? <LoadingRows count={5} /> : null}
          {!loading && snapshot?.companies.length === 0 ? (
            <EmptyState>No EPC companies invited yet.</EmptyState>
          ) : null}
          {!loading && snapshot && snapshot.companies.length > 0 ? (
            <div className="mt-4 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-100">
              {snapshot.companies.slice(0, 8).map((company) => (
                <Link
                  className="grid gap-3 bg-stone-50 p-3 hover:bg-orange-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  key={company.id}
                  to={`/companies/${company.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950">
                      {company.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {company.slug} / {company.admin?.email ?? "No admin email"}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-700">
                    {labelize(company.status)}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </WidgetFrame>

        <WidgetFrame title="Recent Activity" locked={false}>
          {loading ? <LoadingRows count={5} /> : null}
          {!loading && (snapshot?.recentActivity.length ?? 0) === 0 ? (
            <EmptyState>No platform activity yet.</EmptyState>
          ) : null}
          {!loading && snapshot && snapshot.recentActivity.length > 0 ? (
            <div className="mt-4 space-y-3">
              {snapshot.recentActivity.map((activity) => (
                <article
                  className="rounded-lg border border-stone-100 bg-stone-50 p-3"
                  key={activity.id}
                >
                  <p className="text-sm font-semibold text-slate-950">
                    {labelize(activity.module)} / {labelize(activity.action)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(activity.created_at)}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </WidgetFrame>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
}) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      {loading ? (
        <div className="mt-3 h-8 w-28 animate-pulse rounded-md bg-stone-100" />
      ) : (
        <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      )}
    </article>
  );
}

function WidgetFrame({
  title,
  action,
  locked,
  children,
}: {
  title: string;
  action?: ReactNode;
  locked: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {action}
      </div>
      {locked ? (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          You do not have permission to view this operational data.
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-stone-100" />
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-sm leading-6 text-slate-600">{children}</p>;
}

function FollowupWidget({
  title,
  loading,
  followups,
  emptyText,
  locked,
}: {
  title: string;
  loading: boolean;
  followups: LeadFollowupWithLead[];
  emptyText: string;
  locked: boolean;
}) {
  return (
    <WidgetFrame
      title={title}
      locked={locked}
      action={
        !locked ? (
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {followups.length}
          </span>
        ) : null
      }
    >
      {loading ? <LoadingRows count={3} /> : null}
      {!loading && followups.length === 0 ? <EmptyState>{emptyText}</EmptyState> : null}
      {!loading && followups.length > 0 ? (
        <div className="mt-4 space-y-3">
          {followups.slice(0, 5).map((followup) => (
            <Link
              key={followup.id}
              className="block rounded-lg border border-stone-100 bg-stone-50 p-3 hover:border-orange-100"
              to={`/leads/${followup.lead_id}`}
            >
              <p className="text-sm font-semibold text-slate-950">
                {followup.lead?.full_name ?? "Lead follow-up"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(getFollowupDueDate(followup))}
              </p>
            </Link>
          ))}
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function SurveyWidget({
  loading,
  surveys,
  locked,
}: {
  loading: boolean;
  surveys: SiteSurveyWithRelations[];
  locked: boolean;
}) {
  return (
    <WidgetFrame
      title="Upcoming Site Surveys"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-[#06173f]" to="/site-surveys">
            Open
          </Link>
        ) : null
      }
    >
      {loading ? <LoadingRows count={3} /> : null}
      {!loading && surveys.length === 0 ? (
        <EmptyState>No upcoming site surveys.</EmptyState>
      ) : null}
      {!loading && surveys.length > 0 ? (
        <div className="mt-4 space-y-3">
          {surveys.map((survey) => {
            const contact = getSurveyContact(survey);
            return (
              <Link
                key={survey.id}
                className="block rounded-lg border border-stone-100 bg-stone-50 p-3 hover:border-orange-100"
                to={`/site-surveys/${survey.id}`}
              >
                <p className="text-sm font-semibold text-slate-950">
                  {contact.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(survey.scheduled_date)}
                  {survey.scheduled_time ? ` at ${survey.scheduled_time.slice(0, 5)}` : ""}
                </p>
              </Link>
            );
          })}
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function RecentLeadsWidget({
  leads,
  loading,
  locked,
}: {
  leads: Lead[];
  loading: boolean;
  locked: boolean;
}) {
  return (
    <WidgetFrame
      title="Recent Enquiries"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-[#06173f]" to="/leads">
            Open
          </Link>
        ) : null
      }
    >
      {loading ? <LoadingRows /> : null}
      {!loading && leads.length === 0 ? <EmptyState>No leads yet.</EmptyState> : null}
      {!loading && leads.length > 0 ? (
        <ListTable
          rows={leads.map((lead) => ({
            key: lead.id,
            to: `/leads/${lead.id}`,
            title: lead.full_name,
            meta: `${lead.phone} - ${labelize(lead.status)}`,
            value: formatDate(lead.created_at),
          }))}
        />
      ) : null}
    </WidgetFrame>
  );
}

function RecentPaymentsWidget({
  payments,
  loading,
  locked,
  currencyFormatter,
}: {
  payments: PaymentWithRelations[];
  loading: boolean;
  locked: boolean;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <WidgetFrame
      title="Recent Payments"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-[#06173f]" to="/payments">
            Open
          </Link>
        ) : null
      }
    >
      {loading ? <LoadingRows /> : null}
      {!loading && payments.length === 0 ? (
        <EmptyState>No payment activity yet.</EmptyState>
      ) : null}
      {!loading && payments.length > 0 ? (
        <ListTable
          rows={payments.map((payment) => ({
            key: payment.id,
            to: `/payments/${payment.id}`,
            title:
              payment.customer?.full_name ??
              payment.project?.project_name ??
              "Payment",
            meta: `${labelize(payment.payment_source)} - ${formatDate(
              payment.payment_date,
            )}`,
            value: currencyFormatter.format(Number(payment.amount ?? 0)),
          }))}
        />
      ) : null}
    </WidgetFrame>
  );
}

function LowStockWidget({
  items,
  loading,
  locked,
}: {
  items: InventoryItem[];
  loading: boolean;
  locked: boolean;
}) {
  return (
    <WidgetFrame
      title="Low Stock Alert"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-[#06173f]" to="/inventory">
            Open
          </Link>
        ) : null
      }
    >
      {loading ? <LoadingRows /> : null}
      {!loading && items.length === 0 ? (
        <EmptyState>No low stock items.</EmptyState>
      ) : null}
      {!loading && items.length > 0 ? (
        <ListTable
          rows={items.map((item) => ({
            key: item.id,
            to: `/inventory/${item.id}`,
            title: item.item_name,
            meta: item.item_code ?? labelize(item.item_category),
            value: `${formatStock(item.current_stock, item.unit)} / min ${formatStock(
              item.minimum_stock,
              item.unit,
            )}`,
          }))}
        />
      ) : null}
    </WidgetFrame>
  );
}

function PendingDocumentsWidget({
  documents,
  loading,
  locked,
}: {
  documents: OrganizationDocumentWithRelations[];
  loading: boolean;
  locked: boolean;
}) {
  return (
    <WidgetFrame
      title="Pending Document Verification"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-[#06173f]" to="/projects">
            Open
          </Link>
        ) : null
      }
    >
      {loading ? <LoadingRows /> : null}
      {!loading && documents.length === 0 ? (
        <EmptyState>No documents need verification.</EmptyState>
      ) : null}
      {!loading && documents.length > 0 ? (
        <ListTable
          rows={documents.map((document) => ({
            key: document.id,
            to: document.project_id ? `/projects/${document.project_id}` : "/projects",
            title: document.document_name,
            meta: `${documentRelatedLabel(document)} - ${labelize(document.status)}`,
            value: formatDate(document.created_at),
          }))}
        />
      ) : null}
    </WidgetFrame>
  );
}

function ListTable({
  rows,
}: {
  rows: Array<{
    key: string;
    to: string;
    title: string;
    meta: string;
    value: ReactNode;
  }>;
}) {
  return (
    <div className="mt-4 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-100">
      {rows.map((row) => (
        <Link
          key={row.key}
          to={row.to}
          className="grid gap-2 bg-stone-50 p-3 hover:bg-orange-50 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-950">
              {row.title}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {row.meta}
            </span>
          </span>
          <span className="text-sm font-semibold text-slate-700">{row.value}</span>
        </Link>
      ))}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
      {message}
    </section>
  );
}
