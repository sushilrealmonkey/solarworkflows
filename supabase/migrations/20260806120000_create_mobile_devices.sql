create table if not exists public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_profile_id uuid not null references public.users_profile(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  device_id text not null,
  app_version text not null,
  locale text not null default 'en-IN',
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, device_id)
);
create index if not exists mobile_devices_company_user_idx on public.mobile_devices(company_id, user_profile_id) where revoked_at is null;
alter table public.mobile_devices enable row level security;
create policy "Users can read their mobile devices" on public.mobile_devices for select to authenticated
using (auth_user_id = (select auth.uid()) and company_id = public.current_user_company_id());
create policy "Users can update their mobile devices" on public.mobile_devices for update to authenticated
using (auth_user_id = (select auth.uid()) and company_id = public.current_user_company_id())
with check (auth_user_id = (select auth.uid()) and company_id = public.current_user_company_id());
revoke all on public.mobile_devices from anon;
grant select, update on public.mobile_devices to authenticated;
comment on table public.mobile_devices is 'Tenant-owned native app device registrations for optional push delivery.';
