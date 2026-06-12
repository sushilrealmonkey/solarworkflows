-- Adds tenant-scoped dynamic payment milestones for Technical & Commercial Proposal quotations.
-- Basic/standard quotations continue using the legacy percentage fields on quotations.

create table if not exists public.quotation_payment_terms (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  milestone text,
  percentage numeric,
  amount numeric,
  sort_order integer default 0,
  tenant_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.quotation_payment_terms add column if not exists id uuid default gen_random_uuid();
alter table public.quotation_payment_terms add column if not exists quotation_id uuid references public.quotations(id) on delete cascade;
alter table public.quotation_payment_terms add column if not exists milestone text;
alter table public.quotation_payment_terms add column if not exists percentage numeric;
alter table public.quotation_payment_terms add column if not exists amount numeric;
alter table public.quotation_payment_terms add column if not exists sort_order integer default 0;
alter table public.quotation_payment_terms add column if not exists tenant_id uuid references public.organizations(id) on delete cascade;
alter table public.quotation_payment_terms add column if not exists created_at timestamptz default now();
alter table public.quotation_payment_terms add column if not exists updated_at timestamptz default now();

update public.quotation_payment_terms
set tenant_id = quotations.organization_id
from public.quotations
where quotation_payment_terms.quotation_id = quotations.id
  and quotation_payment_terms.tenant_id is null;

alter table public.quotation_payment_terms alter column id set default gen_random_uuid();
alter table public.quotation_payment_terms alter column quotation_id set not null;
alter table public.quotation_payment_terms alter column tenant_id set not null;
alter table public.quotation_payment_terms alter column sort_order set default 0;
alter table public.quotation_payment_terms alter column created_at set default now();
alter table public.quotation_payment_terms alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_payment_terms_quotation_id_fkey'
      and conrelid = 'public.quotation_payment_terms'::regclass
  ) then
    alter table public.quotation_payment_terms
      add constraint quotation_payment_terms_quotation_id_fkey
      foreign key (quotation_id)
      references public.quotations(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_payment_terms_tenant_id_fkey'
      and conrelid = 'public.quotation_payment_terms'::regclass
  ) then
    alter table public.quotation_payment_terms
      add constraint quotation_payment_terms_tenant_id_fkey
      foreign key (tenant_id)
      references public.organizations(id)
      on delete cascade;
  end if;
end $$;

create index if not exists quotation_payment_terms_quotation_id_idx
on public.quotation_payment_terms (quotation_id);

create index if not exists quotation_payment_terms_tenant_id_idx
on public.quotation_payment_terms (tenant_id);

create index if not exists quotation_payment_terms_sort_idx
on public.quotation_payment_terms (quotation_id, sort_order);

create or replace function public.set_quotation_payment_term_tenant()
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
    raise exception 'quotation payment term tenant_id must match the quotation organization'
      using errcode = '23503';
  end if;

  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

drop trigger if exists set_quotation_payment_terms_tenant on public.quotation_payment_terms;

create trigger set_quotation_payment_terms_tenant
before insert or update on public.quotation_payment_terms
for each row
execute function public.set_quotation_payment_term_tenant();

drop trigger if exists set_quotation_payment_terms_updated_at on public.quotation_payment_terms;

create trigger set_quotation_payment_terms_updated_at
before update on public.quotation_payment_terms
for each row
execute function public.set_updated_at();

alter table public.quotation_payment_terms enable row level security;

create policy "Super admins can manage quotation payment terms"
on public.quotation_payment_terms
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view quotation payment terms"
on public.quotation_payment_terms
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

create policy "Organization users can create quotation payment terms"
on public.quotation_payment_terms
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('quotations', 'create')
    or public.user_has_permission('quotations', 'update')
  )
);

create policy "Organization users can update quotation payment terms"
on public.quotation_payment_terms
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

create policy "Organization users can delete quotation payment terms"
on public.quotation_payment_terms
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);
