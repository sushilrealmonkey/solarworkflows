import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { PageLoader } from "../../components/PageLoader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { formatDisplayDateTime } from "../../utils/dateFormat";
import {
  createPlatformCompany,
  fetchPlatformCompanies,
  sendPlatformAdminSetupLink,
} from "./companyApi";
import {
  billingStatusLabel,
  companyContactName,
  companyContactPhone,
  companyPlanLabel,
} from "./companyUtils";
import type {
  CreatePlatformCompanyFormValues,
  PlatformCompanyBillingStatus,
  PlatformCompany,
} from "./types";

type ViewMode = "companies" | "in_house" | "invites" | "new";
type CompanyFilter =
  | "all"
  | PlatformCompanyBillingStatus
  | "trials_ending_soon"
  | "subscription_risk";

const emptyFormValues: CreatePlatformCompanyFormValues = {
  organization_name: "",
  admin_full_name: "",
  admin_email: "",
  admin_phone: "+91",
};

export function CompaniesPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [values, setValues] =
    useState<CreatePlatformCompanyFormValues>(emptyFormValues);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    viewModeFromSearchParams(searchParams),
  );
  const [filter, setFilter] = useState<CompanyFilter>(() =>
    filterFromSearchParams(searchParams),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUsePlatformWorkflow = Boolean(profile?.is_super_admin);

  const loadCompanies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const nextCompanies = await fetchPlatformCompanies();
      setCompanies(nextCompanies);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load EPC companies.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canUsePlatformWorkflow) {
      setIsLoading(false);
      return;
    }

    void loadCompanies();
  }, [canUsePlatformWorkflow, loadCompanies]);

  useEffect(() => {
    setViewMode(viewModeFromSearchParams(searchParams));
    setFilter(filterFromSearchParams(searchParams));
  }, [searchParams]);

  const clientCompanies = useMemo(
    () => companies.filter((company) => !company.is_in_house),
    [companies],
  );
  const inHouseCompanies = useMemo(
    () => companies.filter((company) => company.is_in_house),
    [companies],
  );

  const stats = useMemo(() => {
    const freeTrialActive = clientCompanies.filter(
      (company) => company.billing_status === "free_trial_active",
    ).length;
    const freeTrialEnded = clientCompanies.filter(
      (company) => company.billing_status === "free_trial_ended",
    ).length;
    const subscribed = clientCompanies.filter(
      (company) => company.billing_status === "subscribed",
    ).length;
    const activeAdmins = clientCompanies.filter(
      (company) => company.admin?.status === "active",
    ).length;

    return {
      activeAdmins,
      freeTrialActive,
      freeTrialEnded,
      inHouseCompanies: inHouseCompanies.length,
      subscribed,
      totalCompanies: clientCompanies.length,
    };
  }, [clientCompanies, inHouseCompanies]);

  const companiesForDirectory =
    viewMode === "in_house" ? inHouseCompanies : clientCompanies;

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return companiesForDirectory.filter((company) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          company.name,
          company.slug,
          company.subdomain,
          company.admin?.full_name,
          company.admin?.email,
          company.admin?.phone,
          company.settings?.contact_person,
          company.settings?.contact_phone,
          company.subscription?.plan_name,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery));

      if (!matchesSearch) {
        return false;
      }

      return matchesCompanyFilter(company, filter);
    });
  }, [companiesForDirectory, filter, searchQuery]);

  const pendingCompanies = useMemo(
    () => clientCompanies.filter(isAdminSetupPending),
    [clientCompanies],
  );
  const companyPagination = useTablePagination(filteredCompanies);
  const paginatedCompanies = companyPagination.pageItems;
  const pendingCompanyPagination = useTablePagination(pendingCompanies);
  const paginatedPendingCompanies = pendingCompanyPagination.pageItems;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const validationError = validateForm(values);

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await createPlatformCompany(values);
      setValues(emptyFormValues);
      await loadCompanies();
      setViewMode("companies");
      showToast("EPC company invite email sent.", "success");
      navigate(`/companies/${result.organization_id}`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to create EPC company.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateValue(
    key: keyof CreatePlatformCompanyFormValues,
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function runAction(
    actionKey: string,
    successMessage: string,
    action: () => Promise<unknown>,
  ) {
    try {
      setBusyAction(actionKey);
      setError(null);
      await action();
      await loadCompanies();
      showToast(successMessage, "success");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Action failed.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function switchView(nextView: ViewMode) {
    setViewMode(nextView);
    setFilter("all");
    setSearchQuery("");

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("tab", tabForViewMode(nextView));
    nextSearchParams.delete("status");
    setSearchParams(nextSearchParams, { replace: true });
  }

  function changeFilter(nextFilter: CompanyFilter) {
    setFilter(nextFilter);

    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextFilter === "all") {
      nextSearchParams.delete("status");
    } else {
      nextSearchParams.set("status", nextFilter);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  if (!canUsePlatformWorkflow) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Companies"
          description="Platform-level EPC company onboarding is available only to super admins."
        />
        <EmptyState
          title="Super admin access required"
          description="This page manages tenant workspaces and primary admin profiles across the platform."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="EPC Companies"
        description="Create, invite, activate, and review EPC tenant workspaces."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Client companies" value={stats.totalCompanies} />
        <MetricCard label="In-house accounts" value={stats.inHouseCompanies} />
        <MetricCard label="Free Trial Active" value={stats.freeTrialActive} />
        <MetricCard label="Free Trial Ended" value={stats.freeTrialEnded} />
        <MetricCard label="Subscribed" value={stats.subscribed} />
        <MetricCard label="Active admins" value={stats.activeAdmins} />
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ModeButton
            active={viewMode === "companies"}
            label="Client companies"
            onClick={() => switchView("companies")}
          />
          <ModeButton
            active={viewMode === "in_house"}
            label="In-house"
            onClick={() => switchView("in_house")}
          />
          <ModeButton
            active={viewMode === "invites"}
            label="Invites"
            onClick={() => switchView("invites")}
          />
          <ModeButton
            active={viewMode === "new"}
            label="New"
            onClick={() => switchView("new")}
          />
        </div>
        <button
          className="rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
          onClick={() => switchView("new")}
          type="button"
        >
          Add EPC company
        </button>
      </div>

      {error ? <FormError message={error} /> : null}

      {viewMode === "new" ? (
        <CreateCompanyForm
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onUpdateValue={updateValue}
          values={values}
        />
      ) : null}

      {viewMode === "invites" ? (
        <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <SectionHeader
            description="Review EPC admins who still need to finish password setup."
            title="Admin setup queue"
          />
          {pendingCompanies.length === 0 ? (
            <EmptyState
              title="No pending admin setup"
              description="All listed primary admins have completed activation or are inactive."
            />
          ) : (
            <div className="divide-y divide-stone-200">
              {paginatedPendingCompanies.map((company) => (
                <InviteRow
                  busyAction={busyAction}
                  company={company}
                  key={company.id}
                  onSendSetupLink={() => {
                    if (company.admin) {
                      void runAction(
                        `setup:${company.admin.id}`,
                        "Admin setup link sent.",
                        () => sendPlatformAdminSetupLink(company.admin!.id),
                      );
                    }
                  }}
                  onSelect={() => {
                    navigate(`/companies/${company.id}`);
                  }}
                />
              ))}
              <TablePagination
                label="pending admins"
                pagination={pendingCompanyPagination}
              />
            </div>
          )}
        </section>
      ) : null}

      {viewMode === "companies" || viewMode === "in_house" ? (
        <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-200 p-4">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-950">
                  {viewMode === "in_house" ? "In-house accounts" : "Client companies"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {viewMode === "in_house"
                    ? "Internal and test workspaces kept separate from the client directory."
                    : "Client EPC workspaces and their current subscription status."}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="sr-only">Search companies</span>
                  <input
                    className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search company, slug, admin"
                    type="search"
                    value={searchQuery}
                  />
                </label>
                <select
                  className="rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  onChange={(event) => changeFilter(event.target.value as CompanyFilter)}
                  value={filter}
                >
                  <option value="all">All</option>
                  <option value="free_trial_active">Free Trial Active</option>
                  <option value="free_trial_ended">Free Trial Ended</option>
                  <option value="subscribed">Subscribed</option>
                  <option value="trials_ending_soon">Trials ending soon</option>
                  <option value="subscription_risk">Subscription risk</option>
                </select>
              </div>
            </div>

            {isLoading ? (
              <PageLoader label="Loading company workspaces..." />
            ) : filteredCompanies.length === 0 ? (
              <EmptyState
                title="No matching companies"
                description="Change the search or filter to review more workspaces."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[860px]">
                    <div className="grid grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_160px_180px_190px] border-b border-stone-200 bg-stone-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">
                      <span>Company name</span>
                      <span>Contact person</span>
                      <span>Mobile</span>
                      <span>Plan</span>
                      <span>Status</span>
                    </div>
                    <div className="divide-y divide-stone-200">
                      {paginatedCompanies.map((company) => (
                        <CompanyRow
                          company={company}
                          key={company.id}
                          onSelect={() => navigate(`/companies/${company.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <TablePagination
                  label="companies"
                  pagination={companyPagination}
                />
              </>
            )}
        </section>
      ) : null}
    </div>
  );
}

function CreateCompanyForm({
  isSubmitting,
  onSubmit,
  onUpdateValue,
  values,
}: {
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateValue: (
    key: keyof CreatePlatformCompanyFormValues,
    value: string,
  ) => void;
  values: CreatePlatformCompanyFormValues;
}) {
  return (
    <form
      className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      onSubmit={onSubmit}
    >
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-950">
          Add EPC company
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Create the tenant workspace, Admin role, primary admin profile, and
          Supabase invite email.
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <TextField
          label="Company name"
          onChange={(value) => onUpdateValue("organization_name", value)}
          placeholder="Solar EPC Pvt Ltd"
          required
          value={values.organization_name}
        />
        <TextField
          label="Primary admin name"
          onChange={(value) => onUpdateValue("admin_full_name", value)}
          placeholder="Admin full name"
          required
          value={values.admin_full_name}
        />
        <TextField
          label="Primary admin email"
          onChange={(value) => onUpdateValue("admin_email", value)}
          placeholder="admin@example.com"
          required
          type="email"
          value={values.admin_email}
        />
        <TextField
          helpText="Optional. Email is enough for password setup."
          label="Primary admin phone"
          onChange={(value) => onUpdateValue("admin_phone", value)}
          placeholder="+91 98765 43210"
          value={values.admin_phone}
        />
      </div>

      <button
        className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Sending invite" : "Create and invite"}
      </button>
    </form>
  );
}

function CompanyRow({
  company,
  onSelect,
}: {
  company: PlatformCompany;
  onSelect: () => void;
}) {
  return (
    <button
      aria-label={`Open ${company.name}`}
      className="grid w-full grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_160px_180px_190px] items-center gap-0 px-4 py-4 text-left transition hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 sm:px-5"
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0 pr-4">
        <span className="block truncate text-sm font-semibold text-slate-950">
          {company.name}
        </span>
        <span className="mt-1 block truncate text-xs text-slate-500">
          {company.slug}
          {company.subdomain ? ` / ${company.subdomain}` : ""}
        </span>
      </span>
      <span className="truncate pr-4 text-sm text-slate-700">
        {companyContactName(company)}
      </span>
      <span className="truncate pr-4 text-sm text-slate-700">
        {companyContactPhone(company)}
      </span>
      <span className="truncate pr-4 text-sm text-slate-700">
        {companyPlanLabel(company)}
      </span>
      <span>
        <Badge
          tone={
            company.billing_status === "free_trial_ended"
              ? "warning"
              : "success"
          }
        >
          {billingStatusLabel(company.billing_status)}
        </Badge>
      </span>
    </button>
  );
}

function InviteRow({
  busyAction,
  company,
  onSelect,
  onSendSetupLink,
}: {
  busyAction: string | null;
  company: PlatformCompany;
  onSelect: () => void;
  onSendSetupLink: () => void;
}) {
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">
            {company.name}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {company.admin?.full_name ?? "No admin"} /{" "}
            {company.admin?.email ?? "No email"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Last invite: {formatDateTime(company.admin?.invited_at ?? null)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-stone-50"
            onClick={onSelect}
            type="button"
          >
            Review
          </button>
          <button
            className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(busyAction) || !company.admin}
            onClick={onSendSetupLink}
            type="button"
          >
            Send setup link
          </button>
        </div>
      </div>
    </article>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
        active
          ? "bg-orange-600 text-white"
          : "bg-stone-100 text-slate-700 hover:bg-stone-200"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SectionHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="border-b border-stone-200 p-4 sm:p-5">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function TextField({
  helpText,
  label,
  onChange,
  placeholder,
  required = false,
  type = "text",
  value,
}: {
  helpText?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "email" | "text";
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {helpText ? (
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {helpText}
        </span>
      ) : null}
    </label>
  );
}

function Badge({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-[#06173f]"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-stone-50 text-slate-600";

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function EmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="p-5 text-sm leading-6 text-slate-600">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
      {message}
    </p>
  );
}

function validateForm(values: CreatePlatformCompanyFormValues) {
  if (!values.organization_name.trim()) {
    return "Company name is required.";
  }

  if (!values.admin_full_name.trim()) {
    return "Primary admin name is required.";
  }

  if (!values.admin_email.trim()) {
    return "Primary admin email is required.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.admin_email.trim())) {
    return "Enter a valid primary admin email.";
  }

  return null;
}

function viewModeFromSearchParams(searchParams: URLSearchParams): ViewMode {
  const tab = searchParams.get("tab");

  if (tab === "in_house") return "in_house";
  if (tab === "invites") return "invites";
  if (tab === "new") return "new";
  return "companies";
}

function filterFromSearchParams(searchParams: URLSearchParams): CompanyFilter {
  const status = searchParams.get("status");

  if (
    status === "free_trial_active" ||
    status === "free_trial_ended" ||
    status === "subscribed" ||
    status === "trials_ending_soon" ||
    status === "subscription_risk"
  ) {
    return status;
  }

  return "all";
}

function tabForViewMode(viewMode: ViewMode) {
  if (viewMode === "companies") return "clients";
  return viewMode;
}

function matchesCompanyFilter(
  company: PlatformCompany,
  filter: CompanyFilter,
) {
  if (filter === "all") {
    return true;
  }

  if (
    filter === "free_trial_active" ||
    filter === "free_trial_ended" ||
    filter === "subscribed"
  ) {
    return company.billing_status === filter;
  }

  if (filter === "subscription_risk") {
    return Boolean(
      company.subscription?.plan_key &&
        ["past_due", "suspended", "cancelled"].includes(
          company.subscription.status ?? "",
        ),
    );
  }

  const trialEndsAt = company.subscription?.trial_ends_at
    ? new Date(company.subscription.trial_ends_at).getTime()
    : Number.NaN;

  return (
    company.billing_status === "free_trial_active" &&
    Number.isFinite(trialEndsAt) &&
    trialEndsAt > Date.now() &&
    trialEndsAt <= Date.now() + 7 * 24 * 60 * 60 * 1000
  );
}

function isAdminSetupPending(company: PlatformCompany) {
  if (!company.admin) {
    return true;
  }

  if (company.admin.status === "inactive") {
    return false;
  }

  return (
    company.admin.status === "invited" ||
    !company.admin.auth_user_id ||
    !company.admin.onboarded_at
  );
}

function formatDateTime(value: string | null) {
  return formatDisplayDateTime(value);
}
