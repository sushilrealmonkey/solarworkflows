-- Step 6 customer/client module foundation.
-- This creates only the database foundation for solar customers. No frontend or
-- business workflow tables are added here.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_code text,
  full_name text not null,
  phone text not null,
  alternate_phone text,
  email text,
  address_line_1 text,
  address_line_2 text,
  city text,
  district text,
  state text,
  pincode text,
  customer_type text default 'residential',
  lead_source text,
  status text default 'active',
  notes text,
  created_by uuid references public.users_profile(id),
  assigned_to uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.customers add column if not exists id uuid default gen_random_uuid();
alter table public.customers add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.customers add column if not exists customer_code text;
alter table public.customers add column if not exists full_name text;
alter table public.customers add column if not exists phone text;
alter table public.customers add column if not exists alternate_phone text;
alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists address_line_1 text;
alter table public.customers add column if not exists address_line_2 text;
alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists district text;
alter table public.customers add column if not exists state text;
alter table public.customers add column if not exists pincode text;
alter table public.customers add column if not exists customer_type text default 'residential';
alter table public.customers add column if not exists lead_source text;
alter table public.customers add column if not exists status text default 'active';
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists created_by uuid references public.users_profile(id);
alter table public.customers add column if not exists assigned_to uuid references public.users_profile(id);
alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists updated_at timestamptz default now();

alter table public.customers alter column id set default gen_random_uuid();
alter table public.customers alter column organization_id set not null;
alter table public.customers alter column full_name set not null;
alter table public.customers alter column phone set not null;
alter table public.customers alter column customer_type set default 'residential';
alter table public.customers alter column status set default 'active';
alter table public.customers alter column created_at set default now();
alter table public.customers alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_status_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
    add constraint customers_status_check
    check (status in ('active', 'inactive', 'converted', 'lost'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_customer_type_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
    add constraint customers_customer_type_check
    check (customer_type in ('residential', 'commercial', 'industrial', 'government', 'other'));
  end if;
end;
$$;

create index if not exists customers_organization_id_idx
on public.customers (organization_id);

create index if not exists customers_phone_idx
on public.customers (phone);

create index if not exists customers_customer_code_idx
on public.customers (customer_code);

create index if not exists customers_assigned_to_idx
on public.customers (assigned_to);

create index if not exists customers_status_idx
on public.customers (status);

create unique index if not exists customers_organization_customer_code_unique
on public.customers (organization_id, customer_code)
where customer_code is not null;

-- Generates the next customer code inside one organization. The advisory lock
-- prevents two concurrent inserts in the same organization from receiving the
-- same CUS-0001 style code.
create or replace function public.generate_customer_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a customer code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text, 0));

  select coalesce(max(substring(customers.customer_code from '^CUS-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.customers
  where customers.organization_id = target_organization_id
    and customers.customer_code ~ '^CUS-[0-9]+$';

  return 'CUS-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills customer_code when the application does not provide one.
create or replace function public.set_customer_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_code is null or trim(new.customer_code) = '' then
    new.customer_code := public.generate_customer_code(new.organization_id);
  end if;

  return new;
end;
$$;

-- Keeps customer ownership clean by ensuring user references belong to the same
-- organization as the customer. This prevents accidental cross-tenant links.
create or replace function public.set_customer_user_links()
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

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the customer'
      using errcode = '23503';
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.assigned_to
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'assigned_to must belong to the same organization as the customer'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_customers_customer_code on public.customers;

create trigger set_customers_customer_code
before insert on public.customers
for each row
execute function public.set_customer_code();

drop trigger if exists set_customers_user_links on public.customers;

create trigger set_customers_user_links
before insert or update on public.customers
for each row
execute function public.set_customer_user_links();

drop trigger if exists set_customers_updated_at on public.customers;

create trigger set_customers_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

alter table public.customers enable row level security;

-- Super admins can read and write every customer across every organization.
create policy "Super admins can manage customers"
on public.customers
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view customers in their own organization when they have customer view access.
create policy "Organization users can view organization customers"
on public.customers
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers', 'view')
);

-- Organization users can create customers only inside their own organization with customer create access.
create policy "Organization users can create organization customers"
on public.customers
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers', 'create')
);

-- Organization users can update customers only inside their own organization with customer update access.
create policy "Organization users can update organization customers"
on public.customers
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers', 'update')
);

-- Customer deletion requires explicit customer delete permission and never crosses organizations.
create policy "Organization users can delete organization customers"
on public.customers
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers', 'delete')
);
