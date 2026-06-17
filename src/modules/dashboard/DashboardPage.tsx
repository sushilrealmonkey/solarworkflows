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
  type DashboardSummaryRow,
} from "./dashboardApi";

export function DashboardPage() {
  const { profile } = useAuth();

  if (profile?.is_super_admin) {
    return <PlatformDashboard />;
  }

  return <TenantDashboard />;
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
    ["Total Leads", summary.total_leads],
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
            <Link className="text-sm font-semibold text-brand-700" to="/companies">
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
                  className="grid gap-3 bg-stone-50 p-3 hover:bg-brand-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
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
              className="block rounded-lg border border-stone-100 bg-stone-50 p-3 hover:border-brand-100"
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
          <Link className="text-sm font-semibold text-brand-700" to="/site-surveys">
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
                className="block rounded-lg border border-stone-100 bg-stone-50 p-3 hover:border-brand-100"
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
      title="Recent Leads"
      locked={locked}
      action={
        !locked ? (
          <Link className="text-sm font-semibold text-brand-700" to="/leads">
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
          <Link className="text-sm font-semibold text-brand-700" to="/payments">
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
          <Link className="text-sm font-semibold text-brand-700" to="/inventory">
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
          <Link className="text-sm font-semibold text-brand-700" to="/projects">
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
          className="grid gap-2 bg-stone-50 p-3 hover:bg-brand-50 sm:grid-cols-[1fr_auto] sm:items-center"
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
