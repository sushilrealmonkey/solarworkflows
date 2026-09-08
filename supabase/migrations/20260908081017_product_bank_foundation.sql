-- Shared Product Bank: platform-maintained templates that tenants can copy
-- into their company-owned Product Master without sharing operational data.

-- Products and categories are tenant business records. Bring their ownership
-- model in line with the rest of the company-scoped application before adding
-- a source mapping to the shared bank.
alter table public.product_categories
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.products
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists product_bank_id uuid,
  add column if not exists product_bank_revision integer,
  add column if not exists product_bank_imported_at timestamptz,
  add column if not exists product_bank_imported_by uuid references public.users_profile(id) on delete set null;

update public.product_categories categories
set company_id = organizations.company_id
from public.organizations
where organizations.id = categories.tenant_id
  and categories.company_id is distinct from organizations.company_id;

update public.products products
set company_id = organizations.company_id
from public.organizations
where organizations.id = products.tenant_id
  and products.company_id is distinct from organizations.company_id;

do $$
begin
  if exists (select 1 from public.product_categories where company_id is null) then
    raise exception 'Cannot enforce product_categories.company_id: unresolved tenant rows exist';
  end if;

  if exists (select 1 from public.products where company_id is null) then
    raise exception 'Cannot enforce products.company_id: unresolved tenant rows exist';
  end if;
end;
$$;

alter table public.product_categories alter column company_id set not null;
alter table public.products alter column company_id set not null;

create index if not exists product_categories_company_id_idx
  on public.product_categories (company_id);
create index if not exists products_company_id_idx
  on public.products (company_id);

-- The shared bank is platform data, while company_id records which platform
-- company owns a template. It is assigned from the authenticated administrator
-- rather than a hard-coded company.
create table if not exists public.catalog_library_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  category_id uuid not null references public.catalog_library_categories(id) on delete restrict,
  product_name text not null,
  brand text,
  model_number text,
  specifications text,
  unit text not null default 'piece',
  hsn_code text,
  gst_percent numeric not null default 0,
  warranty_description text,
  notes text,
  publication_status text not null default 'draft',
  revision integer not null default 1,
  published_at timestamptz,
  created_by uuid references public.users_profile(id) on delete set null,
  updated_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_library_products_publication_status_check'
      and conrelid = 'public.catalog_library_products'::regclass
  ) then
    alter table public.catalog_library_products
      add constraint catalog_library_products_publication_status_check
      check (publication_status in ('draft', 'published', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_library_products_gst_percent_check'
      and conrelid = 'public.catalog_library_products'::regclass
  ) then
    alter table public.catalog_library_products
      add constraint catalog_library_products_gst_percent_check
      check (gst_percent >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_library_products_revision_check'
      and conrelid = 'public.catalog_library_products'::regclass
  ) then
    alter table public.catalog_library_products
      add constraint catalog_library_products_revision_check
      check (revision > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_library_products_unit_check'
      and conrelid = 'public.catalog_library_products'::regclass
  ) then
    alter table public.catalog_library_products
      add constraint catalog_library_products_unit_check
      check (unit in ('piece', 'set', 'roll', 'meter', 'kg', 'watt', 'kw', 'lot'));
  end if;
end;
$$;

alter table public.products
  add constraint products_product_bank_id_fkey
  foreign key (product_bank_id)
  references public.catalog_library_products(id)
  on delete restrict;

create unique index if not exists products_company_product_bank_unique
  on public.products (company_id, product_bank_id)
  where product_bank_id is not null;

create index if not exists catalog_library_products_public_browse_idx
  on public.catalog_library_products (publication_status, category_id, product_name);

create index if not exists catalog_library_products_company_id_idx
  on public.catalog_library_products (company_id);

create or replace function public.set_product_category_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_company_id uuid;
begin
  select organizations.company_id
  into tenant_company_id
  from public.organizations
  where organizations.id = new.tenant_id;

  if tenant_company_id is null then
    raise exception 'tenant_id must reference an organization with a company_id'
      using errcode = '23503';
  end if;

  if new.company_id is null then
    new.company_id := tenant_company_id;
  elsif new.company_id <> tenant_company_id then
    raise exception 'company_id must belong to the product category tenant'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_product_category_company_id on public.product_categories;
create trigger set_product_category_company_id
before insert or update of tenant_id, company_id on public.product_categories
for each row
execute function public.set_product_category_company_id();

create or replace function public.set_product_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_category record;
begin
  if new.product_code is null or trim(new.product_code) = '' then
    new.product_code := public.generate_product_code(new.tenant_id);
  end if;

  select product_categories.tenant_id,
         product_categories.company_id,
         product_categories.category_type
  into selected_category
  from public.product_categories
  where product_categories.id = new.category_id;

  if selected_category.tenant_id is null then
    raise exception 'category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if selected_category.tenant_id <> new.tenant_id then
    raise exception 'category_id must belong to the same tenant as the product'
      using errcode = '23503';
  end if;

  if new.company_id is null then
    new.company_id := selected_category.company_id;
  elsif new.company_id <> selected_category.company_id then
    raise exception 'company_id must belong to the selected product category tenant'
      using errcode = '23503';
  end if;

  new.category_type := selected_category.category_type;
  new.product_code := upper(btrim(new.product_code));
  new.product_name := btrim(new.product_name);
  new.hsn_code := nullif(btrim(coalesce(new.hsn_code, '')), '');
  new.brand := nullif(btrim(coalesce(new.brand, '')), '');
  new.model_number := nullif(btrim(coalesce(new.model_number, '')), '');
  new.specifications := nullif(btrim(coalesce(new.specifications, '')), '');
  new.unit := lower(btrim(new.unit));
  new.purchase_price := coalesce(new.purchase_price, 0);
  new.selling_price := coalesce(new.selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.minimum_stock_alert := coalesce(new.minimum_stock_alert, 0);
  new.status := coalesce(nullif(lower(btrim(new.status)), ''), 'active');
  new.warranty_description := nullif(btrim(coalesce(new.warranty_description, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');

  return new;
end;
$$;

create or replace function public.set_catalog_library_product_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.get_current_user_company_id();
  end if;

  if new.company_id is null then
    raise exception 'A platform company is required to manage Product Bank templates'
      using errcode = '23502';
  end if;

  if not exists (
    select 1 from public.catalog_library_categories
    where id = new.category_id
  ) then
    raise exception 'category_id must reference an existing catalog library category'
      using errcode = '23503';
  end if;

  new.product_name := btrim(new.product_name);
  new.brand := nullif(btrim(coalesce(new.brand, '')), '');
  new.model_number := nullif(btrim(coalesce(new.model_number, '')), '');
  new.specifications := nullif(btrim(coalesce(new.specifications, '')), '');
  new.hsn_code := nullif(btrim(coalesce(new.hsn_code, '')), '');
  new.unit := lower(btrim(new.unit));
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.warranty_description := nullif(btrim(coalesce(new.warranty_description, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.publication_status := coalesce(nullif(lower(btrim(new.publication_status)), ''), 'draft');
  new.updated_by := public.current_user_profile_id();

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.current_user_profile_id());
    if new.publication_status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if new.product_name is distinct from old.product_name
    or new.category_id is distinct from old.category_id
    or new.brand is distinct from old.brand
    or new.model_number is distinct from old.model_number
    or new.specifications is distinct from old.specifications
    or new.unit is distinct from old.unit
    or new.hsn_code is distinct from old.hsn_code
    or new.gst_percent is distinct from old.gst_percent
    or new.warranty_description is distinct from old.warranty_description
    or new.notes is distinct from old.notes
    or new.publication_status is distinct from old.publication_status then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;

  if new.publication_status = 'published' and old.publication_status <> 'published' then
    new.published_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_catalog_library_product_defaults on public.catalog_library_products;
create trigger set_catalog_library_product_defaults
before insert or update on public.catalog_library_products
for each row
execute function public.set_catalog_library_product_defaults();

drop trigger if exists set_catalog_library_products_updated_at on public.catalog_library_products;
create trigger set_catalog_library_products_updated_at
before update on public.catalog_library_products
for each row
execute function public.set_updated_at();

alter table public.catalog_library_products enable row level security;

revoke all on table public.catalog_library_products from anon, authenticated;
grant select, insert, update, delete on table public.catalog_library_products to authenticated;

drop policy if exists "Product master users can view published Product Bank templates" on public.catalog_library_products;
create policy "Product master users can view published Product Bank templates"
on public.catalog_library_products for select to authenticated
using (
  public.is_super_admin()
  or (
    publication_status = 'published'
    and public.user_has_permission('product_master', 'view')
  )
);

drop policy if exists "Super admins can manage Product Bank templates" on public.catalog_library_products;
create policy "Super admins can manage Product Bank templates"
on public.catalog_library_products for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- Tighten existing Product Master RLS to bind both the organization and company
-- identities. The product APIs continue to use tenant_id for backwards-compatible
-- routes while the company id prevents a cross-company alias from leaking data.
drop policy if exists "Super admins can manage product categories" on public.product_categories;
drop policy if exists "Tenant users can view product categories" on public.product_categories;
drop policy if exists "Tenant users can create product categories" on public.product_categories;
drop policy if exists "Tenant users can update product categories" on public.product_categories;
drop policy if exists "Tenant users can delete product categories" on public.product_categories;

create policy "Super admins can manage product categories"
on public.product_categories for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view product categories"
on public.product_categories for select to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create product categories"
on public.product_categories for insert to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update product categories"
on public.product_categories for update to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'update')
);

create policy "Tenant users can delete product categories"
on public.product_categories for delete to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'delete')
);

drop policy if exists "Super admins can manage products" on public.products;
drop policy if exists "Tenant users can view products" on public.products;
drop policy if exists "Tenant users can create products" on public.products;
drop policy if exists "Tenant users can update products" on public.products;
drop policy if exists "Tenant users can delete products" on public.products;

create policy "Super admins can manage products"
on public.products for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view products"
on public.products for select to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create products"
on public.products for insert to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update products"
on public.products for update to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'update')
);

create policy "Tenant users can delete products"
on public.products for delete to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('product_master', 'delete')
);

create or replace function public.product_category_public_rows()
returns table(category_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user' using errcode = '42501';
  end if;

  if not public.is_super_admin() and target_company_id is null then
    raise exception 'No company is assigned to this user' using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('product_master', 'view')
      or public.user_has_permission('quotations', 'view')
      or public.user_has_permission('inventory', 'view')
    ) then
    raise exception 'Missing product catalog view permission' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', categories.id,
    'tenant_id', categories.tenant_id,
    'company_id', categories.company_id,
    'name', categories.name,
    'description', categories.description,
    'category_type', categories.category_type,
    'display_order', categories.display_order,
    'is_active', categories.is_active,
    'created_at', categories.created_at,
    'updated_at', categories.updated_at,
    'archived_at', categories.archived_at,
    'archived_by', categories.archived_by,
    'archive_reason', categories.archive_reason
  )
  from public.product_categories categories
  where public.is_super_admin()
     or (
       categories.tenant_id = target_organization_id
       and categories.company_id = target_company_id
     )
  order by categories.display_order, categories.name;
end;
$$;

create or replace function public.product_catalog_public_rows()
returns table(product_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user' using errcode = '42501';
  end if;

  if not public.is_super_admin() and target_company_id is null then
    raise exception 'No company is assigned to this user' using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('product_master', 'view')
      or public.user_has_permission('quotations', 'view')
      or public.user_has_permission('inventory', 'view')
    ) then
    raise exception 'Missing product catalog view permission' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', products.id,
    'tenant_id', products.tenant_id,
    'company_id', products.company_id,
    'serial_number', products.serial_number,
    'product_code', products.product_code,
    'product_name', products.product_name,
    'category_id', products.category_id,
    'category_type', products.category_type,
    'hsn_code', products.hsn_code,
    'brand', products.brand,
    'model_number', products.model_number,
    'specifications', products.specifications,
    'unit', products.unit,
    'gst_percent', products.gst_percent,
    'warranty_description', products.warranty_description,
    'status', products.status,
    'notes', products.notes,
    'product_bank_id', products.product_bank_id,
    'product_bank_revision', products.product_bank_revision,
    'product_bank_imported_at', products.product_bank_imported_at,
    'purchase_price', null,
    'selling_price', null,
    'minimum_stock_alert', null,
    'created_at', products.created_at,
    'updated_at', products.updated_at,
    'archived_at', products.archived_at,
    'archived_by', products.archived_by,
    'archive_reason', products.archive_reason,
    'category', case when categories.id is null then null else jsonb_build_object(
      'id', categories.id,
      'name', categories.name,
      'category_type', categories.category_type,
      'display_order', categories.display_order
    ) end
  )
  from public.products products
  left join public.product_categories categories on categories.id = products.category_id
  where public.is_super_admin()
     or (
       products.tenant_id = target_organization_id
       and products.company_id = target_company_id
     )
  order by products.serial_number, products.created_at, products.id;
end;
$$;

-- A safe projection for Product Bank browsing includes each caller's own
-- import state and no other tenant product data.
create or replace function public.product_bank_public_rows()
returns table(product_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
  organization_company_id uuid;
begin
  if not public.is_super_admin() then
    if target_organization_id is null or target_company_id is null then
      raise exception 'An organization and company are required to browse Product Bank'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('product_master', 'view') then
      raise exception 'Missing product_master view permission' using errcode = '42501';
    end if;
  end if;

  if target_organization_id is not null then
    select company_id into organization_company_id
    from public.organizations
    where id = target_organization_id;

    if organization_company_id is distinct from target_company_id then
      raise exception 'Current organization and company do not match' using errcode = '42501';
    end if;
  end if;

  return query
  select jsonb_build_object(
    'id', bank.id,
    'company_id', bank.company_id,
    'category_id', bank.category_id,
    'product_name', bank.product_name,
    'brand', bank.brand,
    'model_number', bank.model_number,
    'specifications', bank.specifications,
    'unit', bank.unit,
    'hsn_code', bank.hsn_code,
    'gst_percent', bank.gst_percent,
    'warranty_description', bank.warranty_description,
    'notes', bank.notes,
    'publication_status', bank.publication_status,
    'revision', bank.revision,
    'published_at', bank.published_at,
    'created_at', bank.created_at,
    'updated_at', bank.updated_at,
    'category', jsonb_build_object(
      'id', categories.id,
      'name', categories.name,
      'category_type', categories.category_type
    ),
    'workspace_product', case when workspace_products.id is null then null else jsonb_build_object(
      'id', workspace_products.id,
      'archived_at', workspace_products.archived_at,
      'product_bank_revision', workspace_products.product_bank_revision
    ) end
  )
  from public.catalog_library_products bank
  join public.catalog_library_categories categories on categories.id = bank.category_id
  left join lateral (
    select products.id, products.archived_at, products.product_bank_revision
    from public.products products
    where products.product_bank_id = bank.id
      and products.tenant_id = target_organization_id
      and products.company_id = target_company_id
    limit 1
  ) workspace_products on true
  where public.is_super_admin() or bank.publication_status = 'published'
  order by categories.display_order, bank.product_name, bank.brand, bank.model_number;
end;
$$;

create or replace function public.import_product_bank_products(target_product_bank_ids uuid[])
returns table(product_bank_id uuid, product_id uuid, import_action text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
  organization_company_id uuid;
  normalized_ids uuid[];
  bank_record record;
  tenant_category_id uuid;
  existing_product_id uuid;
  existing_archived_at timestamptz;
begin
  select array_agg(distinct bank_id) into normalized_ids
  from unnest(coalesce(target_product_bank_ids, array[]::uuid[])) as selected(bank_id);

  if coalesce(cardinality(normalized_ids), 0) = 0 then
    raise exception 'Select at least one Product Bank item' using errcode = '22023';
  end if;

  if target_organization_id is null or target_company_id is null then
    raise exception 'An organization and company are required to import Product Bank items'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('product_master', 'create') then
    raise exception 'Missing product_master create permission' using errcode = '42501';
  end if;

  select company_id into organization_company_id
  from public.organizations
  where id = target_organization_id;

  if organization_company_id is distinct from target_company_id then
    raise exception 'Current organization and company do not match' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.catalog_library_products
    where id = any(normalized_ids)
      and publication_status = 'published'
  ) <> cardinality(normalized_ids) then
    raise exception 'One or more selected Product Bank items are not available'
      using errcode = '22023';
  end if;

  for bank_record in
    select bank.*, categories.name as category_name, categories.category_type,
           categories.description as category_description
    from public.catalog_library_products bank
    join public.catalog_library_categories categories on categories.id = bank.category_id
    where bank.id = any(normalized_ids)
      and bank.publication_status = 'published'
    order by categories.display_order, bank.product_name, bank.id
    for share of bank
  loop
    select products.id, products.archived_at
    into existing_product_id, existing_archived_at
    from public.products products
    where products.company_id = target_company_id
      and products.product_bank_id = bank_record.id
    for update;

    if existing_product_id is not null then
      if existing_archived_at is not null then
        perform set_config('app.lifecycle_transition', 'on', true);
        update public.products
        set archived_at = null,
            product_bank_revision = bank_record.revision,
            product_bank_imported_at = now(),
            product_bank_imported_by = public.current_user_profile_id()
        where id = existing_product_id;

        return query select bank_record.id, existing_product_id, 'restored'::text;
      else
        return query select bank_record.id, existing_product_id, 'already_added'::text;
      end if;
      continue;
    end if;

    select categories.id
    into tenant_category_id
    from public.product_categories categories
    where categories.tenant_id = target_organization_id
      and categories.company_id = target_company_id
      and categories.archived_at is null
      and (
        lower(btrim(categories.name)) = lower(btrim(bank_record.category_name))
        or (
          bank_record.category_type <> 'OTHER'::public.product_category_type
          and categories.category_type = bank_record.category_type
        )
      )
    order by case when lower(btrim(categories.name)) = lower(btrim(bank_record.category_name)) then 0 else 1 end,
             categories.display_order
    limit 1;

    if tenant_category_id is null then
      insert into public.product_categories (
        tenant_id,
        company_id,
        name,
        category_type,
        description,
        is_active
      ) values (
        target_organization_id,
        target_company_id,
        bank_record.category_name,
        bank_record.category_type,
        bank_record.category_description,
        true
      )
      returning id into tenant_category_id;
    end if;

    insert into public.products (
      tenant_id,
      company_id,
      product_name,
      category_id,
      hsn_code,
      brand,
      model_number,
      specifications,
      unit,
      gst_percent,
      warranty_description,
      status,
      notes,
      product_bank_id,
      product_bank_revision,
      product_bank_imported_at,
      product_bank_imported_by
    ) values (
      target_organization_id,
      target_company_id,
      bank_record.product_name,
      tenant_category_id,
      bank_record.hsn_code,
      bank_record.brand,
      bank_record.model_number,
      bank_record.specifications,
      bank_record.unit,
      bank_record.gst_percent,
      bank_record.warranty_description,
      'active',
      bank_record.notes,
      bank_record.id,
      bank_record.revision,
      now(),
      public.current_user_profile_id()
    )
    on conflict (company_id, product_bank_id) where product_bank_id is not null
    do nothing
    returning id into existing_product_id;

    if existing_product_id is null then
      select products.id into existing_product_id
      from public.products products
      where products.company_id = target_company_id
        and products.product_bank_id = bank_record.id;

      return query select bank_record.id, existing_product_id, 'already_added'::text;
    else
      return query select bank_record.id, existing_product_id, 'added'::text;
    end if;
  end loop;
end;
$$;

revoke all on function public.set_product_category_company_id() from public, anon, authenticated;
revoke all on function public.set_catalog_library_product_defaults() from public, anon, authenticated;
revoke all on function public.product_bank_public_rows() from public, anon;
revoke all on function public.import_product_bank_products(uuid[]) from public, anon;
grant execute on function public.product_category_public_rows() to authenticated;
grant execute on function public.product_catalog_public_rows() to authenticated;
grant execute on function public.product_bank_public_rows() to authenticated;
grant execute on function public.import_product_bank_products(uuid[]) to authenticated;

notify pgrst, 'reload schema';
