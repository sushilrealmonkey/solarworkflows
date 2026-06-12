create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.platform_admins (
  id uuid primary key,
  user_id uuid references auth.users(id),
  full_name text,
  email text,
  phone text,
  status text default 'active',
  created_at timestamptz default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_slug text unique not null,
  owner_name text,
  owner_phone text,
  owner_email text,
  city text,
  state text,
  business_type text default 'solar',
  logo_url text,
  status text default 'active',
  plan text default 'basic',
  default_subdomain text unique,
  custom_domain text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  gst_number text,
  address text,
  phone text,
  email text,
  brand_color text,
  quote_prefix text default 'QT',
  invoice_prefix text default 'INV',
  currency text default 'INR',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  domain_type text check (domain_type in ('default_subdomain', 'custom_domain')),
  domain_name text unique not null,
  status text default 'pending',
  verification_token text,
  ssl_status text default 'pending',
  is_primary boolean default false,
  created_at timestamptz default now(),
  verified_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  full_name text,
  phone text unique,
  email text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  module_key text unique not null,
  module_name text not null,
  description text,
  sort_order int default 0,
  is_active boolean default true
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references public.modules(id) on delete cascade,
  action_key text not null,
  action_name text not null,
  unique (module_id, action_key)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  role_name text not null,
  description text,
  is_system_role boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid references public.roles(id) on delete cascade,
  permission_id uuid references public.permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  role_id uuid references public.roles(id) on delete cascade,
  unique (user_id, role_id)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id),
  title text not null,
  message text,
  notification_type text,
  is_read boolean default false,
  created_at timestamptz default now()
);

create trigger set_companies_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

create trigger set_company_settings_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_roles_updated_at
before update on public.roles
for each row
execute function public.set_updated_at();
