import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { PageLoader } from "../../components/PageLoader";
import {
  cancelRazorpaySubscription,
  createRazorpayCheckout,
  fetchBillingPlans,
  verifyRazorpayAuthorization,
} from "./billingApi";
import type {
  BillingPeriod,
  BillingPlan,
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
  handler: (response: RazorpayAuthorizationResult) => void;
  modal: { ondismiss: () => void };
};

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
  const { profile, subscription, refresh } = useAuth();
  const isSuperAdmin = Boolean(profile?.is_super_admin);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [billingPeriod, setBillingPeriod] =
    useState<BillingPeriod>("monthly");
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchBillingPlans()
      .then(setPlans)
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "Unable to load plans."),
      )
      .finally(() => setLoading(false));
  }, []);

  const statusText = useMemo(() => {
    if (!subscription) return null;
    if (subscription.status === "trialing") {
      return `Bizlee Pro trial · ${subscription.days_remaining} days remaining · every feature unlocked`;
    }
    if (subscription.status === "grandfathered") return "Bizlee Pro access";
    return `${subscription.plan_name ?? "No active plan"} · ${subscription.status.replace("_", " ")}`;
  }, [subscription]);

  async function startCheckout(plan: BillingPlan) {
    if (!subscription?.is_admin) return;
    setCheckoutPlan(plan.plan_key);
    setMessage(null);
    setError(null);

    try {
      await loadRazorpayCheckout();
      const checkout = await createRazorpayCheckout(
        plan.plan_key,
        billingPeriod,
        discountCode,
      );
      if (checkout.upgradeCompleted) {
        await refresh();
        setMessage(`Your workspace has been updated to ${plan.display_name}.`);
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
          name: checkout.customerName ?? undefined,
          email: checkout.customerEmail ?? undefined,
          contact: checkout.customerPhone ?? undefined,
        },
        theme: { color: "#f97316" },
        handler: (response) => {
          void verifyRazorpayAuthorization(response)
            .then(async () => {
              setMessage(
                "UPI AutoPay mandate authorised. Your plan will activate after webhook confirmation.",
              );
              await refresh();
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
    } catch (nextError) {
      setCheckoutPlan(null);
      setError(
        nextError instanceof Error ? nextError.message : "Unable to start checkout.",
      );
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
    <div className="space-y-6">
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
          <h2 className="text-lg font-semibold text-slate-950">Billing &amp; Plans</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
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

      {statusText ? (
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
      {error ? (
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

      <section className="mx-auto w-full max-w-md rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <label
          className="block text-sm font-semibold text-slate-900"
          htmlFor="billing-discount-code"
        >
          Discount code
        </label>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Optional. Eligible offers are applied securely when checkout opens.
        </p>
        <input
          autoCapitalize="characters"
          autoComplete="off"
          className="mt-3 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm uppercase text-slate-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-100"
          disabled={checkoutPlan !== null}
          id="billing-discount-code"
          maxLength={64}
          onChange={(event) => setDiscountCode(event.target.value)}
          placeholder="Enter discount code"
          spellCheck={false}
          type="text"
          value={discountCode}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {loading
          ? <><div className="lg:col-span-2"><PageLoader label="Loading subscription plans..." /></div>{[0, 1].map((item) => (
              <div className="h-96 animate-pulse rounded-2xl bg-stone-100" key={item} />
            ))}</>
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
              return (
                <article
                  className={`relative rounded-2xl border bg-white p-5 shadow-sm ${
                    isPro ? "border-orange-300" : "border-stone-200"
                  }`}
                  key={plan.plan_key}
                >
                  {isPro ? (
                    <span className="absolute right-4 top-4 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                      Complete workspace
                    </span>
                  ) : null}
                  <h2 className="text-xl font-semibold text-slate-950">
                    {plan.display_name}
                  </h2>
                  <p className="mt-4 text-4xl font-semibold text-slate-950">
                    ₹{(displayPricePaise / 100).toLocaleString("en-IN")}
                    <span className="text-sm font-medium text-slate-500">
                      /{billingPeriod === "yearly" ? "year" : "month"}
                    </span>
                  </p>
                  {billingPeriod === "yearly" ? (
                    <p className="mt-1 text-sm font-semibold text-emerald-700">
                      Pay for 11 months and get 1 month free
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">Plus applicable GST</p>
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
                    onClick={() => void startCheckout(plan)}
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
