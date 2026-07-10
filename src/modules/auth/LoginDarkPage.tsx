import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import { PortalLogo } from "../../components/PortalBrand";
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

export function LoginDarkPage() {
  const { status, profile, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
        setIsRedirecting(true);
        await refresh();
        navigate("/onboarding", { replace: true });
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

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06173f] px-4 py-5 text-white sm:px-6 lg:px-8">
      <DarkBackground />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl items-center gap-6 lg:grid-cols-[0.85fr_1fr] lg:gap-12">
        <section className="order-2 hidden px-1 pb-4 lg:order-1 lg:flex lg:min-h-[34rem] lg:items-center lg:justify-center lg:px-0 lg:pb-0">
          <div className="max-w-md text-center">
            <PortalLogo
              className="mx-auto h-16 w-full max-w-[14rem] object-contain"
              tone="dark"
            />
            <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-normal text-white">
              India's Mobile First{" "}
              <span className="block text-orange-400">
                Business Management
              </span>
              System For Growing Teams
            </h1>
          </div>
        </section>

        <section className="order-1 flex items-center justify-center lg:order-2">
          <div className="w-full max-w-md rounded-[1.75rem] border border-white/15 bg-white/[0.08] p-5 shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-7 lg:max-w-lg lg:p-8">
            <div className="text-center lg:hidden">
              <PortalLogo
                className="mx-auto h-12 w-full max-w-[10.5rem] object-contain"
                tone="dark"
              />
              <p className="mx-auto mt-4 max-w-xs text-sm font-semibold leading-6 text-slate-100">
                India's Mobile First Business Management System For Growing
                Teams
              </p>
            </div>

            <p className="mt-5 inline-flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 shadow-sm ring-1 ring-white/10 lg:mt-0">
              <span className="text-orange-400">
                <LockIcon />
              </span>
              Workspace login
            </p>
            <h2 className="mt-6 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              Welcome back
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              Sign in to access your Bizlee workspace.
            </p>

            {accessNotice ? <AccessNoticeCard notice={accessNotice} /> : null}

            <form className="mt-6 space-y-5" onSubmit={handlePasswordLogin}>
              <label className="block">
                <span className="text-sm font-semibold text-white">
                  Email address
                </span>
                <div className="relative mt-3">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-14 items-center justify-center text-slate-400">
                    <MailIcon />
                  </span>
                  <input
                    autoComplete="email"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.08] py-3.5 pl-14 pr-4 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter your email"
                    required
                    type="email"
                    value={email}
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-white">
                  Password
                </span>
                <div className="relative mt-3">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-14 items-center justify-center text-slate-400">
                    <PasswordIcon />
                  </span>
                  <input
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.08] py-3.5 pl-14 pr-14 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    required
                    type={isPasswordVisible ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={
                      isPasswordVisible ? "Hide password" : "Show password"
                    }
                    aria-pressed={isPasswordVisible}
                    className="absolute inset-y-0 right-0 flex w-14 items-center justify-center rounded-r-xl text-slate-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() =>
                      setIsPasswordVisible((currentValue) => !currentValue)
                    }
                    type="button"
                  >
                    <PasswordVisibilityIcon visible={isPasswordVisible} />
                  </button>
                </div>
              </label>

              <FormError message={errorMessage} />

              <button
                className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-orange-500 px-4 py-3.5 text-base font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                type="submit"
              >
                <span className="relative">
                  {isRedirecting
                    ? "Redirecting"
                    : isSigningIn
                      ? "Signing in"
                      : "Sign in"}
                </span>
                <span
                  className="absolute right-8 text-white transition group-hover:translate-x-1 group-hover:text-orange-500"
                  aria-hidden="true"
                >
                  <ArrowRightIcon />
                </span>
              </button>

              <Link
                className="block text-center text-sm font-semibold text-orange-300 transition hover:text-orange-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
                to="/forgot-password"
              >
                Forgot password?
              </Link>
            </form>

            <p className="mx-auto mt-6 max-w-sm border-t border-white/15 pt-5 text-center text-sm leading-6 text-slate-300">
              New here?{" "}
              <Link
                className="font-semibold text-orange-300 transition hover:text-orange-200"
                to="/signup"
              >
                Create an account
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export function LoginMobilePage() {
  const { status, profile, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
        setIsRedirecting(true);
        await refresh();
        navigate("/onboarding", { replace: true });
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

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06173f] px-4 py-4 text-white">
      <MobileDarkBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[27rem] flex-col">
        <header className="flex shrink-0 flex-col items-center pt-2 text-center">
          <PortalLogo
            className="h-11 w-full max-w-[9.75rem] object-contain"
            tone="dark"
          />
          <h1 className="mt-4 max-w-[20rem] text-xl font-semibold leading-7 tracking-normal text-white">
            India's Mobile First{" "}
            <span className="text-orange-400">Business Management</span> System
            For Growing Teams
          </h1>
        </header>

        <section className="relative mt-5 flex flex-1 items-end">
          <TopWaveLines className="pointer-events-none absolute -left-24 bottom-[-1.5rem] h-[27rem] w-[43rem] -rotate-6 text-orange-300/20" />
          <div className="relative w-full rounded-[1.5rem] border border-white/15 bg-white/[0.09] p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl">
            <p className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10">
              <span className="text-orange-400">
                <LockIcon />
              </span>
              Workspace login
            </p>
            <h2 className="mt-5 text-3xl font-semibold tracking-normal text-white">
              Welcome back
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Sign in to access your Bizlee workspace.
            </p>

            {accessNotice ? <AccessNoticeCard notice={accessNotice} /> : null}

            <form className="mt-5 space-y-4" onSubmit={handlePasswordLogin}>
              <label className="block">
                <span className="text-sm font-semibold text-white">
                  Email address
                </span>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center text-slate-400">
                    <MailIcon />
                  </span>
                  <input
                    autoComplete="email"
                    className="h-[3.25rem] w-full rounded-xl border border-white/10 bg-white/[0.08] py-3 pl-12 pr-4 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter your email"
                    required
                    type="email"
                    value={email}
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-white">
                  Password
                </span>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center text-slate-400">
                    <PasswordIcon />
                  </span>
                  <input
                    autoComplete="current-password"
                    className="h-[3.25rem] w-full rounded-xl border border-white/10 bg-white/[0.08] py-3 pl-12 pr-12 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    required
                    type={isPasswordVisible ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={
                      isPasswordVisible ? "Hide password" : "Show password"
                    }
                    aria-pressed={isPasswordVisible}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-400 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() =>
                      setIsPasswordVisible((currentValue) => !currentValue)
                    }
                    type="button"
                  >
                    <PasswordVisibilityIcon visible={isPasswordVisible} />
                  </button>
                </div>
              </label>

              <FormError message={errorMessage} />

              <button
                className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-orange-500 px-4 py-3.5 text-base font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                type="submit"
              >
                <span className="relative">
                  {isRedirecting
                    ? "Redirecting"
                    : isSigningIn
                      ? "Signing in"
                      : "Sign in"}
                </span>
                <span
                  className="absolute right-6 text-white transition group-hover:translate-x-1 group-hover:text-orange-500"
                  aria-hidden="true"
                >
                  <ArrowRightIcon />
                </span>
              </button>

              <Link
                className="block text-center text-sm font-semibold text-orange-300 transition hover:text-orange-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400"
                to="/forgot-password"
              >
                Forgot password?
              </Link>
            </form>

            <p className="mx-auto mt-5 max-w-xs border-t border-white/15 pt-4 text-center text-xs leading-5 text-slate-300">
              New here?{" "}
              <Link
                className="font-semibold text-orange-300 transition hover:text-orange-200"
                to="/signup"
              >
                Create an account
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function MobileDarkBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute -left-28 -top-24 h-80 w-80 rounded-full bg-orange-500/22 blur-3xl" />
      <div className="absolute -bottom-40 right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-sky-500/10 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-orange-300/25" />
    </div>
  );
}

function DarkBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -left-36 -top-36 h-[28rem] w-[28rem] rounded-full bg-orange-500/25 blur-3xl" />
      <div className="absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-sky-500/10 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-orange-300/30" />
      <TopWaveLines className="absolute left-0 top-0 h-80 w-full text-orange-300/20 lg:h-[28rem]" />
      <WaveLines className="absolute -bottom-20 -left-44 h-80 w-[46rem] rotate-180 text-orange-300/20 lg:h-[28rem] lg:w-[58rem]" />
    </div>
  );
}

function TopWaveLines({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 1440 360"
    >
      {Array.from({ length: 10 }).map((_, index) => (
        <path
          d={`M-40 ${112 + index * 10}C176 ${18 + index * 9} 350 ${
            20 + index * 7
          } 558 ${105 + index * 5}C780 ${196 + index * 3} 980 ${
            178 - index * 2
          } 1480 ${48 + index * 8}`}
          key={index}
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
      <path
        d="M1090 0C1196 86 1295 117 1378 92C1404 84 1424 72 1440 58V0H1090Z"
        fill="currentColor"
        opacity="0.16"
      />
    </svg>
  );
}

function WaveLines({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 900 420">
      {Array.from({ length: 10 }).map((_, index) => (
        <path
          d={`M0 ${92 + index * 9}C144 ${22 + index * 8} 248 ${
            18 + index * 6
          } 378 ${96 + index * 4}C521 ${183 + index * 3} 634 ${
            184 - index * 2
          } 900 ${20 + index * 10}`}
          key={index}
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
      <path
        d="M520 0C612 94 697 130 775 108C827 93 868 52 900 0V420H520C591 336 617 244 581 145C565 100 545 52 520 0Z"
        fill="currentColor"
        opacity="0.18"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M4.5 6.75h15v10.5h-15V6.75Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m5 7.25 7 5.5 7-5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PasswordIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M6.75 10.25h10.5v8H6.75v-8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.75 10.25V8.5a3.25 3.25 0 0 1 6.5 0v1.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 13.25v2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M7 10h10v8H7v-8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M9 10V8a3 3 0 0 1 6 0v2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 13v2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 12h15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="m13 6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function AccessNoticeCard({ notice }: { notice: AccessNotice }) {
  const toneClass =
    notice.tone === "error"
      ? "border-red-300/25 bg-red-500/10 text-red-100"
      : "border-amber-300/30 bg-amber-400/10 text-amber-100";

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
    <p className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm leading-6 text-red-100">
      {message}
    </p>
  );
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M3 3l18 18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M10.58 10.58a2 2 0 0 0 2.84 2.84"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M9.47 5.18A8.52 8.52 0 0 1 12 4.8c4.2 0 7.34 3.24 9 7.2a12.8 12.8 0 0 1-2.12 3.34"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M6.1 6.1A12.9 12.9 0 0 0 3 12c1.66 3.96 4.8 7.2 9 7.2a8.9 8.9 0 0 0 4.18-1.04"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M3 12c1.66-3.96 4.8-7.2 9-7.2s7.34 3.24 9 7.2c-1.66 3.96-4.8 7.2-9 7.2S4.66 15.96 3 12Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
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
