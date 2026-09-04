import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { isValidPhoneNumber } from "../../services/authAccess";
import {
  cancelRazorpaySubscription,
  createRazorpayCheckout,
  fetchBillingPlans,
  previewRazorpayCheckout,
  verifyRazorpayAuthorization,
} from "./billingApi";
import { checkoutQuoteFromPlan, formatBillingAmount } from "./billingUtils";
import type {
  BillingPeriod,
  BillingPlan,
  CheckoutCustomerDetails,
  CheckoutQuote,
  RazorpayAuthorizationResult,
} from "./types";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill: { name?: string; email?: string; contact?: string };
  theme: { color: string };
  config?: {
    display: {
      blocks: Record<
        string,
        { name: string; instruments: Array<{ method: "upi" }> }
      >;
      sequence: string[];
      preferences: { show_default_blocks: boolean };
    };
  };
  handler: (response: RazorpayAuthorizationResult) => void;
  modal: { ondismiss: () => void };
};

const razorpayUpiAutopayFirst = {
  display: {
    blocks: {
      upi_autopay: {
        name: "Pay with UPI AutoPay",
        instruments: [{ method: "upi" as const }],
      },
    },
    sequence: ["block.upi_autopay"],
    // Keep Razorpay's other eligible recurring methods available as a fallback.
    preferences: { show_default_blocks: true },
  },
} satisfies RazorpayOptions["config"];

const upiAutopayMaximumAmountPaise = 1_500_000;

const features = {
  starter: [
    "3 total users, including the company admin",
    "Leads, enquiries, customers, and site surveys",
    "Product, category, and BOM template masters",
    "Unlimited quotations and customer PDFs",
    "Projects, installation, and project payments",
    "Dashboard and mobile workspace",
  ],
  premium: [
    "Unlimited users",
    "Everything in Core",
    "Dealer and B2B sales",
    "Inventory, suppliers, purchases, and dispatch",
    "Proforma invoices, GST invoices, and commercial payments",
    "Bizlee AI",
  ],
} satisfies Record<BillingPlan["plan_key"], string[]>;

export function BillingPlansPage() {
  return <BillingPlansContent showHeader />;
}

export function BillingPlansSection() {
  return <BillingPlansContent showHeader={false} />;
}

function BillingPlansContent({ showHeader }: { showHeader: boolean }) {
  const { profile, session, subscription, refresh, refreshSubscription } = useAuth();
  const isSuperAdmin = Boolean(profile?.is_super_admin);
  const isOnboarding = !showHeader;
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [billingPeriod, setBillingPeriod] =
    useState<BillingPeriod>("monthly");
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);
  const [customerDetails, setCustomerDetails] =
    useState<CheckoutCustomerDetails>({ name: "", phone: "", email: "" });
  const [couponCode, setCouponCode] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState("");
  const [checkoutQuote, setCheckoutQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const quoteRequestId = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [planLoadAttempt, setPlanLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);

    setLoading(true);
    setError(null);

    void fetchBillingPlans(controller.signal)
      .then((nextPlans) => {
        if (active) setPlans(nextPlans);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(
          timedOut
            ? "Plan details are taking longer than expected. Please try again."
            : nextError instanceof Error
              ? nextError.message
              : "Unable to load plans.",
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [planLoadAttempt]);

  const statusText = useMemo(() => {
    if (!subscription) return null;
    if (subscription.status === "trialing") {
      return `Bizlee Pro trial · ${subscription.days_remaining} days remaining · every feature unlocked`;
    }
    if (subscription.status === "grandfathered") return "Bizlee Pro access";
    return `${subscription.plan_name ?? "No active plan"} · ${subscription.status.replace("_", " ")}`;
  }, [subscription]);

  function openCheckout(plan: BillingPlan) {
    if (!subscription?.is_admin) return;
    const requestId = ++quoteRequestId.current;
    setSelectedPlan(plan);
    setCustomerDetails({
      name: profile?.full_name ?? "",
      phone: profile?.phone ?? session?.user.phone ?? "",
      email: session?.user.email ?? "",
    });
    setCouponCode("");
    setAppliedCouponCode("");
    setCheckoutQuote(checkoutQuoteFromPlan(plan, billingPeriod));
    setQuoteLoading(true);
    setQuoteError(null);
    setCouponError(null);
    setDialogError(null);
    setMessage(null);
    setError(null);

    void previewRazorpayCheckout(plan.plan_key, billingPeriod)
      .then((nextQuote) => {
        if (quoteRequestId.current === requestId) {
          setCheckoutQuote(nextQuote);
        }
      })
      .catch((nextError) => {
        if (quoteRequestId.current === requestId) {
          setQuoteError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to verify the selected plan price.",
          );
        }
      })
      .finally(() => {
        if (quoteRequestId.current === requestId) {
          setQuoteLoading(false);
        }
      });
  }

  function closeCheckout() {
    quoteRequestId.current += 1;
    setSelectedPlan(null);
    setQuoteLoading(false);
  }

  function updateCustomerDetails(
    key: keyof CheckoutCustomerDetails,
    value: string,
  ) {
    setCustomerDetails((current) => ({ ...current, [key]: value }));
    setDialogError(null);
  }

  function updateCouponCode(value: string) {
    quoteRequestId.current += 1;
    setCouponCode(value);
    setAppliedCouponCode("");
    setCouponError(null);
    setDialogError(null);
    setQuoteError(null);
    setQuoteLoading(false);
    if (selectedPlan) {
      setCheckoutQuote(checkoutQuoteFromPlan(selectedPlan, billingPeriod));
    }
  }

  async function applyCoupon() {
    if (!selectedPlan) return;
    const code = couponCode.trim();
    if (!code) {
      setCouponError("Enter a coupon code to apply it.");
      return;
    }

    const requestId = ++quoteRequestId.current;
    setQuoteLoading(true);
    setQuoteError(null);
    setCouponError(null);
    setDialogError(null);

    try {
      const nextQuote = await previewRazorpayCheckout(
        selectedPlan.plan_key,
        billingPeriod,
        code,
      );
      if (quoteRequestId.current !== requestId) return;
      setCheckoutQuote(nextQuote);
      setAppliedCouponCode(code);
    } catch (nextError) {
      if (quoteRequestId.current !== requestId) return;
      setAppliedCouponCode("");
      setCheckoutQuote(checkoutQuoteFromPlan(selectedPlan, billingPeriod));
      setCouponError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to apply this coupon code.",
      );
    } finally {
      if (quoteRequestId.current === requestId) {
        setQuoteLoading(false);
      }
    }
  }

  function validateCustomerDetails() {
    const name = customerDetails.name.trim();
    const phone = customerDetails.phone.trim();
    const email = customerDetails.email.trim();

    if (name.length < 2 || name.length > 120) {
      return "Enter a valid customer name.";
    }
    if (!isValidPhoneNumber(phone)) {
      return "Enter a valid mobile number, including the country code if needed.";
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Enter a valid email address or leave it blank.";
    }
    return null;
  }

  async function continueCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlan || !checkoutQuote || quoteLoading || quoteError) return;

    const customerError = validateCustomerDetails();
    if (customerError) {
      setDialogError(customerError);
      return;
    }
    if (couponCode.trim() && appliedCouponCode !== couponCode.trim()) {
      setCouponError("Apply the coupon code before continuing.");
      return;
    }

    await startCheckout(
      selectedPlan,
      customerDetails,
      appliedCouponCode || undefined,
      checkoutQuote.payableAmountPaise <= upiAutopayMaximumAmountPaise,
    );
  }

  async function startCheckout(
    plan: BillingPlan,
    customer: CheckoutCustomerDetails,
    discountCode?: string,
    preferUpiAutopay = true,
  ) {
    if (!subscription?.is_admin) return;
    setCheckoutPlan(plan.plan_key);
    setDialogError(null);
    setError(null);

    try {
      await loadRazorpayCheckout();
      const checkout = await createRazorpayCheckout(plan.plan_key, billingPeriod, {
        customer,
        discountCode,
      });
      if (checkout.upgradeCompleted) {
        await refresh();
        setMessage(`Your workspace has been updated to ${plan.display_name}.`);
        closeCheckout();
        setCheckoutPlan(null);
        return;
      }
      if (!window.Razorpay) throw new Error("Razorpay Checkout did not load.");

      const instance = new window.Razorpay({
        key: checkout.keyId,
        subscription_id: checkout.subscriptionId!,
        name: "Bizlee",
        description: `${checkout.planName} ${billingPeriod} subscription`,
        prefill: {
          name: checkout.customerName ?? (customer.name || undefined),
          email: checkout.customerEmail ?? (customer.email || undefined),
          contact: checkout.customerPhone ?? (customer.phone || undefined),
        },
        theme: { color: "#f97316" },
        ...(preferUpiAutopay ? { config: razorpayUpiAutopayFirst } : {}),
        handler: (response) => {
          void verifyRazorpayAuthorization(response)
            .then(async () => {
              setMessage(
                "UPI AutoPay mandate authorised. Your plan will activate after webhook confirmation.",
              );
              await refreshSubscription();
            })
            .catch((nextError) => {
              setError(
                nextError instanceof Error
                  ? nextError.message
                  : "Unable to verify the UPI AutoPay mandate.",
              );
            })
            .finally(() => setCheckoutPlan(null));
        },
        modal: { ondismiss: () => setCheckoutPlan(null) },
      });
      instance.open();
      closeCheckout();
    } catch (nextError) {
      setCheckoutPlan(null);
      const message =
        nextError instanceof Error ? nextError.message : "Unable to start checkout.";
      setDialogError(message);
      setError(message);
    }
  }

  async function cancelAtRenewal() {
    if (!window.confirm("Cancel this subscription at the end of its billing period?")) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await cancelRazorpaySubscription();
      await refresh();
      setMessage("Cancellation scheduled. Access continues until the current period ends.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Cancellation failed.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className={isOnboarding ? "space-y-5" : "space-y-6"}>
      {showHeader ? (
        <PageHeader
          title="Billing & Plans"
          description={
            isSuperAdmin
              ? "Review the tenant subscription packages offered by Bizlee."
              : "Choose the Bizlee package that fits your business."
          }
        />
      ) : (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-200">
            Final step
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Billing &amp; Plans</h2>
          <p className="mt-1 text-sm leading-6 text-slate-200">
            Review your current subscription, select Core or Pro, and complete payment securely.
          </p>
        </div>
      )}

      {isSuperAdmin ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
          This is the platform pricing preview. Plan activation and subscription
          changes are completed from an EPC company administrator account.
        </section>
      ) : null}

      {!isOnboarding && statusText ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
            Current access
          </p>
          <p className="mt-1 font-semibold text-slate-950">{statusText}</p>
          {subscription?.current_period_ends_at ? (
            <p className="mt-1 text-sm text-slate-600">
              Renews on{" "}
              {new Intl.DateTimeFormat("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }).format(new Date(subscription.current_period_ends_at))}
            </p>
          ) : null}
          {subscription?.status === "active" &&
          subscription.is_admin &&
          !subscription.cancel_at_period_end ? (
            <button
              className="mt-3 text-sm font-semibold text-rose-700 underline"
              disabled={cancelling}
              onClick={() => void cancelAtRenewal()}
              type="button"
            >
              {cancelling ? "Scheduling cancellation…" : "Cancel at renewal"}
            </button>
          ) : null}
          {subscription?.cancel_at_period_end ? (
            <p className="mt-2 text-sm font-semibold text-rose-700">
              Cancellation is scheduled for the end of this billing period.
            </p>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error && (loading || plans.length > 0) ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </p>
      ) : null}

      <section className="flex justify-center">
        <div className="inline-flex rounded-xl border border-orange-200 bg-white p-1 shadow-sm">
          <button
            className={`min-h-10 rounded-lg px-5 text-sm font-semibold ${
              billingPeriod === "monthly"
                ? "bg-[#06173f] text-white"
                : "text-slate-600"
            }`}
            onClick={() => setBillingPeriod("monthly")}
            type="button"
          >
            Monthly
          </button>
          <button
            className={`min-h-10 rounded-lg px-5 text-sm font-semibold ${
              billingPeriod === "yearly"
                ? "bg-[#06173f] text-white"
                : "text-slate-600"
            }`}
            onClick={() => setBillingPeriod("yearly")}
            type="button"
          >
            Yearly
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              1 month free
            </span>
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {loading
          ? (
            <>
              <p className="sr-only" role="status">
                Loading subscription plans…
              </p>
              {[0, 1].map((item) => (
                <PlanCardSkeleton key={item} />
              ))}
            </>
          )
          : plans.length === 0 ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center md:col-span-2">
              <p className="font-semibold text-rose-950">
                {error ?? "No subscription plans are available right now."}
              </p>
              <p className="mt-1 text-sm leading-6 text-rose-800">
                Check your connection and try loading the plans again.
              </p>
              <button
                className="mt-4 min-h-11 rounded-lg bg-[#06173f] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => setPlanLoadAttempt((attempt) => attempt + 1)}
                type="button"
              >
                Retry loading plans
              </button>
            </section>
          )
          : plans.map((plan) => {
              const isCurrent =
                subscription?.status === "active" &&
                subscription.plan_key === plan.plan_key &&
                subscription.billing_period === billingPeriod;
              const isPro = plan.plan_key === "premium";
              const displayPricePaise =
                billingPeriod === "yearly"
                  ? plan.yearly_price_paise
                  : plan.price_paise;
              const gstAmountPaise = Math.round(displayPricePaise * 18 / 100);
              return (
                <article
                  className={`min-w-0 rounded-2xl border bg-white p-5 shadow-sm ${
                    isPro ? "border-orange-300" : "border-stone-200"
                  }`}
                  key={plan.plan_key}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold text-slate-950">
                      {plan.display_name}
                    </h2>
                    {isPro ? (
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                        Complete workspace
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-4xl font-semibold text-slate-950">
                    ₹{(displayPricePaise / 100).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    <span className="text-sm font-medium text-slate-500">
                      /{billingPeriod === "yearly" ? "year" : "month"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Excluding GST · GST @ 18% ₹{(gstAmountPaise / 100).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} additional
                  </p>
                  {billingPeriod === "yearly" ? (
                    <p className="mt-1 text-sm font-semibold text-emerald-700">
                      Pay for 11 months and get 1 month free
                    </p>
                  ) : null}
                  <ul className="mt-6 space-y-3">
                    {features[plan.plan_key].map((feature) => (
                      <li className="flex gap-2 text-sm text-slate-700" key={feature}>
                        <span className="font-bold text-emerald-600">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="mt-8 min-h-11 w-full rounded-lg bg-[#06173f] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      isSuperAdmin ||
                      !subscription?.is_admin ||
                      isCurrent ||
                      checkoutPlan !== null ||
                      (subscription?.status === "active" &&
                        subscription.plan_key === "premium" &&
                        plan.plan_key === "starter")
                    }
                    onClick={() => openCheckout(plan)}
                    type="button"
                  >
                    {isCurrent
                      ? "Current plan"
                      : checkoutPlan === plan.plan_key
                        ? "Opening secure checkout…"
                        : subscription?.plan_key === "starter" && isPro
                          ? "Upgrade to Pro"
                          : `Choose ${plan.display_name.replace("Bizlee ", "")}`}
                  </button>
                  {!isSuperAdmin && !subscription?.is_admin ? (
                    <p className="mt-2 text-center text-xs text-slate-500">
                      Ask your company administrator to manage billing.
                    </p>
                  ) : null}
                </article>
              );
            })}
      </section>

      {selectedPlan ? (
        <CheckoutDialog
          appliedCouponCode={appliedCouponCode}
          checkoutPlan={checkoutPlan}
          couponCode={couponCode}
          couponError={couponError}
          customerDetails={customerDetails}
          dialogError={dialogError}
          onApplyCoupon={() => void applyCoupon()}
          onClose={closeCheckout}
          onContinue={(event) => void continueCheckout(event)}
          onCouponCodeChange={updateCouponCode}
          onCustomerChange={updateCustomerDetails}
          quote={checkoutQuote}
          quoteError={quoteError}
          quoteLoading={quoteLoading}
          selectedPlan={selectedPlan}
        />
      ) : null}
    </div>
  );
}

function PlanCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="animate-pulse rounded-2xl border border-white/40 bg-white p-5 shadow-sm"
    >
      <div className="h-6 w-32 rounded bg-slate-200" />
      <div className="mt-5 h-10 w-48 rounded bg-slate-200" />
      <div className="mt-3 h-4 w-44 rounded bg-slate-100" />
      <div className="mt-8 space-y-4">
        {[0, 1, 2, 3].map((item) => (
          <div className="h-4 rounded bg-slate-100" key={item} />
        ))}
      </div>
      <div className="mt-8 h-11 rounded-lg bg-slate-200" />
    </article>
  );
}

type CheckoutDialogProps = {
  appliedCouponCode: string;
  checkoutPlan: string | null;
  couponCode: string;
  couponError: string | null;
  customerDetails: CheckoutCustomerDetails;
  dialogError: string | null;
  onApplyCoupon: () => void;
  onClose: () => void;
  onContinue: (event: FormEvent<HTMLFormElement>) => void;
  onCouponCodeChange: (value: string) => void;
  onCustomerChange: (
    key: keyof CheckoutCustomerDetails,
    value: string,
  ) => void;
  quote: CheckoutQuote | null;
  quoteError: string | null;
  quoteLoading: boolean;
  selectedPlan: BillingPlan;
};

function CheckoutDialog({
  appliedCouponCode,
  checkoutPlan,
  couponCode,
  couponError,
  customerDetails,
  dialogError,
  onApplyCoupon,
  onClose,
  onContinue,
  onCouponCodeChange,
  onCustomerChange,
  quote,
  quoteError,
  quoteLoading,
  selectedPlan,
}: CheckoutDialogProps) {
  const busy = checkoutPlan !== null;
  const upiAutopayEligible =
    !quote || quote.payableAmountPaise <= upiAutopayMaximumAmountPaise;

  return (
    <div
      aria-labelledby="checkout-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4"
      role="dialog"
    >
      <form
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onSubmit={onContinue}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">
              Bizlee checkout
            </p>
            <h2 id="checkout-dialog-title" className="mt-1 text-xl font-semibold text-slate-950">
              Review {selectedPlan.display_name}
            </h2>
          </div>
          <button
            aria-label="Close checkout review"
            className="rounded-lg p-2 text-2xl leading-none text-slate-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-4 py-5 sm:px-6">
          {upiAutopayEligible ? (
            <section
              aria-labelledby="upi-autopay-heading"
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-base font-bold text-white"
                >
                  ₹
                </span>
                <div>
                  <h3 id="upi-autopay-heading" className="text-sm font-semibold text-emerald-950">
                    Recommended: UPI AutoPay
                  </h3>
                  <p className="mt-1 text-sm leading-5 text-emerald-900">
                    Authorise once in your UPI app. Razorpay will collect future
                    subscription payments automatically on the plan schedule.
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-950">
              UPI AutoPay supports recurring charges up to ₹15,000. This
              subscription is above that limit, so Razorpay will show another
              eligible recurring payment method.
            </section>
          )}

          <section>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-700">Customer name</span>
                <input
                  autoComplete="name"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm text-slate-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
                  disabled={busy}
                  maxLength={120}
                  onChange={(event) => onCustomerChange("name", event.target.value)}
                  required
                  value={customerDetails.name}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Mobile number</span>
                <input
                  autoComplete="tel"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm text-slate-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
                  disabled={busy}
                  inputMode="tel"
                  maxLength={20}
                  onChange={(event) => onCustomerChange("phone", event.target.value)}
                  required
                  type="tel"
                  value={customerDetails.phone}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Email (optional)</span>
                <input
                  autoComplete="email"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm text-slate-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
                  disabled={busy}
                  maxLength={254}
                  onChange={(event) => onCustomerChange("email", event.target.value)}
                  type="email"
                  value={customerDetails.email}
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="price-summary-heading" className="rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 id="price-summary-heading" className="text-sm font-semibold text-slate-950">
                Price summary
              </h3>
              {quoteLoading ? (
                <span className="text-xs font-medium text-slate-500">Verifying price…</span>
              ) : null}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4 text-slate-600">
                <span>{quote?.billingPeriod === "yearly" ? "Yearly plan" : "Monthly plan"}</span>
                <span>{quote ? formatBillingAmount(quote.baseAmountPaise) : "—"}</span>
              </div>
              <div className="flex justify-between gap-4 text-slate-600">
                <span>GST @ 18%</span>
                <span>{quote ? formatBillingAmount(quote.gstAmountPaise) : "—"}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-stone-200 pt-2 font-medium text-slate-800">
                <span>Price</span>
                <span>{quote ? formatBillingAmount(quote.totalAmountPaise) : "—"}</span>
              </div>
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="checkout-discount-coupon">
                  Discount code
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="checkout-discount-coupon"
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="h-9 min-w-0 w-full max-w-[220px] rounded-md border border-stone-300 bg-white px-2.5 text-xs uppercase text-slate-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
                    disabled={busy || quoteLoading}
                    maxLength={64}
                    onChange={(event) => onCouponCodeChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onApplyCoupon();
                      }
                    }}
                    placeholder="Enter coupon code"
                    spellCheck={false}
                    type="text"
                    value={couponCode}
                  />
                  <button
                    className="h-9 rounded-md border border-[#06173f] px-3.5 text-xs font-semibold text-[#06173f] transition hover:bg-[#06173f] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy || quoteLoading || !couponCode.trim()}
                    onClick={onApplyCoupon}
                    type="button"
                  >
                    {quoteLoading ? "Checking…" : "Apply"}
                  </button>
                </div>
                {appliedCouponCode ? (
                  <p aria-live="polite" className="mt-2 text-xs font-semibold text-emerald-700">
                    Coupon {appliedCouponCode.toUpperCase()} applied.
                  </p>
                ) : null}
                {couponError ? (
                  <p aria-live="polite" className="mt-2 text-xs font-semibold text-rose-700">
                    {couponError}
                  </p>
                ) : null}
              </div>
              {quote?.discountApplied ? (
                <div className="flex justify-between gap-4 text-emerald-700">
                  <span>Coupon discount</span>
                  <span>−{formatBillingAmount(quote.discountAmountPaise)}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t border-stone-300 pt-3 text-base font-bold text-slate-950">
                <span>Payable at Razorpay</span>
                <span>{quote ? formatBillingAmount(quote.payableAmountPaise) : "—"}</span>
              </div>
            </div>
            {quoteError ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
                {quoteError} Close this review and try again.
              </p>
            ) : null}
          </section>

          {dialogError ? (
            <p aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
              {dialogError}
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-stone-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="min-h-11 rounded-lg px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="min-h-11 rounded-lg bg-[#06173f] px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || quoteLoading || Boolean(quoteError) || !quote}
            type="submit"
          >
            {busy
              ? "Opening Razorpay…"
              : upiAutopayEligible
                ? "Continue to UPI AutoPay"
                : "Continue to Razorpay"}
          </button>
        </div>
      </form>
    </div>
  );
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay."));
    document.head.appendChild(script);
  });
}
