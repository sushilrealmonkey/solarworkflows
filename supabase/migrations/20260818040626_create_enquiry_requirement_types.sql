-- Tenant-owned enquiry requirement types supplement the three application
-- defaults. Custom values are shared by users in the same company only.

create table public.lead_requirement_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  name_normalized text generated always as (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  ) stored,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_requirement_types_name_check check (
    name = btrim(name)
    and char_length(name) between 1 and 80
  ),
  constraint lead_requirement_types_default_name_check check (
    name_normalized not in ('residential', 'commercial', 'solar pump')
  ),
  constraint lead_requirement_types_company_name_unique
    unique (company_id, name_normalized)
);

alter table public.lead_requirement_types enable row level security;

create policy "Tenant users can read enquiry requirement types"
on public.lead_requirement_types
for select
to authenticated
using (
  (select public.is_super_admin())
  or (
    company_id = (select public.get_current_user_company_id())
    and (select public.user_has_permission('leads', 'view'))
  )
);

create policy "Tenant users can create enquiry requirement types"
on public.lead_requirement_types
for insert
to authenticated
with check (
  (select public.is_super_admin())
  or (
    company_id = (select public.get_current_user_company_id())
    and (select public.user_has_permission('leads', 'create'))
  )
);

revoke all on table public.lead_requirement_types from anon, authenticated;
grant select, insert on table public.lead_requirement_types to authenticated;
grant all on table public.lead_requirement_types to service_role;
