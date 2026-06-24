import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PortalLogo } from "../../components/PortalBrand";
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
    <main className="min-h-screen bg-[#FFF7F0] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-xl items-center justify-center">
        <section className="w-full rounded-lg border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-7">
          <PortalLogo className="h-20 w-full max-w-xs object-contain object-left" />
          <p className="mt-6 inline-flex rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">
            Password help
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">
            Forgot password
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Enter your registered email address and we will send a secure reset
            link.
          </p>

          {isSent ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900">
              <p className="text-sm font-semibold">Check your email</p>
              <p className="mt-1 text-sm leading-6 text-emerald-800">
                If this email is registered, a password reset link has been
                sent. Open it to continue to the reset screen.
              </p>
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={handleSendResetLink}>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Email address
              </span>
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
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
              className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSending}
              type="submit"
            >
              {isSending ? "Sending reset link" : "Send reset link"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm leading-6 text-slate-600">
            Remembered it?{" "}
            <Link className="font-semibold text-orange-700 hover:text-orange-800" to="/login">
              Back to login
            </Link>
          </p>
        </section>
      </div>
    </main>
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Password reset email could not be sent. Please try again.";
}
