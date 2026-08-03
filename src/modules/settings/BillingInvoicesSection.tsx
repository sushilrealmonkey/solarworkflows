import { useEffect, useState } from "react";
import { Button, EmptyState, LoadingSkeleton } from "../crm/CrmComponents";
import { fetchSubscriptionInvoices, openSubscriptionInvoice } from "./settingsApi";

export type SubscriptionInvoice = {
  id: string;
  invoice_number: string;
  plan_key: "starter" | "premium";
  billing_period: "monthly" | "yearly";
  gross_amount_paise: number;
  taxable_amount_paise: number;
  gst_amount_paise: number;
  gst_rate: number;
  paid_at: string;
  pdf_path: string | null;
};

export function BillingInvoicesSection() {
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscriptionInvoices()
      .then(setInvoices)
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "Unable to load invoices."))
      .finally(() => setLoading(false));
  }, []);

  async function download(invoice: SubscriptionInvoice) {
    if (!invoice.pdf_path) return;
    setDownloading(invoice.id);
    setError(null);
    try {
      await openSubscriptionInvoice(invoice.pdf_path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to download invoice.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Billing & Invoices</h2>
        <p className="mt-1 text-sm text-slate-600">
          Download GST invoices for successful Bizlee subscription payments.
        </p>
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="mt-4"><LoadingSkeleton /></div>
      ) : invoices.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No billing invoices yet"
            description="Invoices appear here after a subscription payment is received."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {invoices.map((invoice) => (
            <article
              className="flex flex-col gap-3 rounded-xl border border-stone-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              key={invoice.id}
            >
              <div>
                <p className="font-semibold text-slate-950">{invoice.invoice_number}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {label(invoice.plan_key)} · {label(invoice.billing_period)} ·{" "}
                  {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" })
                    .format(new Date(invoice.paid_at))}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Taxable {money(invoice.taxable_amount_paise)} + GST {invoice.gst_rate}%{" "}
                  {money(invoice.gst_amount_paise)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-semibold text-slate-950">
                  {money(invoice.gross_amount_paise)}
                </span>
                <Button
                  disabled={!invoice.pdf_path || downloading === invoice.id}
                  onClick={() => void download(invoice)}
                  variant="secondary"
                >
                  {downloading === invoice.id ? "Opening..." : "Download PDF"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
