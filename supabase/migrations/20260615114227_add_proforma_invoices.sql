-- Adds Proforma Invoices as a separate pre-payment finance record.
-- Final invoices remain in public.invoices and can be generated from a paid PI.

create table if not exists public.proforma_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proforma_code text,
  customer_id uuid not null references public.customers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  b2b_sale_id uuid references public.b2b_sales(id) on delete set null,
  final_invoice_id uuid references public.invoices(id) on delete set null,
  proforma_date date default current_date,
  due_date date,
  base_amount numeric not null default 0,
  gst_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  total_amount numeric not null default 0,
  amount_paid numeric not null default 0,
  balance_due numeric not null default 0,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.users_profile(id) on delete set null,
  sent_at timestamptz,
  paid_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proforma_invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proforma_invoice_id uuid not null references public.proforma_invoices(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  item_name text not null,
  description text,
  quantity numeric not null default 1,
  unit text,
  unit_price numeric not null default 0,
  gst_percent numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.proforma_invoices add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.proforma_invoices add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.proforma_invoices add column if not exists proforma_code text;
alter table public.proforma_invoices add column if not exists customer_id uuid references public.customers(id) on delete restrict;
alter table public.proforma_invoices add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.proforma_invoices add column if not exists quotation_id uuid references public.quotations(id) on delete set null;
alter table public.proforma_invoices add column if not exists b2b_sale_id uuid references public.b2b_sales(id) on delete set null;
alter table public.proforma_invoices add column if not exists final_invoice_id uuid references public.invoices(id) on delete set null;
alter table public.proforma_invoices add column if not exists proforma_date date default current_date;
alter table public.proforma_invoices add column if not exists due_date date;
alter table public.proforma_invoices add column if not exists base_amount numeric default 0;
alter table public.proforma_invoices add column if not exists gst_amount numeric default 0;
alter table public.proforma_invoices add column if not exists discount_amount numeric default 0;
alter table public.proforma_invoices add column if not exists total_amount numeric default 0;
alter table public.proforma_invoices add column if not exists amount_paid numeric default 0;
alter table public.proforma_invoices add column if not exists balance_due numeric default 0;
alter table public.proforma_invoices add column if not exists status text default 'draft';
alter table public.proforma_invoices add column if not exists notes text;
alter table public.proforma_invoices add column if not exists created_by uuid references public.users_profile(id) on delete set null;
alter table public.proforma_invoices add column if not exists sent_at timestamptz;
alter table public.proforma_invoices add column if not exists paid_at timestamptz;
alter table public.proforma_invoices add column if not exists converted_at timestamptz;
alter table public.proforma_invoices add column if not exists created_at timestamptz default now();
alter table public.proforma_invoices add column if not exists updated_at timestamptz default now();

alter table public.proforma_invoices alter column id set default gen_random_uuid();
alter table public.proforma_invoices alter column company_id set not null;
alter table public.proforma_invoices alter column organization_id set not null;
alter table public.proforma_invoices alter column customer_id set not null;
alter table public.proforma_invoices alter column proforma_date set default current_date;
alter table public.proforma_invoices alter column base_amount set not null;
alter table public.proforma_invoices alter column base_amount set default 0;
alter table public.proforma_invoices alter column gst_amount set not null;
alter table public.proforma_invoices alter column gst_amount set default 0;
alter table public.proforma_invoices alter column discount_amount set not null;
alter table public.proforma_invoices alter column discount_amount set default 0;
alter table public.proforma_invoices alter column total_amount set not null;
alter table public.proforma_invoices alter column total_amount set default 0;
alter table public.proforma_invoices alter column amount_paid set not null;
alter table public.proforma_invoices alter column amount_paid set default 0;
alter table public.proforma_invoices alter column balance_due set not null;
alter table public.proforma_invoices alter column balance_due set default 0;
alter table public.proforma_invoices alter column status set not null;
alter table public.proforma_invoices alter column status set default 'draft';
alter table public.proforma_invoices alter column created_at set not null;
alter table public.proforma_invoices alter column created_at set default now();
alter table public.proforma_invoices alter column updated_at set not null;
alter table public.proforma_invoices alter column updated_at set default now();

alter table public.proforma_invoice_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.proforma_invoice_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.proforma_invoice_items add column if not exists proforma_invoice_id uuid references public.proforma_invoices(id) on delete cascade;
alter table public.proforma_invoice_items add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.proforma_invoice_items add column if not exists item_name text;
alter table public.proforma_invoice_items add column if not exists description text;
alter table public.proforma_invoice_items add column if not exists quantity numeric default 1;
alter table public.proforma_invoice_items add column if not exists unit text;
alter table public.proforma_invoice_items add column if not exists unit_price numeric default 0;
alter table public.proforma_invoice_items add column if not exists gst_percent numeric default 0;
alter table public.proforma_invoice_items add column if not exists line_total numeric default 0;
alter table public.proforma_invoice_items add column if not exists sort_order integer default 0;
alter table public.proforma_invoice_items add column if not exists created_at timestamptz default now();
alter table public.proforma_invoice_items add column if not exists updated_at timestamptz default now();

alter table public.proforma_invoice_items alter column id set default gen_random_uuid();
alter table public.proforma_invoice_items alter column company_id set not null;
alter table public.proforma_invoice_items alter column organization_id set not null;
alter table public.proforma_invoice_items alter column proforma_invoice_id set not null;
alter table public.proforma_invoice_items alter column item_name set not null;
alter table public.proforma_invoice_items alter column quantity set not null;
alter table public.proforma_invoice_items alter column quantity set default 1;
alter table public.proforma_invoice_items alter column unit_price set not null;
alter table public.proforma_invoice_items alter column unit_price set default 0;
alter table public.proforma_invoice_items alter column gst_percent set not null;
alter table public.proforma_invoice_items alter column gst_percent set default 0;
alter table public.proforma_invoice_items alter column line_total set not null;
alter table public.proforma_invoice_items alter column line_total set default 0;
alter table public.proforma_invoice_items alter column sort_order set not null;
alter table public.proforma_invoice_items alter column sort_order set default 0;
alter table public.proforma_invoice_items alter column created_at set not null;
alter table public.proforma_invoice_items alter column created_at set default now();
alter table public.proforma_invoice_items alter column updated_at set not null;
alter table public.proforma_invoice_items alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proforma_invoices_status_check'
      and conrelid = 'public.proforma_invoices'::regclass
  ) then
    alter table public.proforma_invoices
    add constraint proforma_invoices_status_check
    check (status in ('draft', 'sent', 'partially_paid', 'paid', 'converted', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proforma_invoices_amounts_nonnegative_check'
      and conrelid = 'public.proforma_invoices'::regclass
  ) then
    alter table public.proforma_invoices
    add constraint proforma_invoices_amounts_nonnegative_check
    check (
      base_amount >= 0
      and gst_amount >= 0
      and discount_amount >= 0
      and total_amount >= 0
      and amount_paid >= 0
      and balance_due >= 0
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proforma_invoice_items_amounts_nonnegative_check'
      and conrelid = 'public.proforma_invoice_items'::regclass
  ) then
    alter table public.proforma_invoice_items
    add constraint proforma_invoice_items_amounts_nonnegative_check
    check (
      quantity > 0
      and unit_price >= 0
      and gst_percent >= 0
      and line_total >= 0
      and sort_order >= 0
    );
  end if;
end;
$$;

create unique index if not exists proforma_invoices_company_code_unique
on public.proforma_invoices (company_id, proforma_code)
where proforma_code is not null;

create unique index if not exists proforma_invoices_final_invoice_unique
on public.proforma_invoices (final_invoice_id)
where final_invoice_id is not null;

create index if not exists proforma_invoices_company_id_idx on public.proforma_invoices (company_id);
create index if not exists proforma_invoices_organization_id_idx on public.proforma_invoices (organization_id);
create index if not exists proforma_invoices_customer_id_idx on public.proforma_invoices (customer_id);
create index if not exists proforma_invoices_project_id_idx on public.proforma_invoices (project_id) where project_id is not null;
create index if not exists proforma_invoices_quotation_id_idx on public.proforma_invoices (quotation_id) where quotation_id is not null;
create index if not exists proforma_invoices_b2b_sale_id_idx on public.proforma_invoices (b2b_sale_id) where b2b_sale_id is not null;
create index if not exists proforma_invoices_status_idx on public.proforma_invoices (organization_id, status);
create index if not exists proforma_invoices_date_idx on public.proforma_invoices (proforma_date);

create index if not exists proforma_invoice_items_company_id_idx on public.proforma_invoice_items (company_id);
create index if not exists proforma_invoice_items_organization_id_idx on public.proforma_invoice_items (organization_id);
create index if not exists proforma_invoice_items_proforma_invoice_id_idx on public.proforma_invoice_items (proforma_invoice_id);
create index if not exists proforma_invoice_items_inventory_item_id_idx on public.proforma_invoice_items (inventory_item_id) where inventory_item_id is not null;

alter table public.payments
add column if not exists proforma_invoice_id uuid references public.proforma_invoices(id) on delete set null;

alter table public.invoices
add column if not exists proforma_invoice_id uuid references public.proforma_invoices(id) on delete set null;

alter table public.documents
add column if not exists proforma_invoice_id uuid references public.proforma_invoices(id) on delete set null;

alter table public.b2b_sales
add column if not exists proforma_invoice_id uuid references public.proforma_invoices(id) on delete set null;

create index if not exists payments_proforma_invoice_id_idx
on public.payments (proforma_invoice_id)
where proforma_invoice_id is not null;

create index if not exists invoices_proforma_invoice_id_idx
on public.invoices (proforma_invoice_id)
where proforma_invoice_id is not null;

create index if not exists documents_proforma_invoice_id_idx
on public.documents (proforma_invoice_id)
where proforma_invoice_id is not null;

create index if not exists b2b_sales_proforma_invoice_id_idx
on public.b2b_sales (proforma_invoice_id)
where proforma_invoice_id is not null;

alter table public.documents
drop constraint if exists documents_document_type_check;

alter table public.documents
add constraint documents_document_type_check
check (
  document_type in (
    'aadhaar',
    'pan',
    'electricity_bill',
    'property_document',
    'quotation_pdf',
    'proforma_invoice_pdf',
    'invoice_pdf',
    'purchase_order_pdf',
    'payment_receipt',
    'site_photo',
    'installation_photo',
    'subsidy_document',
    'bank_loan_document',
    'agreement',
    'other'
  )
);

create or replace function public.generate_proforma_invoice_code(target_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_company_id is null then
    raise exception 'company_id is required to generate a proforma invoice code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('proforma_invoice:' || target_company_id::text, 0));

  select coalesce(max(substring(proforma_invoices.proforma_code from '^PI-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.proforma_invoices
  where proforma_invoices.company_id = target_company_id
    and proforma_invoices.proforma_code ~ '^PI-[0-9]+$';

  return 'PI-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.set_proforma_invoice_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.users_profile%rowtype;
begin
  select *
  into current_profile
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if new.company_id is null then
    new.company_id := current_profile.company_id;
  end if;

  if new.organization_id is null then
    new.organization_id := current_profile.organization_id;
  end if;

  if new.company_id is null then
    raise exception 'company_id is required for proforma invoices'
      using errcode = '23502';
  end if;

  if new.organization_id is null then
    raise exception 'organization_id is required for proforma invoices'
      using errcode = '23502';
  end if;

  if new.proforma_code is null or trim(new.proforma_code) = '' then
    new.proforma_code := public.generate_proforma_invoice_code(new.company_id);
  end if;

  new.proforma_date := coalesce(new.proforma_date, current_date);
  new.base_amount := coalesce(new.base_amount, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);
  new.amount_paid := coalesce(new.amount_paid, 0);
  new.balance_due := coalesce(new.balance_due, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the proforma invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and projects.customer_id = new.customer_id
  ) then
    raise exception 'project_id must belong to the same organization and customer as the proforma invoice'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
      and quotations.customer_id = new.customer_id
  ) then
    raise exception 'quotation_id must belong to the same organization and customer as the proforma invoice'
      using errcode = '23503';
  end if;

  if new.b2b_sale_id is not null and not exists (
    select 1
    from public.b2b_sales
    where b2b_sales.id = new.b2b_sale_id
      and b2b_sales.company_id = new.company_id
      and b2b_sales.organization_id = new.organization_id
      and b2b_sales.customer_id = new.customer_id
  ) then
    raise exception 'b2b_sale_id must belong to the same company, organization, and customer as the proforma invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and new.b2b_sale_id is not null then
    raise exception 'A proforma invoice cannot be linked to both a project and a B2B sale'
      using errcode = '23514';
  end if;

  if new.project_id is not null
    and new.quotation_id is not null
    and not exists (
      select 1
      from public.projects
      where projects.id = new.project_id
        and projects.quotation_id = new.quotation_id
    ) then
    raise exception 'quotation_id must match the linked project quotation when both are provided'
      using errcode = '23503';
  end if;

  if new.final_invoice_id is not null and not exists (
    select 1
    from public.invoices
    where invoices.id = new.final_invoice_id
      and invoices.organization_id = new.organization_id
      and invoices.customer_id = new.customer_id
  ) then
    raise exception 'final_invoice_id must belong to the same organization and customer as the proforma invoice'
      using errcode = '23503';
  end if;

  if new.created_by is null then
    new.created_by := current_profile.id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the proforma invoice'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.set_proforma_invoice_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_record public.proforma_invoices%rowtype;
  item_organization_id uuid;
begin
  select *
  into parent_record
  from public.proforma_invoices
  where proforma_invoices.id = new.proforma_invoice_id;

  if not found then
    raise exception 'proforma_invoice_id must reference an existing proforma invoice'
      using errcode = '23503';
  end if;

  if parent_record.status in ('converted', 'cancelled') then
    raise exception 'Items cannot be changed after a proforma invoice is converted or cancelled'
      using errcode = '23514';
  end if;

  new.company_id := parent_record.company_id;
  new.organization_id := parent_record.organization_id;

  if new.inventory_item_id is not null then
    select inventory_items.organization_id
    into item_organization_id
    from public.inventory_items
    where inventory_items.id = new.inventory_item_id;

    if item_organization_id is null or item_organization_id <> parent_record.organization_id then
      raise exception 'inventory_item_id must belong to the same organization as the proforma invoice'
        using errcode = '23503';
    end if;
  end if;

  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.line_total := new.quantity * new.unit_price;
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

create or replace function public.recalculate_proforma_invoice_totals(target_proforma_invoice_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  calculated_total_amount numeric;
  calculated_amount_paid numeric;
  calculated_balance_due numeric;
  next_status text;
begin
  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not (
        public.user_has_permission('invoices', 'update')
        or public.user_has_permission('invoices', 'create')
        or public.user_has_permission('payments', 'create')
        or public.user_has_permission('payments', 'update')
        or public.user_has_permission('payments', 'delete')
      )
    ) then
    raise exception 'Missing permission to recalculate proforma invoice totals'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(proforma_invoice_items.line_total), 0),
    coalesce(sum(proforma_invoice_items.line_total * coalesce(proforma_invoice_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.proforma_invoice_items
  where proforma_invoice_items.proforma_invoice_id = target_proforma_invoice_id
    and proforma_invoice_items.organization_id = proforma_record.organization_id;

  calculated_total_amount := greatest(
    calculated_base_amount
      + calculated_gst_amount
      - coalesce(proforma_record.discount_amount, 0),
    0
  );

  select coalesce(sum(payments.amount), 0)
  into calculated_amount_paid
  from public.payments
  where payments.proforma_invoice_id = proforma_record.id
    and payments.organization_id = proforma_record.organization_id
    and payments.status = 'received';

  calculated_balance_due := greatest(calculated_total_amount - calculated_amount_paid, 0);

  next_status := case
    when proforma_record.status = 'cancelled' then 'cancelled'
    when proforma_record.status = 'converted' then 'converted'
    when calculated_total_amount > 0 and calculated_balance_due <= 0 then 'paid'
    when calculated_amount_paid > 0 and calculated_balance_due > 0 then 'partially_paid'
    when proforma_record.status = 'draft' then 'draft'
    else 'sent'
  end;

  update public.proforma_invoices
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = calculated_total_amount,
    amount_paid = calculated_amount_paid,
    balance_due = calculated_balance_due,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(public.proforma_invoices.paid_at, now())
      when next_status in ('partially_paid', 'sent', 'draft') then null
      else public.proforma_invoices.paid_at
    end,
    updated_at = now()
  where proforma_invoices.id = target_proforma_invoice_id
  returning * into proforma_record;

  return proforma_record;
end;
$$;

create or replace function public.refresh_proforma_invoice_totals_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_proforma_invoice_totals(coalesce(new.proforma_invoice_id, old.proforma_invoice_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.mark_proforma_invoice_sent(target_proforma_invoice_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
begin
  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if proforma_record.status in ('cancelled', 'converted') then
    raise exception 'Cancelled or converted proforma invoices cannot be sent'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'update')
    ) then
    raise exception 'Missing permission to send proforma invoice'
      using errcode = '42501';
  end if;

  update public.proforma_invoices
  set
    status = case
      when status in ('paid', 'partially_paid') then status
      else 'sent'
    end,
    sent_at = coalesce(sent_at, now()),
    updated_at = now()
  where proforma_invoices.id = target_proforma_invoice_id
  returning * into proforma_record;

  return proforma_record;
end;
$$;

create or replace function public.mark_proforma_invoice_cancelled(target_proforma_invoice_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
begin
  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if proforma_record.status = 'converted' then
    raise exception 'Converted proforma invoices cannot be cancelled'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'update')
    ) then
    raise exception 'Missing permission to cancel proforma invoice'
      using errcode = '42501';
  end if;

  update public.proforma_invoices
  set status = 'cancelled', updated_at = now()
  where proforma_invoices.id = target_proforma_invoice_id
  returning * into proforma_record;

  return proforma_record;
end;
$$;

create or replace function public.create_proforma_invoice_from_b2b_sale(target_sale_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  proforma_record public.proforma_invoices%rowtype;
  current_profile_id uuid;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'cancelled' then
    raise exception 'Cancelled B2B sales cannot be billed'
      using errcode = '23514';
  end if;

  if sale_record.proforma_invoice_id is not null then
    select *
    into proforma_record
    from public.proforma_invoices
    where proforma_invoices.id = sale_record.proforma_invoice_id;

    if found then
      return proforma_record;
    end if;
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
      or not public.user_has_permission('b2b_sales', 'view')
    ) then
    raise exception 'Missing permission to create proforma invoice from B2B sale'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
  ) then
    raise exception 'Add at least one item before creating a B2B proforma invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.proforma_invoices (
    company_id,
    organization_id,
    customer_id,
    b2b_sale_id,
    proforma_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    sale_record.company_id,
    sale_record.organization_id,
    sale_record.customer_id,
    sale_record.id,
    current_date,
    sale_record.discount_amount,
    'draft',
    'Proforma invoice generated from B2B sale ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  )
  returning * into proforma_record;

  insert into public.proforma_invoice_items (
    company_id,
    organization_id,
    proforma_invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    sort_order
  )
  select
    sale_record.company_id,
    sale_record.organization_id,
    proforma_record.id,
    b2b_sale_items.inventory_item_id,
    b2b_sale_items.item_name,
    b2b_sale_items.description,
    b2b_sale_items.quantity,
    b2b_sale_items.unit,
    b2b_sale_items.unit_price,
    b2b_sale_items.gst_percent,
    b2b_sale_items.sort_order
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = sale_record.id
  order by b2b_sale_items.sort_order, b2b_sale_items.created_at;

  update public.b2b_sales
  set proforma_invoice_id = proforma_record.id, updated_at = now()
  where b2b_sales.id = sale_record.id;

  return public.recalculate_proforma_invoice_totals(proforma_record.id);
end;
$$;

create or replace function public.create_invoice_from_proforma_invoice(target_proforma_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
  invoice_record public.invoices%rowtype;
  current_profile_id uuid;
begin
  perform public.recalculate_proforma_invoice_totals(target_proforma_invoice_id);

  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if proforma_record.status = 'cancelled' then
    raise exception 'Cancelled proforma invoices cannot be converted'
      using errcode = '23514';
  end if;

  if proforma_record.status = 'converted' then
    if proforma_record.final_invoice_id is not null then
      select *
      into invoice_record
      from public.invoices
      where invoices.id = proforma_record.final_invoice_id;

      if found then
        return invoice_record;
      end if;
    end if;

    raise exception 'This proforma invoice is already converted'
      using errcode = '23514';
  end if;

  if proforma_record.status <> 'paid' then
    raise exception 'Proforma invoice must be fully paid before creating a final invoice'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
    ) then
    raise exception 'Missing permission to create invoice from proforma invoice'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.proforma_invoice_items
    where proforma_invoice_items.proforma_invoice_id = proforma_record.id
  ) then
    raise exception 'Add at least one item before creating a final invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.invoices (
    organization_id,
    customer_id,
    project_id,
    quotation_id,
    b2b_sale_id,
    proforma_invoice_id,
    invoice_date,
    due_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    proforma_record.organization_id,
    proforma_record.customer_id,
    proforma_record.project_id,
    proforma_record.quotation_id,
    proforma_record.b2b_sale_id,
    proforma_record.id,
    current_date,
    proforma_record.due_date,
    proforma_record.discount_amount,
    'draft',
    'Invoice generated from proforma invoice ' || coalesce(proforma_record.proforma_code, proforma_record.id::text),
    current_profile_id
  )
  returning * into invoice_record;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    sort_order
  )
  select
    proforma_record.organization_id,
    invoice_record.id,
    proforma_invoice_items.inventory_item_id,
    proforma_invoice_items.item_name,
    proforma_invoice_items.description,
    proforma_invoice_items.quantity,
    proforma_invoice_items.unit,
    proforma_invoice_items.unit_price,
    proforma_invoice_items.gst_percent,
    proforma_invoice_items.sort_order
  from public.proforma_invoice_items
  where proforma_invoice_items.proforma_invoice_id = proforma_record.id
  order by proforma_invoice_items.sort_order, proforma_invoice_items.created_at;

  update public.payments
  set invoice_id = invoice_record.id, updated_at = now()
  where payments.proforma_invoice_id = proforma_record.id
    and payments.organization_id = proforma_record.organization_id
    and payments.invoice_id is null;

  update public.proforma_invoices
  set
    final_invoice_id = invoice_record.id,
    status = 'converted',
    converted_at = coalesce(converted_at, now()),
    updated_at = now()
  where proforma_invoices.id = proforma_record.id;

  if proforma_record.b2b_sale_id is not null then
    update public.b2b_sales
    set invoice_id = invoice_record.id, updated_at = now()
    where b2b_sales.id = proforma_record.b2b_sale_id;
  end if;

  update public.invoices
  set proforma_invoice_id = proforma_record.id, updated_at = now()
  where invoices.id = invoice_record.id;

  return public.recalculate_invoice_totals(invoice_record.id);
end;
$$;

create or replace function public.set_payment_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  resolved_customer_id uuid;
  resolved_project_id uuid;
  resolved_quotation_id uuid;
  resolved_invoice_id uuid;
  resolved_b2b_sale_id uuid;
  resolved_proforma_invoice_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.project_id is null
    and new.invoice_id is null
    and new.b2b_sale_id is null
    and new.proforma_invoice_id is null then
    raise exception 'payment must be linked to a project, invoice, B2B sale, or proforma invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null then
    select projects.customer_id, projects.quotation_id
    into resolved_customer_id, resolved_quotation_id
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment project must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        new.quotation_id is not null
        and resolved_quotation_id is distinct from new.quotation_id
      ) then
      raise exception 'payment project, customer, and quotation must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.proforma_invoice_id is not null then
    select
      proforma_invoices.customer_id,
      proforma_invoices.project_id,
      proforma_invoices.quotation_id,
      proforma_invoices.b2b_sale_id,
      proforma_invoices.final_invoice_id
    into
      resolved_customer_id,
      resolved_project_id,
      resolved_quotation_id,
      resolved_b2b_sale_id,
      resolved_invoice_id
    from public.proforma_invoices
    where proforma_invoices.id = new.proforma_invoice_id
      and proforma_invoices.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment proforma invoice must belong to the same organization'
        using errcode = '23503';
    end if;

    new.customer_id := coalesce(new.customer_id, resolved_customer_id);
    new.project_id := coalesce(new.project_id, resolved_project_id);
    new.quotation_id := coalesce(new.quotation_id, resolved_quotation_id);
    new.b2b_sale_id := coalesce(new.b2b_sale_id, resolved_b2b_sale_id);
    new.invoice_id := coalesce(new.invoice_id, resolved_invoice_id);

    if new.customer_id <> resolved_customer_id
      or (
        resolved_project_id is not null
        and new.project_id is not null
        and new.project_id <> resolved_project_id
      )
      or (
        resolved_quotation_id is not null
        and new.quotation_id is not null
        and new.quotation_id <> resolved_quotation_id
      )
      or (
        resolved_b2b_sale_id is not null
        and new.b2b_sale_id is not null
        and new.b2b_sale_id <> resolved_b2b_sale_id
      )
      or (
        resolved_invoice_id is not null
        and new.invoice_id is not null
        and new.invoice_id <> resolved_invoice_id
      ) then
      raise exception 'payment proforma invoice links must belong to the same organization and customer'
        using errcode = '23503';
    end if;
  end if;

  if new.b2b_sale_id is not null then
    select b2b_sales.customer_id, b2b_sales.invoice_id, b2b_sales.proforma_invoice_id
    into resolved_customer_id, resolved_invoice_id, resolved_proforma_invoice_id
    from public.b2b_sales
    where b2b_sales.id = new.b2b_sale_id
      and b2b_sales.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment B2B sale must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.invoice_id is null then
      new.invoice_id := resolved_invoice_id;
    end if;

    if new.proforma_invoice_id is null then
      new.proforma_invoice_id := resolved_proforma_invoice_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        resolved_invoice_id is not null
        and new.invoice_id is not null
        and new.invoice_id <> resolved_invoice_id
      )
      or (
        resolved_proforma_invoice_id is not null
        and new.proforma_invoice_id is not null
        and new.proforma_invoice_id <> resolved_proforma_invoice_id
      ) then
      raise exception 'payment B2B sale, invoice, proforma invoice, and customer must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.invoice_id is not null then
    select invoices.customer_id, invoices.b2b_sale_id, invoices.proforma_invoice_id
    into resolved_customer_id, resolved_b2b_sale_id, resolved_proforma_invoice_id
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id;

    if resolved_customer_id is null then
      raise exception 'payment invoice must belong to the same organization'
        using errcode = '23503';
    end if;

    if new.customer_id is null then
      new.customer_id := resolved_customer_id;
    end if;

    if new.b2b_sale_id is null then
      new.b2b_sale_id := resolved_b2b_sale_id;
    end if;

    if new.proforma_invoice_id is null then
      new.proforma_invoice_id := resolved_proforma_invoice_id;
    end if;

    if new.customer_id <> resolved_customer_id
      or (
        resolved_b2b_sale_id is not null
        and new.b2b_sale_id is not null
        and new.b2b_sale_id <> resolved_b2b_sale_id
      )
      or (
        resolved_proforma_invoice_id is not null
        and new.proforma_invoice_id is not null
        and new.proforma_invoice_id <> resolved_proforma_invoice_id
      ) then
      raise exception 'payment invoice, B2B sale, proforma invoice, and customer must belong to the same organization'
        using errcode = '23503';
    end if;
  end if;

  if new.customer_id is null then
    raise exception 'customer_id is required for payments'
      using errcode = '23502';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the payment'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.recalculate_payment_summary_after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice_id uuid;
  target_proforma_invoice_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.project_id is not null then
    perform public.recalculate_project_payment_summary(new.project_id);
  end if;

  if tg_op in ('UPDATE', 'DELETE')
    and old.project_id is not null
    and (tg_op = 'DELETE' or old.project_id <> new.project_id) then
    perform public.recalculate_project_payment_summary(old.project_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    target_proforma_invoice_id := new.proforma_invoice_id;
    if target_proforma_invoice_id is null and new.b2b_sale_id is not null then
      select b2b_sales.proforma_invoice_id
      into target_proforma_invoice_id
      from public.b2b_sales
      where b2b_sales.id = new.b2b_sale_id;
    end if;

    if target_proforma_invoice_id is not null then
      perform public.recalculate_proforma_invoice_totals(target_proforma_invoice_id);
    end if;

    target_invoice_id := new.invoice_id;
    if target_invoice_id is null and new.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = new.b2b_sale_id;
    end if;

    if target_invoice_id is not null then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    target_proforma_invoice_id := old.proforma_invoice_id;
    if target_proforma_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.proforma_invoice_id
      into target_proforma_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_proforma_invoice_id is not null then
      perform public.recalculate_proforma_invoice_totals(target_proforma_invoice_id);
    end if;

    target_invoice_id := old.invoice_id;
    if target_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_invoice_id is not null then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  elsif tg_op = 'UPDATE' then
    target_proforma_invoice_id := old.proforma_invoice_id;
    if target_proforma_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.proforma_invoice_id
      into target_proforma_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_proforma_invoice_id is not null
      and (
        old.proforma_invoice_id is distinct from new.proforma_invoice_id
        or old.b2b_sale_id is distinct from new.b2b_sale_id
        or old.status is distinct from new.status
        or old.amount is distinct from new.amount
      ) then
      perform public.recalculate_proforma_invoice_totals(target_proforma_invoice_id);
    end if;

    target_invoice_id := old.invoice_id;
    if target_invoice_id is null and old.b2b_sale_id is not null then
      select b2b_sales.invoice_id
      into target_invoice_id
      from public.b2b_sales
      where b2b_sales.id = old.b2b_sale_id;
    end if;

    if target_invoice_id is not null
      and (
        old.invoice_id is distinct from new.invoice_id
        or old.b2b_sale_id is distinct from new.b2b_sale_id
        or old.status is distinct from new.status
        or old.amount is distinct from new.amount
      ) then
      perform public.recalculate_invoice_totals(target_invoice_id);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.set_document_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  new.status := coalesce(nullif(trim(new.status), ''), 'pending');

  if new.uploaded_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.uploaded_by := current_profile_id;
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and (
        new.customer_id is null
        or projects.customer_id = new.customer_id
      )
  ) then
    raise exception 'project_id must belong to the same organization and customer as the document'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
      and (
        new.customer_id is null
        or quotations.customer_id = new.customer_id
      )
  ) then
    raise exception 'quotation_id must belong to the same organization and customer as the document'
      using errcode = '23503';
  end if;

  if new.proforma_invoice_id is not null and not exists (
    select 1
    from public.proforma_invoices
    where proforma_invoices.id = new.proforma_invoice_id
      and proforma_invoices.organization_id = new.organization_id
      and (
        new.customer_id is null
        or proforma_invoices.customer_id = new.customer_id
      )
      and (
        new.project_id is null
        or proforma_invoices.project_id = new.project_id
      )
  ) then
    raise exception 'proforma_invoice_id must belong to the same organization, customer, and project as the document'
      using errcode = '23503';
  end if;

  if new.invoice_id is not null and not exists (
    select 1
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id
      and (
        new.customer_id is null
        or invoices.customer_id = new.customer_id
      )
      and (
        new.project_id is null
        or invoices.project_id = new.project_id
      )
  ) then
    raise exception 'invoice_id must belong to the same organization, customer, and project as the document'
      using errcode = '23503';
  end if;

  if new.purchase_order_id is not null and not exists (
    select 1
    from public.purchase_orders
    where purchase_orders.id = new.purchase_order_id
      and purchase_orders.organization_id = new.organization_id
  ) then
    raise exception 'purchase_order_id must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  if new.uploaded_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.uploaded_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'uploaded_by must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.get_business_document_settings()
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  settings_record public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read document settings'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('documents', 'create') then
    raise exception 'Missing documents:create permission'
      using errcode = '42501';
  end if;

  if not (
    public.user_has_permission('quotations', 'view')
    or public.user_has_permission('invoices', 'view')
    or (
      public.user_has_permission('inventory', 'view')
      and public.user_has_permission('product_pricing', 'view')
    )
  ) then
    raise exception 'Missing business document view permission'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  select *
  into settings_record
  from public.organization_settings
  where organization_settings.organization_id = current_organization_id
  limit 1;

  return settings_record;
end;
$$;

drop function if exists public.upsert_generated_document(
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
);

create or replace function public.upsert_generated_document(
  target_document_type text,
  target_document_name text,
  target_file_url text,
  target_file_path text,
  target_file_size bigint,
  target_mime_type text,
  target_customer_id uuid default null,
  target_project_id uuid default null,
  target_quotation_id uuid default null,
  target_invoice_id uuid default null,
  target_proforma_invoice_id uuid default null,
  target_purchase_order_id uuid default null,
  target_notes text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  current_profile_id uuid;
  document_record public.documents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save generated documents'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('documents', 'create') then
    raise exception 'Missing documents:create permission'
      using errcode = '42501';
  end if;

  if target_document_type not in ('quotation_pdf', 'proforma_invoice_pdf', 'invoice_pdf', 'purchase_order_pdf') then
    raise exception 'Unsupported generated document type'
      using errcode = '22023';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  if target_document_type = 'purchase_order_pdf' and not (
    public.user_has_permission('inventory', 'view')
    and public.user_has_permission('product_pricing', 'view')
  ) then
    raise exception 'Missing purchase order pricing permission'
      using errcode = '42501';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  select *
  into document_record
  from public.documents
  where documents.organization_id = current_organization_id
    and documents.file_path = target_file_path
  order by documents.updated_at desc nulls last, documents.created_at desc nulls last
  limit 1
  for update;

  if found then
    update public.documents
    set
      customer_id = target_customer_id,
      project_id = target_project_id,
      quotation_id = target_quotation_id,
      invoice_id = target_invoice_id,
      proforma_invoice_id = target_proforma_invoice_id,
      purchase_order_id = target_purchase_order_id,
      document_type = target_document_type,
      document_name = nullif(trim(target_document_name), ''),
      file_url = target_file_url,
      file_path = target_file_path,
      file_size = target_file_size,
      mime_type = coalesce(nullif(trim(target_mime_type), ''), 'application/pdf'),
      notes = nullif(trim(target_notes), ''),
      uploaded_by = current_profile_id,
      status = 'pending',
      updated_at = now()
    where documents.id = document_record.id
    returning * into document_record;
  else
    insert into public.documents (
      organization_id,
      customer_id,
      project_id,
      quotation_id,
      invoice_id,
      proforma_invoice_id,
      purchase_order_id,
      document_type,
      document_name,
      file_url,
      file_path,
      file_size,
      mime_type,
      notes,
      uploaded_by,
      status
    )
    values (
      current_organization_id,
      target_customer_id,
      target_project_id,
      target_quotation_id,
      target_invoice_id,
      target_proforma_invoice_id,
      target_purchase_order_id,
      target_document_type,
      nullif(trim(target_document_name), ''),
      target_file_url,
      target_file_path,
      target_file_size,
      coalesce(nullif(trim(target_mime_type), ''), 'application/pdf'),
      nullif(trim(target_notes), ''),
      current_profile_id,
      'pending'
    )
    returning * into document_record;
  end if;

  return document_record;
end;
$$;

drop trigger if exists set_proforma_invoices_defaults on public.proforma_invoices;
create trigger set_proforma_invoices_defaults
before insert or update on public.proforma_invoices
for each row
execute function public.set_proforma_invoice_defaults();

drop trigger if exists set_proforma_invoices_updated_at on public.proforma_invoices;
create trigger set_proforma_invoices_updated_at
before update on public.proforma_invoices
for each row
execute function public.set_updated_at();

drop trigger if exists set_proforma_invoice_items_defaults on public.proforma_invoice_items;
create trigger set_proforma_invoice_items_defaults
before insert or update on public.proforma_invoice_items
for each row
execute function public.set_proforma_invoice_item_defaults();

drop trigger if exists refresh_proforma_invoice_totals_on_items_change on public.proforma_invoice_items;
create trigger refresh_proforma_invoice_totals_on_items_change
after insert or update or delete on public.proforma_invoice_items
for each row
execute function public.refresh_proforma_invoice_totals_after_item_change();

drop trigger if exists set_proforma_invoice_items_updated_at on public.proforma_invoice_items;
create trigger set_proforma_invoice_items_updated_at
before update on public.proforma_invoice_items
for each row
execute function public.set_updated_at();

grant select, insert, update, delete on public.proforma_invoices to authenticated;
grant select, insert, update, delete on public.proforma_invoice_items to authenticated;
grant execute on function public.recalculate_proforma_invoice_totals(uuid) to authenticated;
grant execute on function public.mark_proforma_invoice_sent(uuid) to authenticated;
grant execute on function public.mark_proforma_invoice_cancelled(uuid) to authenticated;
grant execute on function public.create_proforma_invoice_from_b2b_sale(uuid) to authenticated;
grant execute on function public.create_invoice_from_proforma_invoice(uuid) to authenticated;
grant execute on function public.get_business_document_settings() to authenticated;
grant execute on function public.upsert_generated_document(text, text, text, text, bigint, text, uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

revoke execute on function public.generate_proforma_invoice_code(uuid) from public, authenticated;
revoke execute on function public.set_proforma_invoice_defaults() from public, authenticated;
revoke execute on function public.set_proforma_invoice_item_defaults() from public, authenticated;
revoke execute on function public.refresh_proforma_invoice_totals_after_item_change() from public, authenticated;

alter table public.proforma_invoices enable row level security;
alter table public.proforma_invoice_items enable row level security;

drop policy if exists "Super admins can manage proforma invoices" on public.proforma_invoices;
drop policy if exists "Organization users can view proforma invoices" on public.proforma_invoices;
drop policy if exists "Organization users can create proforma invoices" on public.proforma_invoices;
drop policy if exists "Organization users can update proforma invoices" on public.proforma_invoices;
drop policy if exists "Organization users can delete proforma invoices" on public.proforma_invoices;

create policy "Super admins can manage proforma invoices"
on public.proforma_invoices
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view proforma invoices"
on public.proforma_invoices
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'view')
);

create policy "Organization users can create proforma invoices"
on public.proforma_invoices
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'create')
);

create policy "Organization users can update proforma invoices"
on public.proforma_invoices
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
)
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
);

create policy "Organization users can delete proforma invoices"
on public.proforma_invoices
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'delete')
);

drop policy if exists "Super admins can manage proforma invoice items" on public.proforma_invoice_items;
drop policy if exists "Organization users can view proforma invoice items" on public.proforma_invoice_items;
drop policy if exists "Organization users can create proforma invoice items" on public.proforma_invoice_items;
drop policy if exists "Organization users can update proforma invoice items" on public.proforma_invoice_items;
drop policy if exists "Organization users can delete proforma invoice items" on public.proforma_invoice_items;

create policy "Super admins can manage proforma invoice items"
on public.proforma_invoice_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view proforma invoice items"
on public.proforma_invoice_items
for select
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'view')
);

create policy "Organization users can create proforma invoice items"
on public.proforma_invoice_items
for insert
to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'create')
);

create policy "Organization users can update proforma invoice items"
on public.proforma_invoice_items
for update
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
)
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
);

create policy "Organization users can delete proforma invoice items"
on public.proforma_invoice_items
for delete
to authenticated
using (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'delete')
);

create or replace function public.set_invoice_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.invoice_code is null or trim(new.invoice_code) = '' then
    new.invoice_code := public.generate_invoice_code(new.organization_id);
  end if;

  new.invoice_date := coalesce(new.invoice_date, current_date);
  new.base_amount := coalesce(new.base_amount, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);
  new.amount_paid := coalesce(new.amount_paid, 0);
  new.balance_due := coalesce(new.balance_due, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and projects.customer_id = new.customer_id
  ) then
    raise exception 'project_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
      and quotations.customer_id = new.customer_id
  ) then
    raise exception 'quotation_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.b2b_sale_id is not null and not exists (
    select 1
    from public.b2b_sales
    where b2b_sales.id = new.b2b_sale_id
      and b2b_sales.organization_id = new.organization_id
      and b2b_sales.customer_id = new.customer_id
  ) then
    raise exception 'b2b_sale_id must belong to the same organization and customer as the invoice'
      using errcode = '23503';
  end if;

  if new.proforma_invoice_id is not null and not exists (
    select 1
    from public.proforma_invoices
    where proforma_invoices.id = new.proforma_invoice_id
      and proforma_invoices.organization_id = new.organization_id
      and proforma_invoices.customer_id = new.customer_id
      and (
        new.project_id is null
        or proforma_invoices.project_id = new.project_id
      )
      and (
        new.quotation_id is null
        or proforma_invoices.quotation_id = new.quotation_id
      )
      and (
        new.b2b_sale_id is null
        or proforma_invoices.b2b_sale_id = new.b2b_sale_id
      )
  ) then
    raise exception 'proforma_invoice_id must belong to the same organization, customer, and context as the invoice'
      using errcode = '23503';
  end if;

  if new.project_id is not null and new.b2b_sale_id is not null then
    raise exception 'An invoice cannot be linked to both a project and a B2B sale'
      using errcode = '23514';
  end if;

  if new.project_id is not null
    and new.quotation_id is not null
    and not exists (
      select 1
      from public.projects
      where projects.id = new.project_id
        and projects.quotation_id = new.quotation_id
    ) then
    raise exception 'quotation_id must match the linked project quotation when both are provided'
      using errcode = '23503';
  end if;

  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the invoice'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
