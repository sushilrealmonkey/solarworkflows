import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PortalLogo } from "../../components/PortalBrand";
import {
  completePasswordReset,
  isValidNewPassword,
  verifyInviteToken,
} from "../../services/authAccess";

type ResetNotice = {
  title: string;
  description: string;
  tone: "success" | "warning" | "error";
};

export function ResetPasswordPage() {
  const { session, status, refresh } = useAuth();
  const [resetLink] = useState(readResetLink);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<
    "pending" | "verifying" | "complete"
  >(resetLink.kind === "token" ? "pending" : "complete");
  const [notice, setNotice] = useState<ResetNotice | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (resetLink.kind !== "none") {
      clearResetLinkFromAddressBar();
    }
  }, [resetLink]);

  const isVerifying = verificationStatus === "verifying";
  const isAwaitingConfirmation =
    resetLink.kind === "token" &&
    verificationStatus === "pending" &&
    !session;
  const hasResetSession = Boolean(session) && !isVerifying;
  const linkNotice =
    resetLink.kind === "error"
      ? {
          title: "Reset link expired",
          description:
            "This reset link is invalid, expired, or already used. Request a new password reset email.",
          tone: "error" as const,
        }
      : null;

  async function handleVerifyResetLink() {
    if (resetLink.kind !== "token") {
      return;
    }

    setNotice(null);
    setVerificationStatus("verifying");

    try {
      await verifyInviteToken(resetLink.tokenHash, "recovery");
      await refresh();
      setVerificationStatus("complete");
    } catch (error) {
      setNotice({
        title: "Reset link could not be verified",
        description: getErrorMessage(error),
        tone: "error",
      });
      setVerificationStatus("pending");
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    if (!hasResetSession) {
      setNotice({
        title: "Reset link required",
        description:
          "Open the password reset email again to start a secure reset session.",
        tone: "warning",
      });
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
      await completePasswordReset(password);
      await refresh();
      setPassword("");
      setConfirmPassword("");
      setNotice({
        title: "Password updated",
        description: "Your password has been reset. Sign in with the new password.",
        tone: "success",
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FFF7F0] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-xl items-center justify-center">
        <section className="w-full rounded-lg border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-7">
          <PortalLogo className="h-20 w-full max-w-xs object-contain object-left" />
          <p className="mt-6 inline-flex rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">
            Secure reset
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">
            Reset password
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Set a new password for your registered workspace account.
          </p>

          {isAwaitingConfirmation || isVerifying ? (
            <ResetVerificationCard
              isVerifying={isVerifying}
              onConfirm={handleVerifyResetLink}
            />
          ) : null}

          {!hasResetSession &&
          !isVerifying &&
          !isAwaitingConfirmation &&
          status !== "loading" &&
          !notice &&
          !linkNotice ? (
            <NoticeCard
              notice={{
                title: "Reset link required",
                description:
                  "Open the password reset email to start a secure reset session.",
                tone: "warning",
              }}
            />
          ) : null}

          {linkNotice ? <NoticeCard notice={linkNotice} /> : null}
          {notice ? <NoticeCard notice={notice} /> : null}

          <form className="mt-6 space-y-4" onSubmit={handleResetPassword}>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                New password
              </span>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                disabled={isSubmitting || !hasResetSession}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
                type="password"
                value={password}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Confirm new password
              </span>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                disabled={isSubmitting || !hasResetSession}
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                required
                type="password"
                value={confirmPassword}
              />
            </label>

            <FormError message={errorMessage} />

            <button
              className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || !hasResetSession}
              type="submit"
            >
              {isSubmitting ? "Updating password" : "Update password"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm leading-6 text-slate-600">
            Need a new link?{" "}
            <Link
              className="font-semibold text-orange-700 hover:text-orange-800"
              to="/forgot-password"
            >
              Request reset
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

function ResetVerificationCard({
  isVerifying,
  onConfirm,
}: {
  isVerifying: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-[#06173f]">
      <p className="text-sm font-semibold">Confirm reset link</p>
      <p className="mt-1 text-sm leading-6 text-[#06173f]">
        This extra confirmation protects your one-time reset link from automated
        email link scanners.
      </p>
      <button
        className="mt-3 w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isVerifying}
        onClick={onConfirm}
        type="button"
      >
        {isVerifying ? "Verifying reset link" : "Confirm reset link"}
      </button>
    </div>
  );
}

function NoticeCard({ notice }: { notice: ResetNotice }) {
  const toneClass =
    notice.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-[#06173f]"
      : notice.tone === "error"
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Password reset failed. Please try again.";
}

type ResetLinkState =
  | {
      kind: "token";
      tokenHash: string;
    }
  | { kind: "error" }
  | { kind: "none" };

function readResetLink(): ResetLinkState {
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash")?.trim();
  const type = query.get("type");

  if (tokenHash && type === "recovery") {
    return { kind: "token", tokenHash };
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  if (hash.get("error") || hash.get("error_code")) {
    return { kind: "error" };
  }

  return { kind: "none" };
}

function clearResetLinkFromAddressBar() {
  window.history.replaceState(null, document.title, window.location.pathname);
}
