import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { isValidPhoneNumber } from "../../services/authAccess";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import { CompanyLogoUploader } from "../settings/CompanyLogoUploader";
import {
  fetchOrganizationSettings,
  updateOrganizationSettings,
  uploadCompanyLogo,
} from "../settings/settingsApi";
import {
  companySetupFromSettings,
  indiaStateOptions,
  isValidBusinessEmail,
  isValidGstin,
  type CompanySetupFormErrors,
  type CompanySetupFormValues,
} from "./companySetup";
import {
  advanceCurrentCompanyOnboarding,
  fetchCurrentCompanyState,
  updateCurrentCompanyState,
} from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";

const emptyValues: CompanySetupFormValues = {
  company_name: "",
  gst_number: "",
  contact_phone: "",
  contact_email: "",
  address: "",
  state: "",
  company_logo_url: "",
};

type Action = "saving" | "back" | null;

export function OnboardingCompanyPage() {
  const navigate = useNavigate();
  const { organization, profile, session } = useAuth();
  const { setProgress } = useOnboarding();
  const [values, setValues] = useState<CompanySetupFormValues>(emptyValues);
  const [errors, setErrors] = useState<CompanySetupFormErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadCompany() {
      try {
        setLoading(true);
        setLoadError(null);
        const [settings, state] = await Promise.all([
          fetchOrganizationSettings(),
          fetchCurrentCompanyState(profile),
        ]);

        if (!active) return;
        setValues(
          companySetupFromSettings(settings, {
            companyName: organization.name,
            phone: profile?.phone ?? "",
            email: session?.user.email ?? "",
            state,
          }),
        );
      } catch (error) {
        if (active) {
          setLoadError(errorMessage(error, "Company details could not be loaded."));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCompany();
    return () => {
      active = false;
    };
  }, [loadVersion, organization.name, profile, session?.user.email]);

  const stateOptions = useMemo(() => {
    const options = [...indiaStateOptions];
    return values.state && !options.includes(values.state as (typeof indiaStateOptions)[number])
      ? [values.state, ...options]
      : options;
  }, [values.state]);

  function update(key: keyof CompanySetupFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  }

  async function saveAndContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCompanySetup(values);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length) return;

    try {
      setAction("saving");
      await updateOrganizationSettings({
        company_name: values.company_name.trim(),
        gst_number: values.gst_number.trim().toUpperCase(),
        contact_phone: values.contact_phone.trim(),
        contact_email: values.contact_email.trim().toLowerCase(),
        address: values.address.trim(),
      });
      await updateCurrentCompanyState(profile, values.state);
      const nextProgress = await advanceCurrentCompanyOnboarding("products");
      setProgress(nextProgress);
      navigate("/onboarding/products", { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error, "Company details could not be saved."));
      setAction(null);
    }
  }

  async function goBack() {
    try {
      setAction("back");
      setSubmitError(null);
      const nextProgress = await advanceCurrentCompanyOnboarding("welcome");
      setProgress(nextProgress);
      navigate("/onboarding", { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error, "Onboarding could not return to Welcome."));
      setAction(null);
    }
  }

  async function uploadLogo(logo: Blob) {
    const publicUrl = await uploadCompanyLogo(profile, logo);
    await updateOrganizationSettings({ company_logo_url: publicUrl });
    update("company_logo_url", publicUrl);
  }

  return (
    <AuthThemeShell
      badge="Step 2 of 5"
      contentMaxWidthClass="max-w-2xl"
      desktopDescription="Add the business details that will appear across your Bizlee workspace, quotations and invoices."
      mobileDescription="Add the business details that will appear across your Bizlee workspace, quotations and invoices."
      title="Set up your company"
    >
      <AuthThemeCard>
        {loading ? (
          <CompanySetupLoading />
        ) : loadError ? (
          <CompanySetupLoadError
            message={loadError}
            onRetry={() => setLoadVersion((version) => version + 1)}
          />
        ) : (
          <form noValidate onSubmit={(event) => void saveAndContinue(event)}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-orange-200">Step 2 of 5</p>
              <span className="text-xs font-medium text-slate-400">Company Setup</span>
            </div>
            <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <span
                  className={`h-1.5 flex-1 rounded-full ${index < 2 ? "bg-orange-400" : "bg-white/15"}`}
                  key={index}
                />
              ))}
            </div>

            <div className="mt-6">
              <h2 className="text-xl font-semibold text-white">Company details</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                We have filled in details already provided during workspace setup.
              </p>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormInput
                  autoComplete="organization"
                  error={errors.company_name}
                  label="Company Name"
                  name="company_name"
                  onChange={(value) => update("company_name", value)}
                  required
                  value={values.company_name}
                />
              </div>
              <FormInput
                autoCapitalize="characters"
                error={errors.gst_number}
                label="GSTIN"
                maxLength={15}
                name="gst_number"
                onChange={(value) => update("gst_number", value.toUpperCase())}
                value={values.gst_number}
              />
              <FormInput
                autoComplete="tel"
                error={errors.contact_phone}
                inputMode="tel"
                label="Phone Number"
                maxLength={20}
                name="contact_phone"
                onChange={(value) => update("contact_phone", value)}
                type="tel"
                value={values.contact_phone}
              />
              <FormInput
                autoComplete="email"
                error={errors.contact_email}
                inputMode="email"
                label="Business Email"
                name="contact_email"
                onChange={(value) => update("contact_email", value)}
                type="email"
                value={values.contact_email}
              />
              <FormSelect
                label="State"
                name="state"
                onChange={(value) => update("state", value)}
                options={stateOptions}
                value={values.state}
              />
              <div className="sm:col-span-2">
                <FormTextArea
                  label="Business Address"
                  name="address"
                  onChange={(value) => update("address", value)}
                  value={values.address}
                />
              </div>
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium text-slate-100">Company Logo</p>
                <CompanyLogoUploader
                  currentUrl={values.company_logo_url}
                  detailsBelowControls
                  disabled={action !== null}
                  onUpload={uploadLogo}
                  tone="dark"
                />
              </div>
            </div>

            {submitError ? (
              <p className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between [&>button]:w-full [&>button:first-child]:!text-slate-200 [&>button:first-child:hover]:!bg-white/10 sm:[&>button]:w-auto">
              <Button disabled={action !== null} onClick={() => void goBack()} variant="ghost">
                {action === "back" ? "Going back..." : "Back"}
              </Button>
              <Button disabled={action !== null} type="submit">
                {action === "saving" ? (
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Saving...
                  </span>
                ) : "Save & Continue"}
              </Button>
            </div>
          </form>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function validateCompanySetup(values: CompanySetupFormValues) {
  const errors: CompanySetupFormErrors = {};
  if (!values.company_name.trim()) errors.company_name = "Company name is required.";
  if (values.gst_number.trim() && !isValidGstin(values.gst_number)) {
    errors.gst_number = "Enter a valid 15-character GSTIN.";
  }
  if (values.contact_phone.trim() && !isValidPhoneNumber(values.contact_phone)) {
    errors.contact_phone = "Enter a valid phone number.";
  }
  if (values.contact_email.trim() && !isValidBusinessEmail(values.contact_email)) {
    errors.contact_email = "Enter a valid business email.";
  }
  return errors;
}

type FormInputProps = {
  autoCapitalize?: string;
  autoComplete?: string;
  error?: string;
  inputMode?: "email" | "tel" | "text";
  label: string;
  maxLength?: number;
  name: keyof CompanySetupFormValues;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
};

function FormInput({ error, label, name, onChange, required = false, ...props }: FormInputProps) {
  const errorId = `${name}-error`;
  return (
    <label className="block" htmlFor={name}>
      <span className="text-sm font-medium text-slate-100">
        {label}{required ? <span className="text-orange-300"> *</span> : null}
      </span>
      <input
        {...props}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`mt-2 w-full rounded-xl border bg-white/[0.08] px-3.5 py-3 text-sm text-white outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20 ${error ? "border-red-300/70" : "border-white/15"}`}
        id={name}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {error ? <p className="mt-1.5 text-xs text-red-200" id={errorId}>{error}</p> : null}
    </label>
  );
}

function FormSelect({ label, name, onChange, options, value }: {
  label: string;
  name: keyof CompanySetupFormValues;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block" htmlFor={name}>
      <span className="text-sm font-medium text-slate-100">{label}</span>
      <select className="mt-2 w-full rounded-xl border border-white/15 bg-[#132750] px-3.5 py-3 text-sm text-white outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20" id={name} name={name} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Select a state or union territory</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function FormTextArea({ label, name, onChange, value }: {
  label: string;
  name: keyof CompanySetupFormValues;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block" htmlFor={name}>
      <span className="text-sm font-medium text-slate-100">{label}</span>
      <textarea autoComplete="street-address" className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/15 bg-white/[0.08] px-3.5 py-3 text-sm text-white outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20" id={name} name={name} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function CompanySetupLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="h-4 w-24 animate-pulse rounded bg-white/15" />
      <div className="mt-3 h-1.5 w-full animate-pulse rounded bg-white/15" />
      <div className="mt-7 h-6 w-48 animate-pulse rounded bg-white/15" />
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className={`h-16 animate-pulse rounded-xl bg-white/[0.08] ${index === 0 || index === 5 ? "sm:col-span-2" : ""}`} key={index} />
        ))}
      </div>
      <span className="sr-only">Loading company details</span>
    </div>
  );
}

function CompanySetupLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div>
      <p className="text-sm font-semibold text-orange-200">Company details unavailable</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">We could not load your company</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300" role="alert">{message}</p>
      <div className="mt-6 [&>button]:w-full"><Button onClick={onRetry}>Try again</Button></div>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
