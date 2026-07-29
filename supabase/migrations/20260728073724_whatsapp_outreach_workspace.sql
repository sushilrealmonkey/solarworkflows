-- Super-admin-only WhatsApp outreach workspace.

create table public.whatsapp_contact_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  source_filename text,
  contact_count integer not null default 0 check (contact_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);

create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_list_id uuid not null,
  phone_number text not null check (phone_number ~ '^[1-9][0-9]{7,14}$'),
  name text,
  custom_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_fields) = 'object'),
  consent_status text not null default 'confirmed'
    check (consent_status in ('confirmed', 'revoked')),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (contact_list_id, company_id)
    references public.whatsapp_contact_lists(id, company_id) on delete cascade,
  unique (contact_list_id, phone_number),
  unique (id, company_id)
);

create table public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  whatsapp_phone_number_id uuid not null,
  contact_list_id uuid not null,
  name text not null check (btrim(name) <> ''),
  template_name text not null,
  template_language text not null,
  variable_mappings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(variable_mappings) = 'array'),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  batch_size integer not null default 20 check (batch_size between 1 and 100),
  delay_seconds integer not null default 5 check (delay_seconds between 1 and 3600),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (whatsapp_phone_number_id, company_id)
    references public.whatsapp_phone_numbers(id, company_id),
  foreign key (contact_list_id, company_id)
    references public.whatsapp_contact_lists(id, company_id),
  unique (id, company_id)
);

create table public.whatsapp_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null,
  contact_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  whatsapp_message_id uuid references public.whatsapp_messages(id) on delete set null,
  scheduled_at timestamptz,
  attempted_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, company_id)
    references public.whatsapp_campaigns(id, company_id) on delete cascade,
  foreign key (contact_id, company_id)
    references public.whatsapp_contacts(id, company_id) on delete cascade,
  unique (campaign_id, contact_id)
);

create table public.whatsapp_outreach_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  default_batch_size integer not null default 20
    check (default_batch_size between 1 and 100),
  default_delay_seconds integer not null default 5
    check (default_delay_seconds between 1 and 3600),
  opt_out_keywords text[] not null default array['stop', 'unsubscribe'],
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index whatsapp_contacts_company_list_idx
on public.whatsapp_contacts (company_id, contact_list_id);
create index whatsapp_campaigns_company_created_idx
on public.whatsapp_campaigns (company_id, created_at desc);
create index whatsapp_campaign_recipients_campaign_status_idx
on public.whatsapp_campaign_recipients (campaign_id, status);

create trigger set_whatsapp_contact_lists_updated_at before update
on public.whatsapp_contact_lists for each row execute function public.set_updated_at();
create trigger set_whatsapp_campaigns_updated_at before update
on public.whatsapp_campaigns for each row execute function public.set_updated_at();
create trigger set_whatsapp_outreach_settings_updated_at before update
on public.whatsapp_outreach_settings for each row execute function public.set_updated_at();

alter table public.whatsapp_contact_lists enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_campaigns enable row level security;
alter table public.whatsapp_campaign_recipients enable row level security;
alter table public.whatsapp_outreach_settings enable row level security;

create policy "Super admins manage WhatsApp contact lists"
on public.whatsapp_contact_lists for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins manage WhatsApp contacts"
on public.whatsapp_contacts for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins manage WhatsApp campaigns"
on public.whatsapp_campaigns for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins manage WhatsApp campaign recipients"
on public.whatsapp_campaign_recipients for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins manage WhatsApp outreach settings"
on public.whatsapp_outreach_settings for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

revoke all on public.whatsapp_contact_lists, public.whatsapp_contacts,
  public.whatsapp_campaigns, public.whatsapp_campaign_recipients,
  public.whatsapp_outreach_settings from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_contact_lists,
  public.whatsapp_contacts, public.whatsapp_campaigns,
  public.whatsapp_campaign_recipients, public.whatsapp_outreach_settings
  to authenticated, service_role;
