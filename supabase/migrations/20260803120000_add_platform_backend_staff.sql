-- Platform staff are intentionally separate from tenant roles. The profile still
-- carries company_id (nullable for platform users) so no tenant data is implied.
alter table public.users_profile
  add column if not exists platform_role text;

alter table public.users_profile
  drop constraint if exists users_profile_platform_role_check;

alter table public.users_profile
  add constraint users_profile_platform_role_check
  check (platform_role is null or platform_role in ('backend_staff'));

create index if not exists users_profile_platform_role_idx
  on public.users_profile (platform_role, status)
  where platform_role is not null;

create or replace function public.has_platform_role(required_role text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.users_profile
    where auth_user_id = (select auth.uid())
      and status = 'active'
      and platform_role = required_role
  );
$$;

revoke all on function public.has_platform_role(text) from public;
grant execute on function public.has_platform_role(text) to authenticated;

comment on column public.users_profile.platform_role is
  'Platform-level access role. backend_staff is restricted to WhatsApp Outreach.';
