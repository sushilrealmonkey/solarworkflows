-- Step 14 vendors / suppliers module foundation.
-- Creates the database layer for organization-scoped vendors only. No frontend
-- screens are added here.

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_code text,
  vendor_name text not null,
  contact_person text,
  phone text,
  alternate_phone text,
  email text,
  gst_number text,
  pan_number text,
  address_line_1 text,
  address_line_2 text,
  city text,
  district text,
  state text,
  pincode text,
  vendor_type text default 'supplier',
  status text default 'active',
  notes text,
  created_by uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.vendors add column if not exists id uuid default gen_random_uuid();
alter table public.vendors add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.vendors add column if not exists vendor_code text;
alter table public.vendors add column if not exists vendor_name text;
alter table public.vendors add column if not exists contact_person text;
alter table public.vendors add column if not exists phone text;
alter table public.vendors add column if not exists alternate_phone text;
alter table public.vendors add column if not exists email text;
alter table public.vendors add column if not exists gst_number text;
alter table public.vendors add column if not exists pan_number text;
alter table public.vendors add column if not exists address_line_1 text;
alter table public.vendors add column if not exists address_line_2 text;
alter table public.vendors add column if not exists city text;
alter table public.vendors add column if not exists district text;
alter table public.vendors add column if not exists state text;
alter table public.vendors add column if not exists pincode text;
alter table public.vendors add column if not exists vendor_type text default 'supplier';
alter table public.vendors add column if not exists status text default 'active';
alter table public.vendors add column if not exists notes text;
alter table public.vendors add column if not exists created_by uuid references public.users_profile(id);
alter table public.vendors add column if not exists created_at timestamptz default now();
alter table public.vendors add column if not exists updated_at timestamptz default now();

alter table public.vendors alter column id set default gen_random_uuid();
alter table public.vendors alter column organization_id set not null;
alter table public.vendors alter column vendor_name set not null;
alter table public.vendors alter column vendor_type set default 'supplier';
alter table public.vendors alter column status set default 'active';
alter table public.vendors alter column created_at set default now();
alter table public.vendors alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendors_vendor_type_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors
    add constraint vendors_vendor_type_check
    check (vendor_type in (
      'supplier',
      'contractor',
      'installer',
      'transporter',
      'service_provider',
      'other'
    ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendors_status_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors
    add constraint vendors_status_check
    check (status in ('active', 'inactive', 'blacklisted'));
  end if;
end;
$$;

create unique index if not exists vendors_organization_vendor_code_unique
on public.vendors (organization_id, vendor_code)
where vendor_code is not null;

create index if not exists vendors_organization_id_idx
on public.vendors (organization_id);

create index if not exists vendors_vendor_code_idx
on public.vendors (vendor_code);

create index if not exists vendors_vendor_name_idx
on public.vendors (vendor_name);

create index if not exists vendors_phone_idx
on public.vendors (phone);

create index if not exists vendors_gst_number_idx
on public.vendors (gst_number);

create index if not exists vendors_vendor_type_idx
on public.vendors (vendor_type);

create index if not exists vendors_status_idx
on public.vendors (status);

-- Generates the next vendor code inside one organization. The advisory lock
-- keeps VEN-0001 style numbering safe during concurrent inserts.
create or replace function public.generate_vendor_code(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a vendor code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vendor:' || target_organization_id::text, 0));

  select coalesce(max(substring(vendors.vendor_code from '^VEN-([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.vendors
  where vendors.organization_id = target_organization_id
    and vendors.vendor_code ~ '^VEN-[0-9]+$';

  return 'VEN-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Fills vendor_code/defaults and validates the creator belongs to the vendor organization.
create or replace function public.set_vendor_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.vendor_code is null or trim(new.vendor_code) = '' then
    new.vendor_code := public.generate_vendor_code(new.organization_id);
  end if;

  new.vendor_type := coalesce(nullif(trim(new.vendor_type), ''), 'supplier');
  new.status := coalesce(nullif(trim(new.status), ''), 'active');

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
    raise exception 'created_by must belong to the same organization as the vendor'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_vendors_defaults on public.vendors;

create trigger set_vendors_defaults
before insert or update on public.vendors
for each row
execute function public.set_vendor_defaults();

drop trigger if exists set_vendors_updated_at on public.vendors;

create trigger set_vendors_updated_at
before update on public.vendors
for each row
execute function public.set_updated_at();

alter table public.vendors enable row level security;

drop policy if exists "Super admins can manage vendors" on public.vendors;
drop policy if exists "Organization users can view vendors" on public.vendors;
drop policy if exists "Organization users can create vendors" on public.vendors;
drop policy if exists "Organization users can update vendors" on public.vendors;
drop policy if exists "Organization users can delete vendors" on public.vendors;

-- Super admins can read and write every vendor across every organization.
create policy "Super admins can manage vendors"
on public.vendors
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Organization users can view vendors in their organization with vendors view permission.
create policy "Organization users can view vendors"
on public.vendors
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('vendors', 'view')
);

-- Organization users can create vendors only inside their organization with vendors create permission.
create policy "Organization users can create vendors"
on public.vendors
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('vendors', 'create')
);

-- Organization users can update vendors only inside their organization with vendors update permission.
create policy "Organization users can update vendors"
on public.vendors
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('vendors', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('vendors', 'update')
);

-- Vendor deletion requires explicit vendors delete permission and never crosses organizations.
create policy "Organization users can delete vendors"
on public.vendors
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('vendors', 'delete')
);
