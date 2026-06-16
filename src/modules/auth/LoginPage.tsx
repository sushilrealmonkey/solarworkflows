import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import { env, type TestLoginAccount } from "../../config/env";
import {
  isValidLoginEmail,
  isValidPassword,
  normalizeEmail,
  signInWithPasswordAndSyncProfile,
} from "../../services/authAccess";

type AccessNotice = {
  title: string;
  description: string;
  tone: "warning" | "error";
};

export function LoginPage() {
  const { status, profile, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accessNotice, setAccessNotice] = useState<AccessNotice | null>(null);

  const redirectTo = safeAuthenticatedRedirect(
    profile,
    getRedirectPath(location.state),
  );

  if (status === "ready" && !isRedirecting) {
    return <Navigate to={redirectTo} replace />;
  }

  const isBusy = isSigningIn || isRedirecting;

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setAccessNotice(null);

    const normalizedEmail = normalizeEmail(email);

    if (!isValidLoginEmail(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }

    if (!isValidPassword(password)) {
      setErrorMessage("Enter your password.");
      return;
    }

    try {
      setIsSigningIn(true);
      const accessResult = await signInWithPasswordAndSyncProfile(
        normalizedEmail,
        password,
      );

      if (accessResult.status === "unassigned") {
        await refresh();
        setAccessNotice({
          title: "Access not assigned",
          description:
            "This account is authenticated, but no workspace access is assigned.",
          tone: "warning",
        });
        return;
      }

      if (accessResult.status === "inactive") {
        await refresh();
        setAccessNotice({
          title: "Account inactive",
          description:
            "This account exists, but it is inactive for the organization workspace.",
          tone: "error",
        });
        return;
      }

      setIsRedirecting(true);
      await refresh();
      navigate(safeAuthenticatedRedirect(accessResult.profile, "/dashboard"), {
        replace: true,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  function applyQaAccount(account: TestLoginAccount) {
    setEmail(account.email);

    if (env.qaTestPassword) {
      setPassword(env.qaTestPassword);
    }

    setErrorMessage(null);
    setAccessNotice(null);
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden bg-brand-900 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-amber-200/50 bg-amber-200/15 px-3 py-1 text-sm font-semibold text-amber-100">
              Solar CRM
            </span>
            <h1 className="mt-8 max-w-lg text-4xl font-semibold tracking-normal">
              Intelligent Solar Management
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-emerald-50">
              Manage leads, projects, payments, inventory, and installations
              from one secure dashboard.
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/15 pb-4">
              <div>
                <p className="text-sm font-semibold text-emerald-50">
                  SolarWorkflows
                </p>
                <p className="mt-1 text-xs text-emerald-100">
                  Secure operations access
                </p>
              </div>
              <div className="h-11 w-11 rounded-full bg-amber-300 shadow-lg shadow-amber-900/30" />
            </div>
            <div className="mt-5 grid gap-3">
              <VisualMetric label="Lead pipeline" value="Protected" />
              <VisualMetric label="Projects" value="Tenant scoped" />
              <VisualMetric label="Inventory" value="Permission based" />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-md">
            <div className="lg:hidden">
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                Solar CRM
              </span>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal text-slate-950">
                Intelligent Solar Management
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Manage leads, projects, payments, inventory, and installations
                from one secure dashboard.
              </p>
            </div>

            <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6 lg:mt-0">
              <p className="text-sm font-semibold text-brand-600">
                Password login
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal">
                Welcome back
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Sign in with your assigned workspace credentials.
              </p>

              {env.qaTestAccounts.length > 0 ? (
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {env.qaTestAccounts.map((account) => (
                    <button
                      className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isBusy}
                      key={account.email}
                      onClick={() => applyQaAccount(account)}
                      type="button"
                    >
                      {account.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {accessNotice ? <AccessNoticeCard notice={accessNotice} /> : null}

              <form className="mt-6 space-y-4" onSubmit={handlePasswordLogin}>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Email address
                  </span>
                  <input
                    autoComplete="email"
                    className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    disabled={isBusy}
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    required
                    type="email"
                    value={email}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Password
                  </span>
                  <input
                    autoComplete="current-password"
                    className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    disabled={isBusy}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    required
                    type="password"
                    value={password}
                  />
                </label>

                <FormError message={errorMessage} />

                <button
                  className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  type="submit"
                >
                  {isRedirecting
                    ? "Redirecting"
                    : isSigningIn
                      ? "Signing in"
                      : "Sign In"}
                </button>
              </form>

              <p className="mt-5 text-center text-sm leading-6 text-slate-600">
                New EPC admins should use the invite email to create a password.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function VisualMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
      <span className="text-sm text-emerald-50">{label}</span>
      <span className="text-sm font-semibold text-amber-100">{value}</span>
    </div>
  );
}

function AccessNoticeCard({ notice }: { notice: AccessNotice }) {
  const toneClass =
    notice.tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className={`mt-5 rounded-xl border px-3 py-3 ${toneClass}`}>
      <p className="text-sm font-semibold">{notice.title}</p>
      <p className="mt-1 text-sm leading-6">{notice.description}</p>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
      {message}
    </p>
  );
}

function getRedirectPath(state: unknown) {
  if (
    typeof state === "object" &&
    state !== null &&
    "from" in state &&
    typeof state.from === "object" &&
    state.from !== null &&
    "pathname" in state.from &&
    typeof state.from.pathname === "string"
  ) {
    return state.from.pathname;
  }

  return "/dashboard";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Supabase auth error. Please try again.";
}
