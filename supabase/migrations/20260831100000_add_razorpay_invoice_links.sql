-- Preserve a GST-compliant Razorpay invoice link when Razorpay already issued one.
-- The branded PDF copy remains available for channels that require a PDF document.

alter table public.subscription_invoices
  add column if not exists invoice_source text not null default 'custom'
    check (invoice_source in ('custom', 'razorpay')),
  add column if not exists razorpay_invoice_number text,
  add column if not exists razorpay_invoice_url text;

create index if not exists subscription_invoices_razorpay_invoice_idx
on public.subscription_invoices (razorpay_invoice_id)
where razorpay_invoice_id is not null;

comment on column public.subscription_invoices.invoice_source is
  'Primary customer-facing invoice source. Razorpay is used only when its returned invoice includes 18% GST and a hosted URL.';
comment on column public.subscription_invoices.razorpay_invoice_url is
  'HTTPS hosted invoice URL returned by Razorpay, normally its short_url.';

notify pgrst, 'reload schema';
