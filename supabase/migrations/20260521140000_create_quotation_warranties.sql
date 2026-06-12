-- Adds tenant-scoped warranty rows for quotations.

create table if not exists public.quotation_warranties (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  component text,
  warranty_text text,
  sort_order integer default 0,
  tenant_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.quotation_warranties add column if not exists id uuid default gen_random_uuid();
alter table public.quotation_warranties add column if not exists quotation_id uuid references public.quotations(id) on delete cascade;
alter table public.quotation_warranties add column if not exists component text;
alter table public.quotation_warranties add column if not exists warranty_text text;
alter table public.quotation_warranties add column if not exists sort_order integer default 0;
alter table public.quotation_warranties add column if not exists tenant_id uuid references public.organizations(id) on delete cascade;
alter table public.quotation_warranties add column if not exists created_at timestamptz default now();
alter table public.quotation_warranties add column if not exists updated_at timestamptz default now();

update public.quotation_warranties
set tenant_id = quotations.organization_id
from public.quotations
where quotation_warranties.quotation_id = quotations.id
  and quotation_warranties.tenant_id is null;

alter table public.quotation_warranties alter column id set default gen_random_uuid();
alter table public.quotation_warranties alter column quotation_id set not null;
alter table public.quotation_warranties alter column tenant_id set not null;
alter table public.quotation_warranties alter column sort_order set default 0;
alter table public.quotation_warranties alter column created_at set default now();
alter table public.quotation_warranties alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_warranties_quotation_id_fkey'
      and conrelid = 'public.quotation_warranties'::regclass
  ) then
    alter table public.quotation_warranties
      add constraint quotation_warranties_quotation_id_fkey
      foreign key (quotation_id)
      references public.quotations(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_warranties_tenant_id_fkey'
      and conrelid = 'public.quotation_warranties'::regclass
  ) then
    alter table public.quotation_warranties
      add constraint quotation_warranties_tenant_id_fkey
      foreign key (tenant_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end $$;

create index if not exists quotation_warranties_quotation_id_idx
on public.quotation_warranties (quotation_id);

create index if not exists quotation_warranties_tenant_id_idx
on public.quotation_warranties (tenant_id);

create index if not exists quotation_warranties_sort_idx
on public.quotation_warranties (quotation_id, sort_order);

create or replace function public.set_quotation_warranty_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  select quotations.organization_id
  into parent_tenant_id
  from public.quotations
  where quotations.id = new.quotation_id;

  if parent_tenant_id is null then
    raise exception 'quotation_id must reference an existing quotation'
      using errcode = '23503';
  end if;

  if new.tenant_id is null then
    new.tenant_id := parent_tenant_id;
  end if;

  if new.tenant_id <> parent_tenant_id then
    raise exception 'quotation warranty tenant_id must match the quotation organization'
      using errcode = '23503';
  end if;

  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

drop trigger if exists set_quotation_warranties_tenant on public.quotation_warranties;

create trigger set_quotation_warranties_tenant
before insert or update on public.quotation_warranties
for each row
execute function public.set_quotation_warranty_tenant();

drop trigger if exists set_quotation_warranties_updated_at on public.quotation_warranties;

create trigger set_quotation_warranties_updated_at
before update on public.quotation_warranties
for each row
execute function public.set_updated_at();

alter table public.quotation_warranties enable row level security;

create policy "Super admins can manage quotation warranties"
on public.quotation_warranties
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view quotation warranties"
on public.quotation_warranties
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

create policy "Organization users can create quotation warranties"
on public.quotation_warranties
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('quotations', 'create')
    or public.user_has_permission('quotations', 'update')
  )
);

create policy "Organization users can update quotation warranties"
on public.quotation_warranties
for update
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);

create policy "Organization users can delete quotation warranties"
on public.quotation_warranties
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);
