import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import {
  isValidLoginEmail,
  isValidNewPassword,
  normalizeEmail,
  signUpWithPasswordAndSyncProfile,
} from "../../services/authAccess";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";

type SignupNotice = {
  title: string;
  description: string;
  tone: "success" | "warning" | "error";
};

export function SignupPage() {
  const { status, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<SignupNotice | null>(null);

  if (status === "ready" && !isRedirecting) {
    return <Navigate to={safeAuthenticatedRedirect(profile, "/dashboard")} replace />;
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    const normalizedEmail = normalizeEmail(email);

    if (!isValidLoginEmail(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }

    if (!isValidNewPassword(password)) {
      setErrorMessage("Use at least 8 characters for your password.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await signUpWithPasswordAndSyncProfile(
        normalizedEmail,
        password,
        `${window.location.origin}/auth/callback`,
      );

      if (result.status === "confirmation_required") {
        setNotice({
          title: "Check your email",
          description: result.message,
          tone: "success",
        });
        return;
      }

      if (result.status === "unassigned") {
        await refresh();
        setNotice({
          title: "Account created",
          description:
            "Your email is verified, but workspace access still needs to be assigned by an administrator.",
          tone: "warning",
        });
        return;
      }

      if (result.status === "inactive") {
        await refresh();
        setNotice({
          title: "Account inactive",
          description:
            "Your account was created, but its assigned workspace access is inactive.",
          tone: "error",
        });
        return;
      }

      setIsRedirecting(true);
      await refresh();
      navigate(safeAuthenticatedRedirect(result.profile, "/dashboard"), {
        replace: true,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || isRedirecting;

  return (
    <AuthThemeShell
      badge="Create account"
      mobileDescription="Register securely with your work email and a password."
      title="Start with a secure workspace account"
    >
      <AuthThemeCard>
        <p className="text-sm font-semibold text-orange-300">Account setup</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
          Create your account
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Use your email address. Workspace access is assigned separately by an
          administrator.
        </p>

        {notice ? <SignupNoticeCard notice={notice} /> : null}

        <form className="mt-6 space-y-4" onSubmit={handleSignup}>
          <label className="block">
            <span className="text-sm font-semibold text-white">Email address</span>
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <PasswordField
            disabled={isBusy}
            label="Password"
            onChange={setPassword}
            placeholder="At least 8 characters"
            value={password}
            visible={isPasswordVisible}
          />

          <PasswordField
            disabled={isBusy}
            label="Confirm password"
            onChange={setConfirmPassword}
            placeholder="Re-enter your password"
            value={confirmPassword}
            visible={isPasswordVisible}
          />

          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              checked={isPasswordVisible}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-orange-500 focus:ring-orange-400"
              disabled={isBusy}
              onChange={(event) => setIsPasswordVisible(event.target.checked)}
              type="checkbox"
            />
            Show passwords
          </label>

          <FormError message={errorMessage} />

          <button
            className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            type="submit"
          >
            {isRedirecting
              ? "Opening workspace"
              : isSubmitting
                ? "Creating account"
                : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm leading-6 text-slate-300">
          Already have an account?{" "}
          <Link
            className="font-semibold text-orange-300 transition hover:text-orange-200"
            to="/login"
          >
            Sign in
          </Link>
        </p>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

type PasswordFieldProps = {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
  visible: boolean;
};

function PasswordField({
  disabled,
  label,
  onChange,
  placeholder,
  value,
  visible,
}: PasswordFieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-white">{label}</span>
      <input
        autoComplete="new-password"
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        minLength={8}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        type={visible ? "text" : "password"}
        value={value}
      />
    </label>
  );
}

function SignupNoticeCard({ notice }: { notice: SignupNotice }) {
  const toneClass = {
    success: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
    warning: "border-amber-300/30 bg-amber-400/10 text-amber-100",
    error: "border-red-300/25 bg-red-500/10 text-red-100",
  }[notice.tone];

  return (
    <div className={`mt-5 rounded-xl border px-4 py-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{notice.title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-200">
        {notice.description}
      </p>
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

  return "Your account could not be created. Please try again.";
}
