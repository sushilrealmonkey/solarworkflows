import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { authenticatedHomePath } from "../../app/redirects";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";
import {
  completeInvitedPassword,
  isValidNewPassword,
  verifyInviteToken,
} from "../../services/authAccess";

type InviteNotice = {
  title: string;
  description: string;
  tone: "warning" | "error";
};

export function CreatePasswordPage() {
  const { session, status, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [inviteLink] = useState(readInviteLink);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteVerificationStatus, setInviteVerificationStatus] = useState<
    "pending" | "verifying" | "complete"
  >(
    inviteLink.kind === "token" ? "pending" : "complete",
  );
  const [notice, setNotice] = useState<InviteNotice | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (inviteLink.kind !== "none") {
      clearInviteLinkFromAddressBar();
    }
  }, [inviteLink]);

  const isVerifyingInvite = inviteVerificationStatus === "verifying";
  const isAwaitingInviteConfirmation =
    inviteLink.kind === "token" &&
    inviteVerificationStatus === "pending" &&
    !session;
  const isConfirmingInvite =
    isAwaitingInviteConfirmation || isVerifyingInvite;
  const isCompletingInvitedPassword =
    inviteLink.kind === "token" && inviteVerificationStatus === "complete";

  if (status === "ready" && !isCompletingInvitedPassword) {
    return <Navigate to={authenticatedHomePath(profile)} replace />;
  }

  const hasInviteSession = Boolean(session) && !isVerifyingInvite;
  const canCreatePassword = hasInviteSession && !isConfirmingInvite;
  const cardDescription = canCreatePassword
    ? "Create a password to finish setting up your workspace access."
    : isConfirmingInvite
      ? "Click the button below to confirm your invitation and create password."
      : "Open the invite email link to confirm your invitation and create password.";
  const linkNotice =
    inviteLink.kind === "error"
      ? {
          title: "Invite link expired",
          description:
            "This invitation is invalid, expired, or already used. Ask your administrator to send a new setup email.",
          tone: "error" as const,
        }
      : null;

  async function handleVerifyInvite() {
    if (inviteLink.kind !== "token") {
      return;
    }

    setNotice(null);
    setInviteVerificationStatus("verifying");

    try {
      await verifyInviteToken(inviteLink.tokenHash, inviteLink.type);
      await refresh();
      setInviteVerificationStatus("complete");
    } catch (error) {
      setNotice({
        title: "Invitation could not be verified",
        description: getErrorMessage(error),
        tone: "error",
      });
      setInviteVerificationStatus("pending");
    }
  }

  async function handleCreatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    if (!hasInviteSession) {
      setNotice({
        title: "Invite link required",
        description:
          "Open the Supabase invite email again to create your password.",
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
      const result = await completeInvitedPassword(password);

      if (result.status === "unassigned") {
        setNotice({
          title: "Invite not assigned",
          description:
            "This invite session does not match an assigned staff profile.",
          tone: "warning",
        });
        return;
      }

      if (result.status === "inactive") {
        setNotice({
          title: "Account inactive",
          description:
            "This staff profile exists, but it is currently inactive.",
          tone: "error",
        });
        return;
      }

      await refresh();
      navigate(authenticatedHomePath(result.profile), { replace: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthThemeShell
      badge="Workspace invite"
      mobileDescription="Use the invite email link before setting your password."
      title="Create your password"
    >
      <AuthThemeCard>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
          Confirm Invitation
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {cardDescription}
        </p>

        {isConfirmingInvite ? (
          <InviteVerificationCard
            isVerifying={isVerifyingInvite}
            onConfirm={handleVerifyInvite}
          />
        ) : null}

        {!hasInviteSession &&
        !isVerifyingInvite &&
        !isAwaitingInviteConfirmation &&
        status !== "loading" &&
        !notice &&
        !linkNotice ? (
          <NoticeCard
            notice={{
              title: "Invite link required",
              description:
                "Open the Supabase invite email to start a secure password setup session.",
              tone: "warning",
            }}
          />
        ) : null}

        {linkNotice ? <NoticeCard notice={linkNotice} /> : null}
        {notice ? <NoticeCard notice={notice} /> : null}

        {canCreatePassword ? (
          <form className="mt-6 space-y-4" onSubmit={handleCreatePassword}>
            <label className="block">
              <span className="text-sm font-semibold text-white">
                Password
              </span>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
                type="password"
                value={password}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-white">
                Confirm password
              </span>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.08] px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white/[0.11] focus:ring-4 focus:ring-orange-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
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
              className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Activating account" : "Create password"}
            </button>
          </form>
        ) : null}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function NoticeCard({ notice }: { notice: InviteNotice }) {
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

function InviteVerificationCard({
  isVerifying,
  onConfirm,
}: {
  isVerifying: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-5">
      <button
        className="w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f] active:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isVerifying}
        onClick={onConfirm}
        type="button"
      >
        {isVerifying ? "Verifying invitation" : "Confirm Invitation"}
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

  return "Password setup failed. Please try again.";
}

type InviteLinkState =
  | {
      kind: "token";
      tokenHash: string;
      type: "invite" | "recovery";
    }
  | { kind: "error" }
  | { kind: "none" };

function readInviteLink(): InviteLinkState {
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash")?.trim();
  const type = query.get("type");

  if (tokenHash && (type === "invite" || type === "recovery")) {
    return { kind: "token", tokenHash, type };
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  if (hash.get("error") || hash.get("error_code")) {
    return { kind: "error" };
  }

  return { kind: "none" };
}

function clearInviteLinkFromAddressBar() {
  window.history.replaceState(null, document.title, window.location.pathname);
}
