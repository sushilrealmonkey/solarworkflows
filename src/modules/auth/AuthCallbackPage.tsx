import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import {
  syncCurrentAuthUserProfile,
  verifySignupToken,
} from "../../services/authAccess";
import { supabase } from "../../services/supabaseClient";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";

type CallbackState =
  | { status: "confirmation" }
  | { status: "working"; message: string }
  | { status: "error"; title: string; message: string };

type SignupLinkState =
  | { kind: "token"; tokenHash: string }
  | { kind: "error" }
  | { kind: "none" };

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const hasStarted = useRef(false);
  const [signupLink] = useState(readSignupLink);
  const [callbackState, setCallbackState] = useState<CallbackState>(() =>
    signupLink.kind === "token"
      ? { status: "confirmation" }
      : signupLink.kind === "error"
        ? {
            status: "error",
            title: "Verification link unavailable",
            message:
              "This verification link is invalid, expired, or has already been used. Create your account again to request a new email.",
          }
        : {
            status: "working",
            message: "Securely completing your sign-in…",
          },
  );

  useEffect(() => {
    if (signupLink.kind !== "none") {
      clearSignupLinkFromAddressBar();
    }

    if (signupLink.kind !== "none" || hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    async function completeExistingSession() {
      if (!supabase) {
        setCallbackState({
          status: "error",
          title: "Authentication unavailable",
          message: "Supabase environment variables are not configured.",
        });
        return;
      }

      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        setCallbackState({
          status: "error",
          title: "Sign-in could not be completed",
          message:
            error?.message ??
            "No authenticated session was returned. Please start the sign-in process again.",
        });
        return;
      }

      const accessResult = await syncCurrentAuthUserProfile();

      if (accessResult.status === "inactive") {
        await refresh();
        setCallbackState({
          status: "error",
          title: "Account inactive",
          message: "Your assigned workspace account is currently inactive.",
        });
        return;
      }

      await refresh();
      navigate("/", { replace: true });
    }

    void completeExistingSession().catch((error: unknown) => {
      setCallbackState({
        status: "error",
        title: "Sign-in could not be completed",
        message: getErrorMessage(error),
      });
    });
  }, [navigate, refresh, signupLink]);

  async function handleConfirmSignup() {
    if (signupLink.kind !== "token") {
      return;
    }

    setCallbackState({
      status: "working",
      message: "Verifying your email address…",
    });

    try {
      await verifySignupToken(signupLink.tokenHash);
      await finishAuthentication();
    } catch (error) {
      showAuthenticationError(error, "Email verification failed");
    }
  }

  async function finishAuthentication() {
    const accessResult = await syncCurrentAuthUserProfile();

    if (accessResult.status === "inactive") {
      await refresh();
      setCallbackState({
        status: "error",
        title: "Account inactive",
        message: "Your assigned workspace account is currently inactive.",
      });
      return;
    }

    await refresh();
    navigate("/", { replace: true });
  }

  function showAuthenticationError(
    error: unknown,
    title = "Sign-in could not be completed",
  ) {
    setCallbackState({
      status: "error",
      title,
      message: getErrorMessage(error),
    });
  }

  return (
    <AuthThemeShell
      badge={callbackState.status === "confirmation" ? "Email verification" : "Secure sign-in"}
      mobileDescription={
        callbackState.status === "confirmation"
          ? "Confirm your email address before creating your Bizlee workspace."
          : "We are verifying your account and workspace access."
      }
      title={
        callbackState.status === "confirmation"
          ? "Verify your email"
          : "Completing your secure sign-in"
      }
    >
      <AuthThemeCard>
        {callbackState.status === "confirmation" ? (
          <div>
            <p className="text-sm font-semibold text-orange-300">
              One step to go
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Confirm your email address
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Click below to securely verify this signup and continue to your
              Bizlee workspace setup.
            </p>
            <button
              className="mt-6 w-full rounded-xl bg-orange-500 px-4 py-3.5 text-sm font-semibold text-white shadow-xl shadow-orange-950/25 transition hover:bg-white hover:text-[#06173f]"
              onClick={() => void handleConfirmSignup()}
              type="button"
            >
              Verify email &amp; continue
            </button>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              Only continue if you requested a new Bizlee account.
            </p>
          </div>
        ) : callbackState.status === "working" ? (
          <div aria-live="polite" className="text-center">
            <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-orange-400" />
            <h2 className="mt-5 text-xl font-semibold text-white">
              Just a moment
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {callbackState.message}
            </p>
          </div>
        ) : (
          <div aria-live="assertive">
            <p className="text-sm font-semibold text-orange-300">Sign-in status</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              {callbackState.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {callbackState.message}
            </p>
            <Link
              className="mt-6 block w-full rounded-xl bg-orange-500 px-4 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-white hover:text-[#06173f]"
              to={signupLink.kind === "none" ? "/login" : "/signup"}
            >
              {signupLink.kind === "none" ? "Back to login" : "Back to signup"}
            </Link>
          </div>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function readSignupLink(): SignupLinkState {
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash")?.trim();
  const type = query.get("type");

  if (tokenHash && type === "signup") {
    return { kind: "token", tokenHash };
  }

  if (query.get("error") || query.get("error_code")) {
    return { kind: "error" };
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (hash.get("error") || hash.get("error_code")) {
    return { kind: "error" };
  }

  return { kind: "none" };
}

function clearSignupLinkFromAddressBar() {
  window.history.replaceState(null, document.title, window.location.pathname);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Authentication could not be completed. Please try again.";
}
