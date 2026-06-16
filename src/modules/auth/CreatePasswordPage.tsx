import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import {
  completeInvitedAdminPassword,
  isValidNewPassword,
} from "../../services/authAccess";

type InviteNotice = {
  title: string;
  description: string;
  tone: "warning" | "error";
};

export function CreatePasswordPage() {
  const { session, status, refresh } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<InviteNotice | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (status === "ready") {
    return <Navigate to="/dashboard" replace />;
  }

  const hasInviteSession = Boolean(session);

  async function handleCreatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    if (!hasInviteSession) {
      setNotice({
        title: "Invite link required",
        description:
          "Open the Supabase invite email again to create your EPC admin password.",
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
      const result = await completeInvitedAdminPassword(password);

      if (result.status === "unassigned") {
        setNotice({
          title: "Invite not assigned",
          description:
            "This invite session does not match an EPC company admin profile.",
          tone: "warning",
        });
        return;
      }

      if (result.status === "inactive") {
        setNotice({
          title: "Account inactive",
          description:
            "This EPC company admin profile exists, but it is currently inactive.",
          tone: "error",
        });
        return;
      }

      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative hidden bg-brand-900 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-amber-200/50 bg-amber-200/15 px-3 py-1 text-sm font-semibold text-amber-100">
              EPC invite
            </span>
            <h1 className="mt-8 max-w-lg text-4xl font-semibold tracking-normal">
              Create your admin password
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-emerald-50">
              Your invite has already assigned the company workspace and Admin
              role. Set a password to activate access.
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur">
            <p className="text-sm font-semibold text-emerald-50">
              Tenant protected
            </p>
            <div className="mt-5 grid gap-3">
              <VisualMetric label="Invite email" value="Confirmed" />
              <VisualMetric label="Admin role" value="Pre-assigned" />
              <VisualMetric label="Data access" value="RLS enforced" />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-md">
            <div className="lg:hidden">
              <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                EPC invite
              </span>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal text-slate-950">
                Create your password
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use the invite email link before setting your password.
              </p>
            </div>

            <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6 lg:mt-0">
              <p className="text-sm font-semibold text-brand-600">
                Invite accepted
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal">
                Set password
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This page works only from the Supabase invite email.
              </p>

              {!hasInviteSession && status !== "loading" ? (
                <NoticeCard
                  notice={{
                    title: "Invite link required",
                    description:
                      "Open the Supabase invite email to start a secure password setup session.",
                    tone: "warning",
                  }}
                />
              ) : null}

              {notice ? <NoticeCard notice={notice} /> : null}

              <form className="mt-6 space-y-4" onSubmit={handleCreatePassword}>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Password
                  </span>
                  <input
                    autoComplete="new-password"
                    className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    disabled={isSubmitting || !hasInviteSession}
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
                    Confirm password
                  </span>
                  <input
                    autoComplete="new-password"
                    className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    disabled={isSubmitting || !hasInviteSession}
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
                  className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting || !hasInviteSession}
                  type="submit"
                >
                  {isSubmitting ? "Activating account" : "Create password"}
                </button>
              </form>
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

function NoticeCard({ notice }: { notice: InviteNotice }) {
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Password setup failed. Please try again.";
}
