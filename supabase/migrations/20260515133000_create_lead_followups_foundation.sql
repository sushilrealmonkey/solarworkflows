-- Step 22 lead follow-up and activity timeline foundation.
-- Stores lead conversation history and reminder-ready follow-up dates only.

create table if not exists public.lead_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  followup_type text not null,
  followup_date timestamptz not null,
  next_followup_date timestamptz,
  status text default 'pending',
  notes text,
  created_by uuid references public.users_profile(id),
  assigned_to uuid references public.users_profile(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.lead_followups add column if not exists id uuid default gen_random_uuid();
alter table public.lead_followups add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.lead_followups add column if not exists lead_id uuid references public.leads(id) on delete cascade;
alter table public.lead_followups add column if not exists followup_type text;
alter table public.lead_followups add column if not exists followup_date timestamptz;
alter table public.lead_followups add column if not exists next_followup_date timestamptz;
alter table public.lead_followups add column if not exists status text default 'pending';
alter table public.lead_followups add column if not exists notes text;
alter table public.lead_followups add column if not exists created_by uuid references public.users_profile(id);
alter table public.lead_followups add column if not exists assigned_to uuid references public.users_profile(id);
alter table public.lead_followups add column if not exists created_at timestamptz default now();
alter table public.lead_followups add column if not exists updated_at timestamptz default now();

alter table public.lead_followups alter column id set default gen_random_uuid();
alter table public.lead_followups alter column organization_id set not null;
alter table public.lead_followups alter column lead_id set not null;
alter table public.lead_followups alter column followup_type set not null;
alter table public.lead_followups alter column followup_date set not null;
alter table public.lead_followups alter column status set default 'pending';
alter table public.lead_followups alter column created_at set default now();
alter table public.lead_followups alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_followups_type_check'
      and conrelid = 'public.lead_followups'::regclass
  ) then
    alter table public.lead_followups
    add constraint lead_followups_type_check
    check (followup_type in ('call', 'whatsapp', 'site_visit', 'meeting', 'email', 'other'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lead_followups_status_check'
      and conrelid = 'public.lead_followups'::regclass
  ) then
    alter table public.lead_followups
    add constraint lead_followups_status_check
    check (status in ('pending', 'completed', 'missed', 'cancelled'));
  end if;
end;
$$;

create index if not exists lead_followups_organization_id_idx
on public.lead_followups (organization_id);

create index if not exists lead_followups_lead_id_idx
on public.lead_followups (lead_id);

create index if not exists lead_followups_followup_date_idx
on public.lead_followups (followup_date);

create index if not exists lead_followups_next_followup_date_idx
on public.lead_followups (next_followup_date);

create index if not exists lead_followups_status_idx
on public.lead_followups (status);

create index if not exists lead_followups_assigned_to_idx
on public.lead_followups (assigned_to);

create or replace function public.set_lead_followup_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  target_lead_organization_id uuid;
begin
  select leads.organization_id
  into target_lead_organization_id
  from public.leads
  where leads.id = new.lead_id;

  if target_lead_organization_id is null then
    raise exception 'lead_id must reference an existing lead'
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := target_lead_organization_id;
  end if;

  if new.organization_id <> target_lead_organization_id then
    raise exception 'organization_id must match the lead organization'
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
    raise exception 'created_by must belong to the same organization as the follow-up'
      using errcode = '23503';
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.assigned_to
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'assigned_to must belong to the same organization as the follow-up'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_lead_followups_tenant_links on public.lead_followups;

create trigger set_lead_followups_tenant_links
before insert or update on public.lead_followups
for each row
execute function public.set_lead_followup_tenant_links();

drop trigger if exists set_lead_followups_updated_at on public.lead_followups;

create trigger set_lead_followups_updated_at
before update on public.lead_followups
for each row
execute function public.set_updated_at();

alter table public.lead_followups enable row level security;

create policy "Super admins can manage lead followups"
on public.lead_followups
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view lead followups"
on public.lead_followups
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'view')
);

create policy "Organization users can create lead followups"
on public.lead_followups
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'create')
);

create policy "Organization users can update lead followups"
on public.lead_followups
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

create policy "Organization users can delete lead followups"
on public.lead_followups
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads', 'delete')
);
