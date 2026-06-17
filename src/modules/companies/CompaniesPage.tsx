import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  createPlatformCompany,
  fetchPlatformCompanies,
  sendPlatformAdminSetupLink,
  updatePlatformAdminStatus,
  updatePlatformCompanyStatus,
} from "./companyApi";
import type {
  CreatePlatformCompanyFormValues,
  PlatformCompany,
} from "./types";

type ViewMode = "companies" | "invites" | "new";
type CompanyFilter = "all" | "active" | "inactive" | "pending";

const emptyFormValues: CreatePlatformCompanyFormValues = {
  organization_name: "",
  organization_slug: "",
  admin_full_name: "",
  admin_email: "",
  admin_phone: "",
};

export function CompaniesPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [values, setValues] =
    useState<CreatePlatformCompanyFormValues>(emptyFormValues);
  const [viewMode, setViewMode] = useState<ViewMode>("companies");
  const [filter, setFilter] = useState<CompanyFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null,
  );
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
      setSelectedCompanyId((current) => {
        if (current && nextCompanies.some((company) => company.id === current)) {
          return current;
        }

        return nextCompanies[0]?.id ?? null;
      });
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

  const stats = useMemo(() => {
    const activeCompanies = companies.filter(
      (company) => company.status === "active",
    ).length;
    const inactiveCompanies = companies.filter(
      (company) => company.status === "inactive",
    ).length;
    const pendingAdmins = companies.filter(isAdminSetupPending).length;
    const activeAdmins = companies.filter(
      (company) => company.admin?.status === "active",
    ).length;

    return {
      activeAdmins,
      activeCompanies,
      inactiveCompanies,
      pendingAdmins,
      totalCompanies: companies.length,
    };
  }, [companies]);

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return companies.filter((company) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          company.name,
          company.slug,
          company.subdomain,
          company.admin?.full_name,
          company.admin?.email,
          company.admin?.phone,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery));

      if (!matchesSearch) {
        return false;
      }

      if (filter === "active") {
        return company.status === "active";
      }

      if (filter === "inactive") {
        return company.status === "inactive";
      }

      if (filter === "pending") {
        return isAdminSetupPending(company);
      }

      return true;
    });
  }, [companies, filter, searchQuery]);

  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) ??
    filteredCompanies[0] ??
    companies[0] ??
    null;

  const pendingCompanies = useMemo(
    () => companies.filter(isAdminSetupPending),
    [companies],
  );

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
      setSelectedCompanyId(result.organization_id);
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
      [key]: key === "organization_slug" ? slugify(value) : value,
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total companies" value={stats.totalCompanies} />
        <MetricCard label="Active workspaces" value={stats.activeCompanies} />
        <MetricCard label="Inactive workspaces" value={stats.inactiveCompanies} />
        <MetricCard label="Pending setup" value={stats.pendingAdmins} />
        <MetricCard label="Active admins" value={stats.activeAdmins} />
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-2">
          <ModeButton
            active={viewMode === "companies"}
            label="Companies"
            onClick={() => setViewMode("companies")}
          />
          <ModeButton
            active={viewMode === "invites"}
            label="Invites"
            onClick={() => setViewMode("invites")}
          />
          <ModeButton
            active={viewMode === "new"}
            label="New"
            onClick={() => setViewMode("new")}
          />
        </div>
        <button
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500"
          onClick={() => setViewMode("new")}
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
              {pendingCompanies.map((company) => (
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
                    setSelectedCompanyId(company.id);
                    navigate(`/companies/${company.id}`);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {viewMode === "companies" ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-200 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="sr-only">Search companies</span>
                  <input
                    className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search company, slug, admin"
                    type="search"
                    value={searchQuery}
                  />
                </label>
                <select
                  className="rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  onChange={(event) =>
                    setFilter(event.target.value as CompanyFilter)
                  }
                  value={filter}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending setup</option>
                </select>
              </div>
            </div>

            {isLoading ? (
              <EmptyState
                title="Loading companies"
                description="Fetching tenant workspaces from Supabase."
              />
            ) : filteredCompanies.length === 0 ? (
              <EmptyState
                title="No matching companies"
                description="Change the search or filter to review more workspaces."
              />
            ) : (
              <div className="divide-y divide-stone-200">
                {filteredCompanies.map((company) => (
                  <CompanyRow
                    company={company}
                    isSelected={selectedCompany?.id === company.id}
                    key={company.id}
                    onSelect={() => navigate(`/companies/${company.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          <CompanyDetail
            busyAction={busyAction}
            company={selectedCompany}
            onAdminStatus={(company, status) =>
              company.admin
                ? runAction(
                    `admin-status:${company.admin.id}:${status}`,
                    "Admin status updated.",
                    () => updatePlatformAdminStatus(company.admin!.id, status),
                  )
                : undefined
            }
            onCompanyStatus={(company, status) =>
              runAction(
                `company-status:${company.id}:${status}`,
                "Workspace status updated.",
                () => updatePlatformCompanyStatus(company.id, status),
              )
            }
            onSendSetupLink={(company) =>
              company.admin
                ? runAction(
                    `setup:${company.admin.id}`,
                    "Admin setup link sent.",
                    () => sendPlatformAdminSetupLink(company.admin!.id),
                  )
                : undefined
            }
          />
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
          helpText="Used for the default tenant subdomain slug."
          label="Workspace slug"
          onChange={(value) => onUpdateValue("organization_slug", value)}
          placeholder="solar-epc"
          required
          value={values.organization_slug}
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
          placeholder="+91..."
          value={values.admin_phone}
        />
      </div>

      <button
        className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
  isSelected,
  onSelect,
}: {
  company: PlatformCompany;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`block w-full px-4 py-4 text-left transition ${
        isSelected ? "bg-brand-50" : "hover:bg-stone-50"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">
            {company.name}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {company.slug}
            {company.subdomain ? ` / ${company.subdomain}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={company.status === "active" ? "success" : "neutral"}>
            {company.status ?? "unknown"}
          </Badge>
          <Badge tone={isAdminSetupPending(company) ? "warning" : "success"}>
            {adminSetupLabel(company)}
          </Badge>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <span>{company.admin?.full_name ?? "No admin"}</span>
        <span>{company.admin?.email ?? "No admin email"}</span>
        <span>{formatDate(company.created_at)}</span>
      </div>
    </button>
  );
}

function CompanyDetail({
  busyAction,
  company,
  onAdminStatus,
  onCompanyStatus,
  onSendSetupLink,
}: {
  busyAction: string | null;
  company: PlatformCompany | null;
  onAdminStatus: (
    company: PlatformCompany,
    status: "invited" | "active" | "inactive",
  ) => void;
  onCompanyStatus: (
    company: PlatformCompany,
    status: "active" | "inactive",
  ) => void;
  onSendSetupLink: (company: PlatformCompany) => void;
}) {
  if (!company) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
        <EmptyState
          title="No company selected"
          description="Select a company workspace to review details."
        />
      </section>
    );
  }

  const nextCompanyStatus = company.status === "active" ? "inactive" : "active";
  const admin = company.admin;

  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <SectionHeader
        description={`${company.slug}${company.subdomain ? ` / ${company.subdomain}` : ""}`}
        title={company.name}
      />

      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={company.status === "active" ? "success" : "neutral"}>
            {`Workspace ${company.status ?? "unknown"}`}
          </Badge>
          <Badge tone={isAdminSetupPending(company) ? "warning" : "success"}>
            {adminSetupLabel(company)}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Created" value={formatDateTime(company.created_at)} />
          <Detail label="Updated" value={formatDateTime(company.updated_at)} />
          <Detail label="Users" value={String(company.user_count)} />
          <Detail label="Roles" value={String(company.role_count)} />
          <Detail label="Custom domain" value={company.custom_domain ?? "-"} />
          <Detail
            label="GST"
            value={company.settings?.gst_number ?? "-"}
          />
        </div>

        <div className="rounded-lg bg-stone-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">
            Primary admin
          </p>
          {admin ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Detail label="Name" value={admin.full_name ?? "-"} />
              <Detail label="Email" value={admin.email ?? "-"} />
              <Detail label="Phone" value={admin.phone ?? "-"} />
              <Detail label="Status" value={admin.status ?? "-"} />
              <Detail label="Invited" value={formatDateTime(admin.invited_at)} />
              <Detail
                label="Onboarded"
                value={formatDateTime(admin.onboarded_at)}
              />
              <Detail
                label="Last login"
                value={formatDateTime(admin.last_login_at)}
              />
              <Detail
                label="Auth"
                value={admin.auth_user_id ? "Linked" : "Not linked"}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No primary admin profile found.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(busyAction)}
            onClick={() => onCompanyStatus(company, nextCompanyStatus)}
            type="button"
          >
            Mark workspace {nextCompanyStatus}
          </button>
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(busyAction) || !admin || admin.status === "inactive"}
            onClick={() => onSendSetupLink(company)}
            type="button"
          >
            Send setup link
          </button>
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(busyAction) || !admin || admin.status === "active"}
            onClick={() => onAdminStatus(company, "active")}
            type="button"
          >
            Mark admin active
          </button>
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(busyAction) || !admin || admin.status === "inactive"}
            onClick={() => onAdminStatus(company, "inactive")}
            type="button"
          >
            Mark admin inactive
          </button>
        </div>
      </div>
    </section>
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
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
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
          ? "bg-brand-600 text-white"
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
        className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-slate-800">{value}</p>
    </div>
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
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
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

  if (!values.organization_slug.trim()) {
    return "Workspace slug is required.";
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

function adminSetupLabel(company: PlatformCompany) {
  if (!company.admin) {
    return "No admin";
  }

  if (company.admin.status === "inactive") {
    return "Admin inactive";
  }

  if (isAdminSetupPending(company)) {
    return "Pending setup";
  }

  return "Admin active";
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
