import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import { createPlatformCompany, fetchPlatformCompanies } from "./companyApi";
import type {
  CreatePlatformCompanyFormValues,
  PlatformCompany,
} from "./types";

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
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [values, setValues] =
    useState<CreatePlatformCompanyFormValues>(emptyFormValues);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUsePlatformWorkflow = Boolean(profile?.is_super_admin);
  const stats = useMemo(() => {
    const activeCount = companies.filter(
      (company) => company.status === "active",
    ).length;
    const linkedAdminCount = companies.filter(
      (company) => company.admin?.auth_user_id,
    ).length;

    return {
      activeCount,
      pendingAdminCount: companies.length - linkedAdminCount,
      totalCount: companies.length,
    };
  }, [companies]);

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
      await createPlatformCompany(values);
      setValues(emptyFormValues);
      await loadCompanies();
      showToast("EPC company workspace created.", "success");
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
        description="Create solar EPC tenant workspaces and assign the first company admin profile."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total companies" value={stats.totalCount} />
        <MetricCard label="Active workspaces" value={stats.activeCount} />
        <MetricCard label="Pending auth link" value={stats.pendingAdminCount} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <form
          className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
          onSubmit={handleSubmit}
        >
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Add EPC company
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              This creates the tenant workspace, default Admin role, all role
              permissions, and the first admin profile.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <TextField
              label="Company name"
              onChange={(value) => updateValue("organization_name", value)}
              placeholder="Solar EPC Pvt Ltd"
              required
              value={values.organization_name}
            />
            <TextField
              helpText="Used for the default tenant subdomain slug."
              label="Workspace slug"
              onChange={(value) => updateValue("organization_slug", value)}
              placeholder="solar-epc"
              required
              value={values.organization_slug}
            />
            <TextField
              label="Primary admin name"
              onChange={(value) => updateValue("admin_full_name", value)}
              placeholder="Admin full name"
              required
              value={values.admin_full_name}
            />
            <TextField
              label="Primary admin email"
              onChange={(value) => updateValue("admin_email", value)}
              placeholder="admin@example.com"
              required
              type="email"
              value={values.admin_email}
            />
            <TextField
              helpText="Optional. Email is enough for password-based login once the Auth user is created."
              label="Primary admin phone"
              onChange={(value) => updateValue("admin_phone", value)}
              placeholder="+91..."
              value={values.admin_phone}
            />
          </div>

          {error ? <FormError message={error} /> : null}

          <button
            className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating workspace" : "Create EPC company"}
          </button>

          <p className="mt-4 text-xs leading-5 text-slate-500">
            Auth passwords are created by a trusted server setup or invitation
            flow, never from this browser page.
          </p>
        </form>

        <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-slate-950">
              Company workspaces
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Super admins can create and review EPC tenant onboarding status.
            </p>
          </div>

          {isLoading ? (
            <EmptyState
              title="Loading companies"
              description="Fetching tenant workspaces from Supabase."
            />
          ) : companies.length === 0 ? (
            <EmptyState
              title="No EPC companies yet"
              description="Create the first tenant workspace with the form."
            />
          ) : (
            <div className="divide-y divide-stone-200">
              {companies.map((company) => (
                <CompanyRow company={company} key={company.id} />
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function CompanyRow({ company }: { company: PlatformCompany }) {
  return (
    <article className="p-4 sm:p-5">
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
        <Badge tone={company.status === "active" ? "success" : "neutral"}>
          {company.status ?? "unknown"}
        </Badge>
      </div>

      <div className="mt-4 rounded-lg bg-stone-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">
          Primary admin
        </p>
        {company.admin ? (
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p className="font-medium text-slate-950">
              {company.admin.full_name ?? "Unnamed admin"}
            </p>
            <p>{company.admin.email ?? "No email"}</p>
            <div className="pt-1">
              <Badge tone={company.admin.auth_user_id ? "success" : "warning"}>
                {company.admin.auth_user_id ? "Auth linked" : "Pending auth"}
              </Badge>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            No admin profile found.
          </p>
        )}
      </div>
    </article>
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
    <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
