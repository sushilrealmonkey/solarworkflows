-- GST invoices raised by the Bizlee platform for successful tenant subscription charges.

create sequence public.subscription_invoice_number_seq;

create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_number text not null unique default (
    'BZ' || to_char(current_date, 'YY') || '-' ||
    lpad(nextval('public.subscription_invoice_number_seq')::text, 8, '0')
  ),
  razorpay_payment_id text not null unique,
  razorpay_subscription_id text not null,
  razorpay_invoice_id text,
  plan_key text not null check (plan_key in ('starter', 'premium')),
  billing_period text not null check (billing_period in ('monthly', 'yearly')),
  currency text not null default 'INR' check (currency = 'INR'),
  gross_amount_paise integer not null check (gross_amount_paise > 0),
  taxable_amount_paise integer not null check (taxable_amount_paise > 0),
  gst_rate numeric(5,2) not null default 18 check (gst_rate = 18),
  gst_amount_paise integer not null check (gst_amount_paise >= 0),
  cgst_amount_paise integer not null default 0 check (cgst_amount_paise >= 0),
  sgst_amount_paise integer not null default 0 check (sgst_amount_paise >= 0),
  igst_amount_paise integer not null default 0 check (igst_amount_paise >= 0),
  seller_legal_name text not null,
  seller_gstin text not null,
  seller_address text not null,
  buyer_legal_name text not null,
  buyer_gstin text,
  buyer_address text,
  sac_code text,
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null,
  pdf_bucket text not null default 'subscription-invoices',
  pdf_path text,
  created_at timestamptz not null default now(),
  constraint subscription_invoice_amounts_balance check (
    taxable_amount_paise + gst_amount_paise = gross_amount_paise
  ),
  constraint subscription_invoice_tax_components_balance check (
    cgst_amount_paise + sgst_amount_paise + igst_amount_paise = gst_amount_paise
  )
);

create index subscription_invoices_company_issued_idx
on public.subscription_invoices (company_id, issued_at desc);

alter table public.subscription_invoices enable row level security;

create policy "Tenant admins view company subscription invoices"
on public.subscription_invoices for select to authenticated
using (
  company_id = (select public.get_current_user_company_id())
  and (select public.current_user_is_company_admin())
);

grant select on public.subscription_invoices to authenticated;
revoke all on sequence public.subscription_invoice_number_seq
from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subscription-invoices',
  'subscription-invoices',
  false,
  5242880,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Tenant admins download subscription invoice PDFs"
on storage.objects for select to authenticated
using (
  bucket_id = 'subscription-invoices'
  and (storage.foldername(name))[1] =
    (select public.get_current_user_company_id())::text
  and (select public.current_user_is_company_admin())
);

insert into public.notification_templates (
  company_id,
  notification_key,
  provider,
  provider_template_name,
  language_code,
  category,
  approval_status,
  variable_schema
)
values (
  null,
  'subscription_payment_received',
  'meta',
  'bizlee_subscription_payment_received',
  'en_US',
  'utility',
  'active',
  '["first_name","company_name","invoice_number","amount","payment_date"]'::jsonb
)
on conflict (notification_key, language_code) where company_id is null
do update set
  provider_template_name = excluded.provider_template_name,
  category = excluded.category,
  approval_status = excluded.approval_status,
  variable_schema = excluded.variable_schema,
  is_active = true,
  updated_at = now();

insert into public.notification_preferences (
  company_id,
  recipient_id,
  notification_type,
  channel,
  is_enabled,
  consent_status,
  consented_at
)
select
  recipients.company_id,
  recipients.id,
  'subscription_payment_received',
  'whatsapp',
  existing.is_enabled,
  existing.consent_status,
  existing.consented_at
from public.notification_recipients as recipients
join public.notification_preferences as existing
  on existing.company_id = recipients.company_id
  and existing.recipient_id = recipients.id
  and existing.notification_type = 'subscription_action_required'
  and existing.channel = 'whatsapp'
where recipients.verification_status = 'verified'
on conflict (company_id, recipient_id, notification_type, channel)
do nothing;

notify pgrst, 'reload schema';
