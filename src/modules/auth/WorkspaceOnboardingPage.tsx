import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import { createEpcWorkspaceForCurrentUser } from "../../services/authAccess";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";

export function WorkspaceOnboardingPage() {
  const { status, profile, session, errorMessage, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [workspaceName, setWorkspaceName] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (status === "ready") {
    return <Navigate to={safeAuthenticatedRedirect(profile, "/dashboard")} replace />;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  async function handleWorkspaceCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    try {
      setIsSubmitting(true);
      await createEpcWorkspaceForCurrentUser({
        workspaceName,
        fullName,
        phone,
      });
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUseAnotherAccount() {
    setFormError(null);

    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  const isLoading = status === "loading";
  const isBlocked = status === "inactive" || status === "error";

  return (
    <AuthThemeShell
      badge="Workspace setup"
      mobileDescription="Create your EPC workspace and continue as its administrator."
      title="Create your EPC workspace"
    >
      <AuthThemeCard>
        {isLoading ? (
          <LoadingState />
        ) : isBlocked ? (
          <BlockedState
            message={
              status === "inactive"
                ? "This account is inactive and cannot create a workspace."
                : errorMessage ?? "Your account could not be loaded."
            }
            onUseAnotherAccount={handleUseAnotherAccount}
          />
        ) : (
          <>
            <p className="text-sm font-semibold text-orange-300">
              Verified account
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
              Set up your company
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              We will create an isolated EPC workspace and assign you the locked
              Admin role.
            </p>

            <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">
                Signed in as
              </p>
              <p className="mt-1 break-all text-sm font-medium text-white">
                {session?.user.email ?? "Verified user"}
              </p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleWorkspaceCreation}>
              <TextField
                autoComplete="organization"
                disabled={isSubmitting}
                label="EPC workspace name"
                maxLength={120}
                onChange={setWorkspaceName}
                placeholder="Example Solar Solutions"
                value={workspaceName}
              />

              <TextField
                autoComplete="name"
                disabled={isSubmitting}
                label="Your full name"
                maxLength={120}
                onChange={setFullName}
                placeholder="Enter your full name"
                value={fullName}
              />

              <TextField
                autoComplete="tel"
                disabled={isSubmitting}
                label="Phone number (optional)"
                maxLength={20}
                onChange={setPhone}
                placeholder="+91 98765 43210"
                required={false}
                type="tel"
                value={phone}
              />

              <FormError message={formError} />

              <button
                className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Creating workspace" : "Create workspace"}
              </button>
            </form>

            <button
              className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onClick={handleUseAnotherAccount}
              type="button"
            >
              Use another account
            </button>
          </>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

type TextFieldProps = {
  autoComplete: string;
  disabled: boolean;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: "text" | "tel";
  value: string;
};

function TextField({
  autoComplete,
  disabled,
  label,
  maxLength,
  onChange,
  placeholder,
  required = true,
  type = "text",
  value,
}: TextFieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-white">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        maxLength={maxLength}
        minLength={required ? 2 : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function LoadingState() {
  return (
    <div aria-live="polite" className="py-4 text-center">
      <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-orange-400" />
      <p className="mt-4 text-sm leading-6 text-slate-300">
        Checking your verified account…
      </p>
    </div>
  );
}

function BlockedState({
  message,
  onUseAnotherAccount,
}: {
  message: string;
  onUseAnotherAccount: () => Promise<void>;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-orange-300">Workspace setup</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        Setup unavailable
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
      <button
        className="mt-6 w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white hover:text-[#06173f]"
        onClick={() => void onUseAnotherAccount()}
        type="button"
      >
        Back to login
      </button>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm leading-6 text-red-100">
      {message}
    </p>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The workspace could not be created. Please try again.";
}
