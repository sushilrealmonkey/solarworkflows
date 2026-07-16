-- AI Assistant Phase 1: per-user daily brief cache.
-- Stores one generated brief per user per day. Briefs are generated lazily by
-- the assistant-brief edge function under the caller's JWT, so RLS is the
-- security boundary: a user can only read and write their own brief inside
-- their own organization. Briefs are per-user (not per-organization) because
-- users with different permissions must see different briefs.

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_profile_id uuid not null references public.users_profile(id) on delete cascade,
  brief_date date not null,
  content jsonb not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_briefs_user_profile_brief_date_key'
      and conrelid = 'public.daily_briefs'::regclass
  ) then
    alter table public.daily_briefs
    add constraint daily_briefs_user_profile_brief_date_key
    unique (user_profile_id, brief_date);
  end if;
end;
$$;

create index if not exists daily_briefs_organization_id_idx
on public.daily_briefs (organization_id);

alter table public.daily_briefs enable row level security;

drop policy if exists "Super admins can manage daily briefs" on public.daily_briefs;
drop policy if exists "Users can view own daily briefs" on public.daily_briefs;
drop policy if exists "Users can create own daily briefs" on public.daily_briefs;
drop policy if exists "Users can update own daily briefs" on public.daily_briefs;

create policy "Super admins can manage daily briefs"
on public.daily_briefs
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Ownership predicate is both tenant and user scoped. No module permission is
-- required because a brief only ever contains data the same user could already
-- read under RLS when it was generated.
create policy "Users can view own daily briefs"
on public.daily_briefs
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and user_profile_id = public.current_user_profile_id()
);

create policy "Users can create own daily briefs"
on public.daily_briefs
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and user_profile_id = public.current_user_profile_id()
);

-- Update is required because the edge function upserts on
-- (user_profile_id, brief_date) when a brief is regenerated.
create policy "Users can update own daily briefs"
on public.daily_briefs
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and user_profile_id = public.current_user_profile_id()
)
with check (
  organization_id = public.current_user_organization_id()
  and user_profile_id = public.current_user_profile_id()
);
