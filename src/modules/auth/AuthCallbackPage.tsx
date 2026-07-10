import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { safeAuthenticatedRedirect } from "../../app/redirects";
import { syncCurrentAuthUserProfile } from "../../services/authAccess";
import { supabase } from "../../services/supabaseClient";
import { AuthThemeCard, AuthThemeShell } from "./AuthTheme";

type CallbackState =
  | { status: "working"; message: string }
  | { status: "error"; title: string; message: string };

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const hasStarted = useRef(false);
  const [callbackState, setCallbackState] = useState<CallbackState>({
    status: "working",
    message: "Securely completing your sign-in…",
  });

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    async function completeAuthentication() {
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

      if (accessResult.status === "unassigned") {
        await refresh();
        setCallbackState({
          status: "error",
          title: "Workspace access not assigned",
          message:
            "Your identity is verified, but an administrator still needs to assign workspace access.",
        });
        return;
      }

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
      navigate(safeAuthenticatedRedirect(accessResult.profile, "/dashboard"), {
        replace: true,
      });
    }

    void completeAuthentication().catch((error: unknown) => {
      setCallbackState({
        status: "error",
        title: "Sign-in could not be completed",
        message: getErrorMessage(error),
      });
    });
  }, [navigate, refresh]);

  return (
    <AuthThemeShell
      badge="Secure sign-in"
      mobileDescription="We are verifying your account and workspace access."
      title="Completing your secure sign-in"
    >
      <AuthThemeCard>
        {callbackState.status === "working" ? (
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
              to="/login"
            >
              Back to login
            </Link>
          </div>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Authentication could not be completed. Please try again.";
}
