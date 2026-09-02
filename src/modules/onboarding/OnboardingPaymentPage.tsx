import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { BillingPlansSection } from "../billing/BillingPlansPage";

export function OnboardingPaymentPage() {
  const navigate = useNavigate();
  const { refreshSubscription, subscription } = useAuth();
  const isActive = subscription?.status === "active";

  useEffect(() => {
    if (isActive) {
      navigate("/dashboard", { replace: true });
      return;
    }

    const pollSubscription = () => {
      void refreshSubscription().catch(() => {
        // Keep the payment screen usable if a background confirmation check fails.
      });
    };

    pollSubscription();
    const intervalId = window.setInterval(() => {
      pollSubscription();
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [isActive, navigate, refreshSubscription]);

  return (
    <AuthThemeShell
      badge="Step 6 of 6 · Payment"
      contentMaxWidthClass="max-w-4xl"
      desktopDescription="Choose a plan and complete secure payment to activate your Bizlee workspace."
      mobileDescription="Choose a plan and pay to activate your workspace."
      title="Activate your workspace"
      workspaceLayout
    >
      <AuthThemeCard>
        <BillingPlansSection />
      </AuthThemeCard>
    </AuthThemeShell>
  );
}
