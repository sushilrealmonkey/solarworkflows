-- Step 15 invoice module foundation.
-- Creates the database layer for invoices and invoice line items only. No
-- frontend screens are added here.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_code text,
  customer_id uuid not null references public.customers(id),
  project_id uuid references public.projects(id),
  quotation_id uuid references public.quotations(id),
  invoice_date date default current_date,
  due_date date,
  base_amount numeric default 0,
  gst_amount numeric default 0,
  discount_amount numeric default 0,
  total_amount numeric default 0,
  amount_paid numeric default 0,
  balance_due numeric default 0,
  status text default 'draft',
  notes text,
  created_by uuid references public.users_profile(id),
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.invoices add column if not exists id uuid default gen_random_uuid();
alter table public.invoices add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.invoices add column if not exists invoice_code text;
alter table public.invoices add column if not exists customer_id uuid references public.customers(id);
alter table public.invoices add column if not exists project_id uuid references public.projects(id);
alter table public.invoices add column if not exists quotation_id uuid references public.quotations(id);
alter table public.invoices add column if not exists invoice_date date default current_date;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists base_amount numeric default 0;
alter table public.invoices add column if not exists gst_amount numeric default 0;
alter table public.invoices add column if not exists discount_amount numeric default 0;
alter table public.invoices add column if not exists total_amount numeric default 0;
alter table public.invoices add column if not exists amount_paid numeric default 0;
alter table public.invoices add column if not exists balance_due numeric default 0;
alter table public.invoices add column if not exists status text default 'draft';
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists created_by uuid references public.users_profile(id);
alter table public.invoices add column if not exists sent_at timestamptz;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists created_at timestamptz default now();
alter table public.invoices add column if not exists updated_at timestamptz default now();

alter table public.invoices alter column id set default gen_random_uuid();
alter table public.invoices alter column organization_id set not null;
alter table public.invoices alter column customer_id set not null;
alter table public.invoices alter column invoice_date set default current_date;
alter table public.invoices alter column base_amount set default 0;
alter table public.invoices alter column gst_amount set default 0;
alter table public.invoices alter column discount_amount set default 0;
alter table public.invoices alter column total_amount set default 0;
alter table public.invoices alter column amount_paid set default 0;
alter table public.invoices alter column balance_due set default 0;
alter table public.invoices alter column status set default 'draft';
alter table public.invoices alter column created_at set default now();
alter table public.invoices alter column updated_at set default now();

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
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

alter table public.invoice_items add column if not exists id uuid default gen_random_uuid();
alter table public.invoice_items add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.invoice_items add column if not exists invoice_id uuid references public.invoices(id) on delete cascade;
alter table public.invoice_items add column if not exists item_name text;
alter table public.invoice_items add column if not exists description text;
alter table public.invoice_items add column if not exists quantity numeric default 1;
alter table public.invoice_items add column if not exists unit text;
alter table public.invoice_items add column if not exists unit_price numeric default 0;
alter table public.invoice_items add column if not exists gst_percent numeric default 0;
alter table public.invoice_items add column if not exists line_total numeric default 0;
alter table public.invoice_items add column if not exists sort_order integer default 0;
alter table public.invoice_items add column if not exists created_at timestamptz default now();
alter table public.invoice_items add column if not exists updated_at timestamptz default now();

alter table public.invoice_items alter column id set default gen_random_uuid();
alter table public.invoice_items alter column organization_id set not null;
alter table public.invoice_items alter column invoice_id set not null;
alter table public.invoice_items alter column item_name set not null;
alter table public.invoice_items alter column quantity set default 1;
alter table public.invoice_items alter column unit_price set default 0;
alter table public.invoice_items alter column gst_percent set default 0;
alter table public.invoice_items alter column line_total set default 0;
alter table public.invoice_items alter column sort_order set default 0;
alter table public.invoice_items alter column created_at set default now();
alter table public.invoice_items alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
    add constraint invoices_status_check
    check (status in ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_amounts_nonnegative_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
    add constraint invoices_amounts_nonnegative_check
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
    select 1
    from pg_constraint
    where conname = 'invoice_items_amounts_nonnegative_check'
      and conrelid = 'public.invoice_items'::regclass
  ) then
    alter table public.invoice_items
    add constraint invoice_items_amounts_nonnegative_check
    check (
      quantity >= 0
      and unit_price >= 0
      and gst_percent >= 0
      and line_total >= 0
      and sort_order >= 0
    );
  end if;
end;
$$;

create unique index if not exists invoices_organization_invoice_code_unique
on public.invoices (organization_id, invoice_code)
where invoice_code is not null;

create index if not exists invoices_organization_id_idx
on public.invoices (organization_id);

create index if not exists invoices_invoice_code_idx
on public.invoices (invoice_code);

create index if not exists invoices_customer_id_idx
on public.invoices (customer_id);

create index if not exists invoices_project_id_idx
on public.invoices (project_id);

create index if not exists invoices_quotation_id_idx
on public.invoices (quotation_id);

create index if not exists invoices_status_idx
on public.invoices (status);

create index if not exists invoices_invoice_date_idx
on public.invoices (invoice_date);

create index if not exists invoices_due_date_idx
on public.invoices (due_date);

create index if not exists invoice_items_organization_id_idx
on public.invoice_items (organization_id);

create index if not exists invoice_items_invoice_id_idx
on public.invoice_items (invoice_id);

-- Generates the next invoice code inside one organization. The advisory lock
-- keeps INV-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_invoice_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate an invoice code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('invoice:' || target_organization_id::text, 0));

  select coalesce(max(substring(invoices.invoice_code from '^INV-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.invoices
  where invoices.organization_id = target_organization_id
    and invoices.invoice_code ~ '^INV-[0-9]+$';

  return 'INV-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills invoice_code, defaults, and validates linked customer/project/quotation/user tenants.
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

-- Keeps invoice item organization_id aligned with its invoice and calculates
-- pre-tax line_total as quantity * unit_price.
create or replace function public.set_invoice_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_organization_id uuid;
begin
  select invoices.organization_id
  into parent_organization_id
  from public.invoices
  where invoices.id = new.invoice_id;

  if parent_organization_id is null then
    raise exception 'invoice_id must reference an existing invoice'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := parent_organization_id;
  end if;

  if new.organization_id <> parent_organization_id then
    raise exception 'invoice item organization_id must match the invoice organization_id'
      using errcode = '23503';
  end if;

  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.line_total := new.quantity * new.unit_price;
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

drop trigger if exists set_invoices_defaults on public.invoices;

create trigger set_invoices_defaults
before insert or update on public.invoices
for each row
execute function public.set_invoice_defaults();

drop trigger if exists set_invoices_updated_at on public.invoices;

create trigger set_invoices_updated_at
before update on public.invoices
for each row
execute function public.set_updated_at();

drop trigger if exists set_invoice_items_defaults on public.invoice_items;

create trigger set_invoice_items_defaults
before insert or update on public.invoice_items
for each row
execute function public.set_invoice_item_defaults();

drop trigger if exists set_invoice_items_updated_at on public.invoice_items;

create trigger set_invoice_items_updated_at
before update on public.invoice_items
for each row
execute function public.set_updated_at();

-- Recalculates invoice totals from invoice_items. Payments are pulled from the
-- linked project when project_id exists, using received payments only.
create or replace function public.recalculate_invoice_totals(target_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  calculated_total_amount numeric;
  calculated_amount_paid numeric;
  calculated_balance_due numeric;
  next_status text;
begin
  select *
  into invoice_record
  from public.invoices
  where invoices.id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if invoice_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate an invoice from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('invoices', 'update') then
      raise exception 'Missing invoices update permission'
        using errcode = '42501';
    end if;
  end if;

  select
    coalesce(sum(invoice_items.line_total), 0),
    coalesce(sum(invoice_items.line_total * coalesce(invoice_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.invoice_items
  where invoice_items.invoice_id = target_invoice_id
    and invoice_items.organization_id = invoice_record.organization_id;

  calculated_total_amount := greatest(
    calculated_base_amount
      + calculated_gst_amount
      - coalesce(invoice_record.discount_amount, 0),
    0
  );

  if invoice_record.project_id is not null then
    select coalesce(sum(payments.amount), 0)
    into calculated_amount_paid
    from public.payments
    where payments.project_id = invoice_record.project_id
      and payments.organization_id = invoice_record.organization_id
      and payments.status = 'received';
  else
    calculated_amount_paid := coalesce(invoice_record.amount_paid, 0);
  end if;

  calculated_balance_due := greatest(calculated_total_amount - calculated_amount_paid, 0);

  next_status := case
    when invoice_record.status = 'cancelled' then 'cancelled'
    when calculated_total_amount > 0 and calculated_balance_due <= 0 then 'paid'
    when calculated_amount_paid > 0 and calculated_balance_due > 0 then 'partially_paid'
    when invoice_record.status = 'draft' then 'draft'
    when invoice_record.due_date is not null
      and invoice_record.due_date < current_date
      and calculated_balance_due > 0 then 'overdue'
    else 'sent'
  end;

  update public.invoices
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = calculated_total_amount,
    amount_paid = calculated_amount_paid,
    balance_due = calculated_balance_due,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(public.invoices.paid_at, now())
      when next_status in ('partially_paid', 'sent', 'overdue', 'draft') then null
      else public.invoices.paid_at
    end,
    updated_at = now()
  where invoices.id = target_invoice_id
  returning * into invoice_record;

  return invoice_record;
end;
$$;

-- Marks an invoice as sent and records sent_at.
create or replace function public.mark_invoice_sent(target_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
begin
  select *
  into invoice_record
  from public.invoices
  where invoices.id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if invoice_record.status = 'cancelled' then
    raise exception 'Cancelled invoices cannot be sent'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      invoice_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'update')
    ) then
    raise exception 'Missing permission to send invoice'
      using errcode = '42501';
  end if;

  update public.invoices
  set
    status = case
      when status in ('paid', 'partially_paid', 'overdue') then status
      else 'sent'
    end,
    sent_at = coalesce(sent_at, now()),
    updated_at = now()
  where invoices.id = target_invoice_id
  returning * into invoice_record;

  return invoice_record;
end;
$$;

-- Marks an invoice as cancelled.
create or replace function public.mark_invoice_cancelled(target_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
begin
  select *
  into invoice_record
  from public.invoices
  where invoices.id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      invoice_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'update')
    ) then
    raise exception 'Missing permission to cancel invoice'
      using errcode = '42501';
  end if;

  update public.invoices
  set
    status = 'cancelled',
    updated_at = now()
  where invoices.id = target_invoice_id
  returning * into invoice_record;

  return invoice_record;
end;
$$;

grant execute on function public.recalculate_invoice_totals(uuid) to authenticated;
grant execute on function public.mark_invoice_sent(uuid) to authenticated;
grant execute on function public.mark_invoice_cancelled(uuid) to authenticated;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "Super admins can manage invoices" on public.invoices;
drop policy if exists "Organization users can view invoices" on public.invoices;
drop policy if exists "Organization users can create invoices" on public.invoices;
drop policy if exists "Organization users can update invoices" on public.invoices;
drop policy if exists "Organization users can delete invoices" on public.invoices;

-- Super admins can read and write every invoice across every organization.
create policy "Super admins can manage invoices"
on public.invoices
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view invoices in their organization with invoices view permission.
create policy "Organization users can view invoices"
on public.invoices
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'view')
);

-- Organization users can create invoices only inside their organization with invoices create permission.
create policy "Organization users can create invoices"
on public.invoices
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'create')
);

-- Organization users can update invoices only inside their organization with invoices update permission.
create policy "Organization users can update invoices"
on public.invoices
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
);

-- Invoice deletion requires explicit invoices delete permission and never crosses organizations.
create policy "Organization users can delete invoices"
on public.invoices
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'delete')
);

drop policy if exists "Super admins can manage invoice items" on public.invoice_items;
drop policy if exists "Organization users can view invoice items" on public.invoice_items;
drop policy if exists "Organization users can create invoice items" on public.invoice_items;
drop policy if exists "Organization users can update invoice items" on public.invoice_items;
drop policy if exists "Organization users can delete invoice items" on public.invoice_items;

-- Super admins can read and write every invoice item across every organization.
create policy "Super admins can manage invoice items"
on public.invoice_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view invoice items in their organization with invoices view permission.
create policy "Organization users can view invoice items"
on public.invoice_items
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'view')
);

-- Organization users can create invoice items only inside their organization with invoices create permission.
create policy "Organization users can create invoice items"
on public.invoice_items
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'create')
);

-- Organization users can update invoice items only inside their organization with invoices update permission.
create policy "Organization users can update invoice items"
on public.invoice_items
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'update')
);

-- Invoice item deletion requires explicit invoices delete permission and never crosses organizations.
create policy "Organization users can delete invoice items"
on public.invoice_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('invoices', 'delete')
);
