-- Step 9 quotation module foundation.
-- This migration creates the database layer for solar quotations and quotation
-- line items only. No frontend screens are added here.

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_code text,
  customer_id uuid not null references public.customers(id),
  lead_id uuid references public.leads(id),
  site_survey_id uuid references public.site_surveys(id),
  quotation_date date default current_date,
  valid_until date,
  system_capacity_kw numeric,
  panel_type text,
  inverter_type text,
  structure_type text,
  estimated_generation_units numeric,
  base_amount numeric default 0,
  gst_amount numeric default 0,
  discount_amount numeric default 0,
  total_amount numeric default 0,
  subsidy_amount numeric default 0,
  net_payable_amount numeric default 0,
  payment_terms text,
  terms_and_conditions text,
  status text default 'draft',
  notes text,
  created_by uuid references public.users_profile(id),
  approved_by uuid references public.users_profile(id),
  approved_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.quotations add column if not exists id uuid default gen_random_uuid();
alter table public.quotations add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.quotations add column if not exists quotation_code text;
alter table public.quotations add column if not exists customer_id uuid references public.customers(id);
alter table public.quotations add column if not exists lead_id uuid references public.leads(id);
alter table public.quotations add column if not exists site_survey_id uuid references public.site_surveys(id);
alter table public.quotations add column if not exists quotation_date date default current_date;
alter table public.quotations add column if not exists valid_until date;
alter table public.quotations add column if not exists system_capacity_kw numeric;
alter table public.quotations add column if not exists panel_type text;
alter table public.quotations add column if not exists inverter_type text;
alter table public.quotations add column if not exists structure_type text;
alter table public.quotations add column if not exists estimated_generation_units numeric;
alter table public.quotations add column if not exists base_amount numeric default 0;
alter table public.quotations add column if not exists gst_amount numeric default 0;
alter table public.quotations add column if not exists discount_amount numeric default 0;
alter table public.quotations add column if not exists total_amount numeric default 0;
alter table public.quotations add column if not exists subsidy_amount numeric default 0;
alter table public.quotations add column if not exists net_payable_amount numeric default 0;
alter table public.quotations add column if not exists payment_terms text;
alter table public.quotations add column if not exists terms_and_conditions text;
alter table public.quotations add column if not exists status text default 'draft';
alter table public.quotations add column if not exists notes text;
alter table public.quotations add column if not exists created_by uuid references public.users_profile(id);
alter table public.quotations add column if not exists approved_by uuid references public.users_profile(id);
alter table public.quotations add column if not exists approved_at timestamptz;
alter table public.quotations add column if not exists sent_at timestamptz;
alter table public.quotations add column if not exists accepted_at timestamptz;
alter table public.quotations add column if not exists rejected_at timestamptz;
alter table public.quotations add column if not exists created_at timestamptz default now();
alter table public.quotations add column if not exists updated_at timestamptz default now();

alter table public.quotations alter column id set default gen_random_uuid();
alter table public.quotations alter column organization_id set not null;
alter table public.quotations alter column customer_id set not null;
alter table public.quotations alter column quotation_date set default current_date;
alter table public.quotations alter column base_amount set default 0;
alter table public.quotations alter column gst_amount set default 0;
alter table public.quotations alter column discount_amount set default 0;
alter table public.quotations alter column total_amount set default 0;
alter table public.quotations alter column subsidy_amount set default 0;
alter table public.quotations alter column net_payable_amount set default 0;
alter table public.quotations alter column status set default 'draft';
alter table public.quotations alter column created_at set default now();
alter table public.quotations alter column updated_at set default now();

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  item_type text,
  item_name text not null,
  description text,
  quantity numeric default 1,
  unit text,
  unit_price numeric default 0,
  gst_percent numeric default 0,
  line_total numeric default 0,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.quotation_items add column if not exists id uuid default gen_random_uuid();
alter table public.quotation_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.quotation_items add column if not exists quotation_id uuid references public.quotations(id) on delete cascade;
alter table public.quotation_items add column if not exists item_type text;
alter table public.quotation_items add column if not exists item_name text;
alter table public.quotation_items add column if not exists description text;
alter table public.quotation_items add column if not exists quantity numeric default 1;
alter table public.quotation_items add column if not exists unit text;
alter table public.quotation_items add column if not exists unit_price numeric default 0;
alter table public.quotation_items add column if not exists gst_percent numeric default 0;
alter table public.quotation_items add column if not exists line_total numeric default 0;
alter table public.quotation_items add column if not exists sort_order integer default 0;
alter table public.quotation_items add column if not exists created_at timestamptz default now();
alter table public.quotation_items add column if not exists updated_at timestamptz default now();

alter table public.quotation_items alter column id set default gen_random_uuid();
alter table public.quotation_items alter column organization_id set not null;
alter table public.quotation_items alter column quotation_id set not null;
alter table public.quotation_items alter column item_name set not null;
alter table public.quotation_items alter column quantity set default 1;
alter table public.quotation_items alter column unit_price set default 0;
alter table public.quotation_items alter column gst_percent set default 0;
alter table public.quotation_items alter column line_total set default 0;
alter table public.quotation_items alter column sort_order set default 0;
alter table public.quotation_items alter column created_at set default now();
alter table public.quotation_items alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_status_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_status_check
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'));
  end if;
end;
$$;

create index if not exists quotations_organization_id_idx
on public.quotations (organization_id);

create index if not exists quotations_quotation_code_idx
on public.quotations (quotation_code);

create index if not exists quotations_customer_id_idx
on public.quotations (customer_id);

create index if not exists quotations_lead_id_idx
on public.quotations (lead_id);

create index if not exists quotations_site_survey_id_idx
on public.quotations (site_survey_id);

create index if not exists quotations_status_idx
on public.quotations (status);

create index if not exists quotations_quotation_date_idx
on public.quotations (quotation_date);

create unique index if not exists quotations_organization_quotation_code_unique
on public.quotations (organization_id, quotation_code)
where quotation_code is not null;

create index if not exists quotation_items_organization_id_idx
on public.quotation_items (organization_id);

create index if not exists quotation_items_quotation_id_idx
on public.quotation_items (quotation_id);

-- Generates the next quotation code inside one organization. The advisory lock
-- keeps QUO-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_quotation_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a quotation code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('quotation:' || target_organization_id::text, 0));

  select coalesce(max(substring(quotations.quotation_code from '^QUO-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.quotations
  where quotations.organization_id = target_organization_id
    and quotations.quotation_code ~ '^QUO-[0-9]+$';

  return 'QUO-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills quotation_code when the application does not provide one.
create or replace function public.set_quotation_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quotation_code is null or trim(new.quotation_code) = '' then
    new.quotation_code := public.generate_quotation_code(new.organization_id);
  end if;

  return new;
end;
$$;

-- Ensures linked customers, leads, surveys, and users all belong to the same
-- organization as the quotation.
create or replace function public.set_quotation_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.site_survey_id is not null and not exists (
    select 1
    from public.site_surveys
    where site_surveys.id = new.site_survey_id
      and site_surveys.organization_id = new.organization_id
  ) then
    raise exception 'site_survey_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.approved_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.approved_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'approved_by must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

-- Keeps item organization_id aligned with its quotation and calculates pre-tax
-- line_total as quantity * unit_price.
create or replace function public.set_quotation_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_organization_id uuid;
begin
  select quotations.organization_id
  into parent_organization_id
  from public.quotations
  where quotations.id = new.quotation_id;

  if parent_organization_id is null then
    raise exception 'quotation_id must reference an existing quotation'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := parent_organization_id;
  end if;

  if new.organization_id <> parent_organization_id then
    raise exception 'quotation item organization_id must match the quotation organization_id'
      using errcode = '23503';
  end if;

  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.line_total := new.quantity * new.unit_price;

  return new;
end;
$$;

drop trigger if exists set_quotations_quotation_code on public.quotations;

create trigger set_quotations_quotation_code
before insert on public.quotations
for each row
execute function public.set_quotation_code();

drop trigger if exists set_quotations_tenant_links on public.quotations;

create trigger set_quotations_tenant_links
before insert or update on public.quotations
for each row
execute function public.set_quotation_tenant_links();

drop trigger if exists set_quotations_updated_at on public.quotations;

create trigger set_quotations_updated_at
before update on public.quotations
for each row
execute function public.set_updated_at();

drop trigger if exists set_quotation_items_defaults on public.quotation_items;

create trigger set_quotation_items_defaults
before insert or update on public.quotation_items
for each row
execute function public.set_quotation_item_defaults();

drop trigger if exists set_quotation_items_updated_at on public.quotation_items;

create trigger set_quotation_items_updated_at
before update on public.quotation_items
for each row
execute function public.set_updated_at();

-- Recalculates quotation totals from its line items. line_total is pre-tax.
-- gst_amount is calculated from each line_total and item gst_percent.
create or replace function public.recalculate_quotation_totals(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate a quotation from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('quotations', 'update') then
      raise exception 'Missing quotations update permission'
        using errcode = '42501';
    end if;
  end if;

  select
    coalesce(sum(quotation_items.line_total), 0),
    coalesce(sum(quotation_items.line_total * coalesce(quotation_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.quotation_items
  where quotation_items.quotation_id = target_quotation_id
    and quotation_items.organization_id = quotation_record.organization_id;

  update public.quotations
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = calculated_base_amount + calculated_gst_amount - coalesce(discount_amount, 0),
    net_payable_amount = greatest(
      calculated_base_amount
        + calculated_gst_amount
        - coalesce(discount_amount, 0)
        - coalesce(subsidy_amount, 0),
      0
    ),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

-- Marks a quotation as sent and records sent_at.
create or replace function public.mark_quotation_sent(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to send quotation'
      using errcode = '42501';
  end if;

  update public.quotations
  set
    status = 'sent',
    sent_at = coalesce(sent_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

-- Marks a quotation as accepted and records accepted_at.
create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to accept quotation'
      using errcode = '42501';
  end if;

  update public.quotations
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

-- Marks a quotation as rejected and records rejected_at.
create or replace function public.reject_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to reject quotation'
      using errcode = '42501';
  end if;

  update public.quotations
  set
    status = 'rejected',
    rejected_at = coalesce(rejected_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

grant execute on function public.recalculate_quotation_totals(uuid) to authenticated;
grant execute on function public.mark_quotation_sent(uuid) to authenticated;
grant execute on function public.accept_quotation(uuid) to authenticated;
grant execute on function public.reject_quotation(uuid) to authenticated;

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

-- Super admins can read and write every quotation across every organization.
create policy "Super admins can manage quotations"
on public.quotations
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view quotations in their organization with quotations view permission.
create policy "Organization users can view organization quotations"
on public.quotations
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

-- Organization users can create quotations only inside their organization with quotations create permission.
create policy "Organization users can create organization quotations"
on public.quotations
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'create')
);

-- Organization users can update quotations only inside their organization with quotations update permission.
create policy "Organization users can update organization quotations"
on public.quotations
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);

-- Quotation deletion requires explicit quotations delete permission and never crosses organizations.
create policy "Organization users can delete organization quotations"
on public.quotations
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'delete')
);

-- Super admins can read and write every quotation item across every organization.
create policy "Super admins can manage quotation items"
on public.quotation_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view quotation items in their organization with quotations view permission.
create policy "Organization users can view organization quotation items"
on public.quotation_items
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

-- Organization users can create quotation items only inside their organization with quotations create permission.
create policy "Organization users can create organization quotation items"
on public.quotation_items
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'create')
);

-- Organization users can update quotation items only inside their organization with quotations update permission.
create policy "Organization users can update organization quotation items"
on public.quotation_items
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);

-- Quotation item deletion requires explicit quotations delete permission and never crosses organizations.
create policy "Organization users can delete organization quotation items"
on public.quotation_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'delete')
);
