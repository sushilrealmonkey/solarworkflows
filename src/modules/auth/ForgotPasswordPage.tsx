import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";
import {
  isValidLoginEmail,
  normalizeEmail,
  sendPasswordResetLink,
} from "../../services/authAccess";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  async function handleSendResetLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const normalizedEmail = normalizeEmail(email);

    if (!isValidLoginEmail(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }

    try {
      setIsSending(true);
      await sendPasswordResetLink(
        normalizedEmail,
        `${window.location.origin}/reset-password`,
      );
      setIsSent(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AuthThemeShell
      badge="Password help"
      mobileDescription="Enter your registered email address to receive a secure reset link."
      title="Recover workspace access"
    >
      <AuthThemeCard>
        <p className="text-sm font-semibold text-orange-300">
          Password help
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
          Forgot password
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Enter your registered email address and we will send a secure reset
          link.
        </p>

        {isSent ? (
          <div className="mt-6 rounded-xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-4 text-emerald-50">
            <p className="text-sm font-semibold">Check your email</p>
            <p className="mt-1 text-sm leading-6 text-slate-200">
              If this email is registered, a password reset link has been sent.
              Open it to continue to the reset screen.
            </p>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSendResetLink}>
          <label className="block">
            <span className="text-sm font-semibold text-white">
              Email address
            </span>
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSending}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <FormError message={errorMessage} />

          <button
            className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSending}
            type="submit"
          >
            {isSending ? "Sending reset link" : "Send reset link"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm leading-6 text-slate-300">
          Remembered it?{" "}
          <Link
            className="font-semibold text-orange-300 transition hover:text-orange-200"
            to="/login"
          >
            Back to login
          </Link>
        </p>
      </AuthThemeCard>
    </AuthThemeShell>
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

  return "Password reset email could not be sent. Please try again.";
}
