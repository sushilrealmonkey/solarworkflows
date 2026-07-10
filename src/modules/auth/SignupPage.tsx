import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import {
  isValidLoginEmail,
  isValidNewPassword,
  isValidSmsPhone,
  normalizeEmail,
  normalizeSmsPhone,
  requestPhoneSignupOtp,
  signUpWithPasswordAndSyncProfile,
  verifyPhoneSignupOtpAndSyncProfile,
  type LoginAccessResult,
} from "../../services/authAccess";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";

type SignupMethod = "phone" | "email";

type SignupNotice = {
  title: string;
  description: string;
  tone: "success" | "warning" | "error";
};

export function SignupPage() {
  const { status, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [signupMethod, setSignupMethod] = useState<SignupMethod>("phone");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
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

  const isBusy = isSubmitting || isRedirecting;

  function selectSignupMethod(method: SignupMethod) {
    if (isBusy) {
      return;
    }

    setSignupMethod(method);
    setErrorMessage(null);
    setNotice(null);
  }

  async function handleEmailSignup(event: FormEvent<HTMLFormElement>) {
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

      await continueAfterAuthenticatedSignup(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePhoneSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    const normalizedPhone = getIndiaSmsPhone(phone);

    if (!/^\d{10}$/.test(phone) || !isValidSmsPhone(normalizedPhone)) {
      setErrorMessage("Enter a valid 10-digit Indian mobile number.");
      return;
    }

    try {
      setIsSubmitting(true);

      if (!isOtpSent) {
        await requestPhoneSignupOtp(normalizedPhone);
        setIsOtpSent(true);
        setNotice({
          title: "SMS code sent",
          description: `Enter the 6-digit code sent to ${normalizedPhone}.`,
          tone: "success",
        });
        return;
      }

      if (!/^\d{6}$/.test(otpCode.trim())) {
        setErrorMessage("Enter the 6-digit SMS code.");
        return;
      }

      const result = await verifyPhoneSignupOtpAndSyncProfile(
        normalizedPhone,
        otpCode,
      );
      await continueAfterAuthenticatedSignup(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setErrorMessage(null);
    setNotice(null);

    try {
      setIsSubmitting(true);
      const normalizedPhone = getIndiaSmsPhone(phone);
      await requestPhoneSignupOtp(normalizedPhone);
      setNotice({
        title: "New SMS code sent",
        description: `Enter the latest 6-digit code sent to ${normalizedPhone}.`,
        tone: "success",
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function continueAfterAuthenticatedSignup(result: LoginAccessResult) {
    if (result.status === "unassigned") {
      setIsRedirecting(true);
      await refresh();
      navigate("/onboarding", { replace: true });
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
  }

  return (
    <AuthThemeShell
      badge="Create account"
      mobileDescription="Sign up with a mobile number and SMS code, or use email and password."
      title="Choose how you want to sign up"
    >
      <AuthThemeCard>
        <p className="text-sm font-semibold text-orange-300">Account setup</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
          Create your account
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Verify your mobile number by SMS, or create an account with your email
          address and password.
        </p>

        <div
          aria-label="Signup method"
          className="mt-6 grid grid-cols-2 rounded-xl border border-white/10 bg-white/[0.05] p-1"
          role="group"
        >
          <SignupMethodButton
            active={signupMethod === "phone"}
            disabled={isBusy}
            label="Mobile & SMS"
            onClick={() => selectSignupMethod("phone")}
          />
          <SignupMethodButton
            active={signupMethod === "email"}
            disabled={isBusy}
            label="Email & password"
            onClick={() => selectSignupMethod("email")}
          />
        </div>

        {notice ? <SignupNoticeCard notice={notice} /> : null}

        {signupMethod === "phone" ? (
          <form className="mt-6 space-y-4" onSubmit={handlePhoneSignup}>
            <label className="block">
              <span className="text-sm font-semibold text-white">Mobile number</span>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex w-16 items-center justify-center border-r border-white/10 text-base font-semibold text-white">
                  +91
                </span>
                <input
                  aria-label="10-digit Indian mobile number"
                  autoComplete="tel-national"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.08] py-3 pl-20 pr-4 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy || isOtpSent}
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) =>
                    setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  placeholder="98765 43210"
                  required
                  type="tel"
                  value={phone}
                />
              </div>
              <span className="mt-2 block text-xs leading-5 text-slate-400">
                India (+91) is selected by default. Standard SMS rates may apply.
              </span>
            </label>

            {isOtpSent ? (
              <>
                <label className="block">
                  <span className="text-sm font-semibold text-white">
                    SMS verification code
                  </span>
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-center text-xl font-semibold tracking-[0.35em] text-white outline-none transition placeholder:text-slate-500 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setOtpCode(event.target.value.replace(/\D/g, ""))
                    }
                    placeholder="000000"
                    required
                    type="text"
                    value={otpCode}
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <button
                    className="font-semibold text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onClick={() => {
                      setIsOtpSent(false);
                      setOtpCode("");
                      setNotice(null);
                      setErrorMessage(null);
                    }}
                    type="button"
                  >
                    Change mobile number
                  </button>
                  <button
                    className="font-semibold text-orange-300 transition hover:text-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onClick={() => void handleResendCode()}
                    type="button"
                  >
                    Resend SMS code
                  </button>
                </div>
              </>
            ) : null}

            <FormError message={errorMessage} />

            <button
              className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              type="submit"
            >
              {isRedirecting
                ? "Opening workspace"
                : isSubmitting
                  ? isOtpSent
                    ? "Verifying code"
                    : "Sending code"
                  : isOtpSent
                    ? "Verify & create account"
                    : "Send SMS code"}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleEmailSignup}>
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
                  : "Create account with email"}
            </button>
          </form>
        )}

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

type SignupMethodButtonProps = {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
};

function SignupMethodButton({
  active,
  disabled,
  label,
  onClick,
}: SignupMethodButtonProps) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition sm:text-sm ${
        active
          ? "bg-orange-500 text-white shadow-lg shadow-orange-950/20"
          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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

function getIndiaSmsPhone(phone: string) {
  return normalizeSmsPhone(`+91${phone}`);
}
