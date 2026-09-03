-- Reusable, company-scoped quotation packages. A package is a product snapshot
-- and turnkey commercial price that can be copied into a new quotation.

create table public.quotation_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  commercial_cost numeric(14,2) not null check (commercial_cost >= 0),
  is_active boolean not null default true,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index quotation_packages_company_name_unique
  on public.quotation_packages (company_id, lower(btrim(name)));
create index quotation_packages_company_active_idx
  on public.quotation_packages (company_id, is_active, name);
create index quotation_packages_organization_idx
  on public.quotation_packages (organization_id);

create table public.quotation_package_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_package_id uuid not null references public.quotation_packages(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null check (btrim(product_name) <> ''),
  hsn_code text,
  brand text,
  model_number text,
  specification text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index quotation_package_items_package_product_unique
  on public.quotation_package_items (quotation_package_id, product_id);
create index quotation_package_items_package_order_idx
  on public.quotation_package_items (quotation_package_id, display_order);
create index quotation_package_items_company_idx
  on public.quotation_package_items (company_id, organization_id);

alter table public.quotations
  add column if not exists quotation_package_id uuid
  references public.quotation_packages(id) on delete restrict;

create index if not exists quotations_package_idx
  on public.quotations (quotation_package_id)
  where quotation_package_id is not null;

create or replace function private.set_quotation_package_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  package_record public.quotation_packages%rowtype;
  product_record public.products%rowtype;
begin
  select * into package_record
  from public.quotation_packages
  where id = new.quotation_package_id;

  if not found then
    raise exception 'Quotation package was not found' using errcode = '23503';
  end if;

  if new.company_id is not null and new.company_id <> package_record.company_id then
    raise exception 'Quotation package item company_id must match its package' using errcode = '23503';
  end if;
  if new.organization_id is not null and new.organization_id <> package_record.organization_id then
    raise exception 'Quotation package item organization_id must match its package' using errcode = '23503';
  end if;

  new.company_id := package_record.company_id;
  new.organization_id := package_record.organization_id;

  select * into product_record
  from public.products
  where id = new.product_id
    and tenant_id = new.organization_id;

  if not found then
    raise exception 'Package products must belong to the same organization' using errcode = '23503';
  end if;

  new.product_name := product_record.product_name;
  new.hsn_code := nullif(btrim(coalesce(product_record.hsn_code, '')), '');
  new.brand := nullif(btrim(coalesce(product_record.brand, '')), '');
  new.model_number := nullif(btrim(coalesce(product_record.model_number, '')), '');
  new.specification := nullif(btrim(coalesce(product_record.specifications, '')), '');
  new.unit := btrim(product_record.unit);
  return new;
end;
$$;

create or replace function private.validate_quotation_package_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.quotation_package_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.quotation_packages packages
    where packages.id = new.quotation_package_id
      and packages.company_id = new.company_id
      and packages.organization_id = new.organization_id
  ) then
    raise exception 'Quotation package must belong to the quotation company and organization'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_quotation_packages_company_id on public.quotation_packages;
create trigger set_quotation_packages_company_id
before insert or update of organization_id, company_id on public.quotation_packages
for each row execute function private.set_company_from_organization();

drop trigger if exists set_quotation_packages_updated_at on public.quotation_packages;
create trigger set_quotation_packages_updated_at
before update on public.quotation_packages
for each row execute function public.set_updated_at();

drop trigger if exists set_quotation_package_items_defaults on public.quotation_package_items;
create trigger set_quotation_package_items_defaults
before insert or update on public.quotation_package_items
for each row execute function private.set_quotation_package_item_defaults();

drop trigger if exists set_quotation_package_items_updated_at on public.quotation_package_items;
create trigger set_quotation_package_items_updated_at
before update on public.quotation_package_items
for each row execute function public.set_updated_at();

drop trigger if exists validate_quotation_package_link on public.quotations;
create trigger validate_quotation_package_link
before insert or update of organization_id, company_id, quotation_package_id on public.quotations
for each row execute function private.validate_quotation_package_link();

alter table public.quotation_packages enable row level security;
alter table public.quotation_package_items enable row level security;

drop policy if exists "Super admins can manage quotation packages" on public.quotation_packages;
drop policy if exists "Company users can view quotation packages" on public.quotation_packages;
drop policy if exists "Settings users can create quotation packages" on public.quotation_packages;
drop policy if exists "Settings users can update quotation packages" on public.quotation_packages;
drop policy if exists "Settings users can delete quotation packages" on public.quotation_packages;

create policy "Super admins can manage quotation packages"
on public.quotation_packages for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Company users can view quotation packages"
on public.quotation_packages for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (
    (select public.user_has_permission('settings', 'view'))
    or (select public.user_has_permission('quotations', 'view'))
  )
);

create policy "Settings users can create quotation packages"
on public.quotation_packages for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

create policy "Settings users can update quotation packages"
on public.quotation_packages for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

create policy "Settings users can delete quotation packages"
on public.quotation_packages for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

drop policy if exists "Super admins can manage quotation package items" on public.quotation_package_items;
drop policy if exists "Company users can view quotation package items" on public.quotation_package_items;
drop policy if exists "Settings users can create quotation package items" on public.quotation_package_items;
drop policy if exists "Settings users can update quotation package items" on public.quotation_package_items;
drop policy if exists "Settings users can delete quotation package items" on public.quotation_package_items;

create policy "Super admins can manage quotation package items"
on public.quotation_package_items for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Company users can view quotation package items"
on public.quotation_package_items for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (
    (select public.user_has_permission('settings', 'view'))
    or (select public.user_has_permission('quotations', 'view'))
  )
);

create policy "Settings users can create quotation package items"
on public.quotation_package_items for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

create policy "Settings users can update quotation package items"
on public.quotation_package_items for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

create policy "Settings users can delete quotation package items"
on public.quotation_package_items for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('settings', 'update'))
);

revoke all on table public.quotation_packages from anon, authenticated;
revoke all on table public.quotation_package_items from anon, authenticated;
grant select, insert, update, delete on table public.quotation_packages to authenticated;
grant select, insert, update, delete on table public.quotation_package_items to authenticated;
grant select, insert, update, delete on table public.quotation_packages to service_role;
grant select, insert, update, delete on table public.quotation_package_items to service_role;

revoke execute on function private.set_quotation_package_item_defaults() from public, anon, authenticated;
revoke execute on function private.validate_quotation_package_link() from public, anon, authenticated;

notify pgrst, 'reload schema';
