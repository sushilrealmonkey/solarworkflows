-- Step 7 leads/enquiry module foundation.
-- This creates the database layer for solar leads only. No frontend screens or
-- workflow UI are added here.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_code text,
  customer_id uuid references public.customers(id),
  full_name text not null,
  phone text not null,
  alternate_phone text,
  email text,
  address text,
  city text,
  district text,
  state text,
  pincode text,
  lead_source text,
  requirement_type text,
  estimated_load_kw numeric,
  electricity_bill_amount numeric,
  property_type text,
  roof_type text,
  status text default 'new',
  priority text default 'medium',
  assigned_to uuid references public.users_profile(id),
  notes text,
  created_by uuid references public.users_profile(id),
  converted_customer_id uuid references public.customers(id),
  converted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.leads add column if not exists id uuid default gen_random_uuid();
alter table public.leads add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.leads add column if not exists lead_code text;
alter table public.leads add column if not exists customer_id uuid references public.customers(id);
alter table public.leads add column if not exists full_name text;
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists alternate_phone text;
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists address text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists district text;
alter table public.leads add column if not exists state text;
alter table public.leads add column if not exists pincode text;
alter table public.leads add column if not exists lead_source text;
alter table public.leads add column if not exists requirement_type text;
alter table public.leads add column if not exists estimated_load_kw numeric;
alter table public.leads add column if not exists electricity_bill_amount numeric;
alter table public.leads add column if not exists property_type text;
alter table public.leads add column if not exists roof_type text;
alter table public.leads add column if not exists status text default 'new';
alter table public.leads add column if not exists priority text default 'medium';
alter table public.leads add column if not exists assigned_to uuid references public.users_profile(id);
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists created_by uuid references public.users_profile(id);
alter table public.leads add column if not exists converted_customer_id uuid references public.customers(id);
alter table public.leads add column if not exists converted_at timestamptz;
alter table public.leads add column if not exists created_at timestamptz default now();
alter table public.leads add column if not exists updated_at timestamptz default now();

alter table public.leads alter column id set default gen_random_uuid();
alter table public.leads alter column organization_id set not null;
alter table public.leads alter column full_name set not null;
alter table public.leads alter column phone set not null;
alter table public.leads alter column status set default 'new';
alter table public.leads alter column priority set default 'medium';
alter table public.leads alter column created_at set default now();
alter table public.leads alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_status_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
    add constraint leads_status_check
    check (status in (
      'new',
      'contacted',
      'site_visit_scheduled',
      'qualified',
      'quotation_sent',
      'converted',
      'lost'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_priority_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
    add constraint leads_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent'));
  end if;
end;
$$;

create index if not exists leads_organization_id_idx
on public.leads (organization_id);

create index if not exists leads_lead_code_idx
on public.leads (lead_code);

create index if not exists leads_phone_idx
on public.leads (phone);

create index if not exists leads_status_idx
on public.leads (status);

create index if not exists leads_assigned_to_idx
on public.leads (assigned_to);

create index if not exists leads_customer_id_idx
on public.leads (customer_id);

create index if not exists leads_converted_customer_id_idx
on public.leads (converted_customer_id);

create unique index if not exists leads_organization_lead_code_unique
on public.leads (organization_id, lead_code)
where lead_code is not null;

-- Generates the next lead code inside one organization. The advisory lock keeps
-- LEAD-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_lead_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a lead code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lead:' || target_organization_id::text, 0));

  select coalesce(max(substring(leads.lead_code from '^LEAD-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.leads
  where leads.organization_id = target_organization_id
    and leads.lead_code ~ '^LEAD-[0-9]+$';

  return 'LEAD-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills lead_code when the application does not provide one.
create or replace function public.set_lead_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_code is null or trim(new.lead_code) = '' then
    new.lead_code := public.generate_lead_code(new.organization_id);
  end if;

  return new;
end;
$$;

-- Ensures every linked user/customer row belongs to the same organization as
-- the lead. This keeps cross-tenant references out of the database.
create or replace function public.set_lead_tenant_links()
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
    raise exception 'created_by must belong to the same organization as the lead'
      using errcode = '23503';
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.assigned_to
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'assigned_to must belong to the same organization as the lead'
      using errcode = '23503';
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the lead'
      using errcode = '23503';
  end if;

  if new.converted_customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.converted_customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'converted_customer_id must belong to the same organization as the lead'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_leads_lead_code on public.leads;

create trigger set_leads_lead_code
before insert on public.leads
for each row
execute function public.set_lead_code();

drop trigger if exists set_leads_tenant_links on public.leads;

create trigger set_leads_tenant_links
before insert or update on public.leads
for each row
execute function public.set_lead_tenant_links();

drop trigger if exists set_leads_updated_at on public.leads;

create trigger set_leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

-- Converts a lead into a customer inside the same organization. The caller must
-- be able to update leads and create customers unless they are a super admin.
create or replace function public.convert_lead_to_customer(target_lead_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_record public.leads%rowtype;
  customer_record public.customers%rowtype;
  current_profile_id uuid;
begin
  select *
  into lead_record
  from public.leads
  where leads.id = target_lead_id
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if lead_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot convert a lead from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('leads', 'update') then
      raise exception 'Missing leads update permission'
        using errcode = '42501';
    end if;

    if lead_record.converted_customer_id is null
      and not public.user_has_permission('customers', 'create') then
      raise exception 'Missing customers create permission'
        using errcode = '42501';
    end if;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if lead_record.converted_customer_id is not null then
    select *
    into customer_record
    from public.customers
    where customers.id = lead_record.converted_customer_id;
  else
    insert into public.customers (
      organization_id,
      full_name,
      phone,
      alternate_phone,
      email,
      address_line_1,
      city,
      district,
      state,
      pincode,
      lead_source,
      status,
      notes,
      created_by,
      assigned_to
    )
    values (
      lead_record.organization_id,
      lead_record.full_name,
      lead_record.phone,
      lead_record.alternate_phone,
      lead_record.email,
      lead_record.address,
      lead_record.city,
      lead_record.district,
      lead_record.state,
      lead_record.pincode,
      lead_record.lead_source,
      'active',
      lead_record.notes,
      coalesce(current_profile_id, lead_record.created_by),
      lead_record.assigned_to
    )
    returning * into customer_record;
  end if;

  update public.leads
  set
    status = 'converted',
    converted_customer_id = customer_record.id,
    converted_at = coalesce(public.leads.converted_at, now()),
    customer_id = coalesce(public.leads.customer_id, customer_record.id),
    updated_at = now()
  where public.leads.id = lead_record.id;

  return customer_record;
end;
$$;

grant execute on function public.convert_lead_to_customer(uuid) to authenticated;

alter table public.leads enable row level security;

-- Super admins can read and write every lead across every organization.
create policy "Super admins can manage leads"
on public.leads
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view leads in their organization with leads view permission.
create policy "Organization users can view organization leads"
on public.leads
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'view')
);

-- Organization users can create leads only inside their organization with leads create permission.
create policy "Organization users can create organization leads"
on public.leads
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'create')
);

-- Organization users can update leads only inside their organization with leads update permission.
create policy "Organization users can update organization leads"
on public.leads
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'update')
);

-- Lead deletion requires explicit leads delete permission and never crosses organizations.
create policy "Organization users can delete organization leads"
on public.leads
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'delete')
);
