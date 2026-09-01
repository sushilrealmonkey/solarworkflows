import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { BillingPlansSection } from "../billing/BillingPlansPage";

export function OnboardingPaymentPage() {
  const navigate = useNavigate();
  const { refresh, subscription } = useAuth();
  const isActive = subscription?.status === "active";

  useEffect(() => {
    if (isActive) {
      navigate("/dashboard", { replace: true });
      return;
    }

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 4_000);

    return () => window.clearInterval(intervalId);
  }, [isActive, navigate, refresh]);

  return (
    <AuthThemeShell
      badge="Step 6 of 6 · Payment"
      contentMaxWidthClass="max-w-5xl"
      desktopDescription="Choose a plan and complete secure payment to activate your Bizlee workspace."
      mobileDescription="Choose a plan and pay to activate your workspace."
      title="Activate your workspace"
    >
      <div className="[&>div]:!mt-4 [&>div]:!p-4 sm:[&>div]:!p-7 lg:[&>div]:!mt-0 lg:[&>div]:!p-8">
        <AuthThemeCard>
          <p className="mb-5 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-50">
            Your dashboard will open automatically once Razorpay confirms the
            successful payment.
          </p>
          <BillingPlansSection />
        </AuthThemeCard>
      </div>
    </AuthThemeShell>
  );
}
