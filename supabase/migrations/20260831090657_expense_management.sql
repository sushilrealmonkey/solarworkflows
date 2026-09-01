-- Expense management: company-scoped vendor categories, vendor expenses,
-- receipt storage, permissions, and tenant-safe access controls.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values ('expenses', 'Expenses', 'Day-to-day vendor expense management', 405, true)
on conflict (module_key) do update
set module_name = excluded.module_name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;

update public.modules
set module_name = 'Vendors', description = 'Vendor and supplier management'
where module_key = 'vendors';

insert into public.permissions (module_id, action_key, action_name)
select modules.id, actions.action_key, actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('update', 'Update'),
    ('delete', 'Delete')
) actions(action_key, action_name)
where modules.module_key = 'expenses'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.subscription_plan_entitlements (plan_key, module_key)
values ('premium', 'expenses')
on conflict do nothing;

create table public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vendor_categories_company_name_unique
on public.vendor_categories (company_id, lower(btrim(name)));

create index vendor_categories_company_active_idx
on public.vendor_categories (company_id, is_active, name);

alter table public.vendors
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists category_id uuid references public.vendor_categories(id) on delete restrict,
  add column if not exists preferred_payment_method text,
  add column if not exists payment_terms_days integer;

update public.vendors
set company_id = organizations.company_id
from public.organizations
where vendors.organization_id = organizations.id
  and vendors.company_id is distinct from organizations.company_id;

do $$
begin
  if exists (select 1 from public.vendors where company_id is null) then
    raise exception 'Cannot enforce vendors.company_id: unresolved tenant rows exist';
  end if;
end;
$$;

alter table public.vendors alter column company_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendors_payment_terms_days_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors
      add constraint vendors_payment_terms_days_check
      check (payment_terms_days is null or payment_terms_days between 0 and 365);
  end if;
end;
$$;

insert into public.vendor_categories (company_id, organization_id, name)
select tenant.company_id, tenant.organization_id, defaults.name
from (
  select distinct on (organizations.company_id)
    organizations.company_id,
    organizations.id as organization_id
  from public.organizations
  where organizations.company_id is not null
  order by organizations.company_id, organizations.created_at nulls last, organizations.id
) tenant
cross join (
  values
    ('Transportation'),
    ('Electrician'),
    ('Helper'),
    ('Material Supplier'),
    ('Contractor'),
    ('Installer'),
    ('Equipment Rental'),
    ('Service Provider'),
    ('Consultant'),
    ('Other')
) defaults(name)
on conflict do nothing;

update public.vendors
set category_id = matched.id
from public.vendor_categories matched
where vendors.category_id is null
  and matched.company_id = vendors.company_id
  and lower(matched.name) = case vendors.vendor_type
    when 'supplier' then 'material supplier'
    when 'contractor' then 'contractor'
    when 'installer' then 'installer'
    when 'transporter' then 'transportation'
    when 'service_provider' then 'service provider'
    else 'other'
  end;

create index if not exists vendors_company_category_idx
on public.vendors (company_id, category_id);

create index if not exists vendors_company_status_name_idx
on public.vendors (company_id, status, vendor_name);

create table public.vendor_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  category_id uuid references public.vendor_categories(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  payment_status text not null default 'due'
    check (payment_status in ('due', 'paid')),
  due_date date,
  paid_date date,
  payment_method text check (
    payment_method is null
    or payment_method in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')
  ),
  invoice_number text,
  payment_reference text,
  description text not null check (btrim(description) <> ''),
  notes text,
  receipt_file_path text,
  receipt_file_name text,
  receipt_mime_type text,
  receipt_file_size bigint check (receipt_file_size is null or receipt_file_size > 0),
  created_by uuid references public.users_profile(id) on delete set null,
  updated_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= expense_date),
  check (paid_date is null or paid_date >= expense_date)
);

create index vendor_expenses_company_date_idx
on public.vendor_expenses (company_id, expense_date desc, created_at desc);

create index vendor_expenses_vendor_date_idx
on public.vendor_expenses (vendor_id, expense_date desc);

create index vendor_expenses_category_idx
on public.vendor_expenses (category_id)
where category_id is not null;

create index vendor_expenses_project_idx
on public.vendor_expenses (project_id)
where project_id is not null;

create index vendor_expenses_company_status_due_idx
on public.vendor_expenses (company_id, payment_status, due_date)
where payment_status = 'due';

create or replace function private.seed_vendor_categories()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.company_id is null then
    return new;
  end if;

  insert into public.vendor_categories (company_id, organization_id, name)
  select new.company_id, new.id, defaults.name
  from (values
    ('Transportation'), ('Electrician'), ('Helper'), ('Material Supplier'),
    ('Contractor'), ('Installer'), ('Equipment Rental'), ('Service Provider'),
    ('Consultant'), ('Other')
  ) defaults(name)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists seed_vendor_categories_for_organization on public.organizations;
create trigger seed_vendor_categories_for_organization
after insert or update of company_id on public.organizations
for each row execute function private.seed_vendor_categories();

drop trigger if exists set_vendor_categories_company_id on public.vendor_categories;
create trigger set_vendor_categories_company_id
before insert or update of organization_id, company_id on public.vendor_categories
for each row execute function private.set_company_from_organization();

drop trigger if exists set_vendors_company_id on public.vendors;
create trigger set_vendors_company_id
before insert or update of organization_id, company_id on public.vendors
for each row execute function private.set_company_from_organization();

create or replace function private.validate_vendor_category()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.vendor_categories categories
    where categories.id = new.category_id
      and categories.company_id = new.company_id
  ) then
    raise exception 'Vendor category must belong to the same company'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_vendor_category on public.vendors;
create trigger validate_vendor_category
before insert or update of category_id, company_id on public.vendors
for each row execute function private.validate_vendor_category();

create or replace function private.set_vendor_expense_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  resolved_company_id uuid;
  vendor_record record;
  actor_profile_id uuid;
begin
  select organizations.company_id into resolved_company_id
  from public.organizations
  where organizations.id = new.organization_id;

  if resolved_company_id is null then
    raise exception 'Expense organization must be linked to a company'
      using errcode = '23503';
  end if;

  if new.company_id is not null and new.company_id <> resolved_company_id then
    raise exception 'Expense company_id must match organization_id'
      using errcode = '23503';
  end if;
  new.company_id := resolved_company_id;

  select vendors.company_id, vendors.organization_id, vendors.category_id
  into vendor_record
  from public.vendors
  where vendors.id = new.vendor_id;

  if not found
    or vendor_record.company_id <> new.company_id
    or vendor_record.organization_id <> new.organization_id then
    raise exception 'Expense vendor must belong to the same company and organization'
      using errcode = '23503';
  end if;

  new.category_id := coalesce(new.category_id, vendor_record.category_id);
  if new.category_id is not null and not exists (
    select 1 from public.vendor_categories categories
    where categories.id = new.category_id
      and categories.company_id = new.company_id
  ) then
    raise exception 'Expense category must belong to the same company'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects projects
    where projects.id = new.project_id
      and projects.company_id = new.company_id
  ) then
    raise exception 'Expense project must belong to the same company'
      using errcode = '23503';
  end if;

  select users_profile.id into actor_profile_id
  from public.users_profile
  where users_profile.auth_user_id = (select auth.uid())
    and users_profile.company_id = new.company_id
    and users_profile.status = 'active'
  limit 1;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_profile_id);
  end if;
  new.updated_by := coalesce(actor_profile_id, new.updated_by);

  if new.payment_status = 'due' then
    new.paid_date := null;
  elsif new.paid_date is null then
    new.paid_date := greatest(new.expense_date, current_date);
  end if;

  return new;
end;
$$;

drop trigger if exists set_vendor_expense_defaults on public.vendor_expenses;
create trigger set_vendor_expense_defaults
before insert or update on public.vendor_expenses
for each row execute function private.set_vendor_expense_defaults();

create trigger set_vendor_categories_updated_at
before update on public.vendor_categories
for each row execute function public.set_updated_at();

create trigger set_vendor_expenses_updated_at
before update on public.vendor_expenses
for each row execute function public.set_updated_at();

drop trigger if exists enforce_subscription_write_vendor_categories on public.vendor_categories;
create trigger enforce_subscription_write_vendor_categories
before insert or update or delete on public.vendor_categories
for each row execute function public.enforce_company_subscription_write('vendors');

drop trigger if exists enforce_subscription_write_vendor_expenses on public.vendor_expenses;
create trigger enforce_subscription_write_vendor_expenses
before insert or update or delete on public.vendor_expenses
for each row execute function public.enforce_company_subscription_write('expenses');

alter table public.vendor_categories enable row level security;
alter table public.vendor_expenses enable row level security;
alter table public.vendors enable row level security;

drop policy if exists "Super admins can manage vendor categories" on public.vendor_categories;
drop policy if exists "Company users can view vendor categories" on public.vendor_categories;
drop policy if exists "Company users can create vendor categories" on public.vendor_categories;
drop policy if exists "Company users can update vendor categories" on public.vendor_categories;
drop policy if exists "Company users can delete vendor categories" on public.vendor_categories;

create policy "Super admins can manage vendor categories"
on public.vendor_categories for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Company users can view vendor categories"
on public.vendor_categories for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'view'))
);

create policy "Company users can create vendor categories"
on public.vendor_categories for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'create'))
);

create policy "Company users can update vendor categories"
on public.vendor_categories for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
);

create policy "Company users can delete vendor categories"
on public.vendor_categories for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'delete'))
);

drop policy if exists "Super admins can manage vendor expenses" on public.vendor_expenses;
drop policy if exists "Company users can view vendor expenses" on public.vendor_expenses;
drop policy if exists "Company users can create vendor expenses" on public.vendor_expenses;
drop policy if exists "Company users can update vendor expenses" on public.vendor_expenses;
drop policy if exists "Company users can delete vendor expenses" on public.vendor_expenses;

create policy "Super admins can manage vendor expenses"
on public.vendor_expenses for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Company users can view vendor expenses"
on public.vendor_expenses for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('expenses', 'view'))
);

create policy "Company users can create vendor expenses"
on public.vendor_expenses for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('expenses', 'create'))
);

create policy "Company users can update vendor expenses"
on public.vendor_expenses for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('expenses', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('expenses', 'update'))
);

create policy "Company users can delete vendor expenses"
on public.vendor_expenses for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('expenses', 'delete'))
);

drop policy if exists "Organization users can view vendors" on public.vendors;
drop policy if exists "Organization users can create vendors" on public.vendors;
drop policy if exists "Organization users can update vendors" on public.vendors;
drop policy if exists "Organization users can delete vendors" on public.vendors;

create policy "Company users can view vendors"
on public.vendors for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'view'))
);

create policy "Company users can create vendors"
on public.vendors for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'create'))
);

create policy "Company users can update vendors"
on public.vendors for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
);

create policy "Company users can delete vendors"
on public.vendors for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'delete'))
);

revoke all on table public.vendor_categories from anon, authenticated;
revoke all on table public.vendor_expenses from anon, authenticated;
revoke all on table public.vendors from anon, authenticated;
grant select, insert, update, delete on table public.vendor_categories to authenticated;
grant select, insert, update, delete on table public.vendor_expenses to authenticated;
grant select, insert, update, delete on table public.vendors to authenticated;
grant select, insert, update, delete on table public.vendor_categories to service_role;
grant select, insert, update, delete on table public.vendor_expenses to service_role;
grant select, insert, update, delete on table public.vendors to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Company users can read expense receipts" on storage.objects;
drop policy if exists "Company users can upload expense receipts" on storage.objects;
drop policy if exists "Company users can delete expense receipts" on storage.objects;

create policy "Company users can read expense receipts"
on storage.objects for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and exists (
    select 1 from public.vendor_expenses expenses
    where expenses.receipt_file_path = storage.objects.name
      and expenses.company_id = (select public.current_user_company_id())
      and (select public.user_has_permission('expenses', 'view'))
  )
);

create policy "Company users can upload expense receipts"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1] = (select public.current_user_company_id())::text
  and (select public.user_has_permission('expenses', 'create'))
);

create policy "Company users can delete expense receipts"
on storage.objects for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1] = (select public.current_user_company_id())::text
  and (select public.user_has_permission('expenses', 'update'))
);

-- Keep standard roles deterministic when they are reseeded by Settings.
create or replace function public.seed_epc_standard_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  role_record record;
  target_role_id uuid;
  target_company_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required' using errcode = '23502';
  end if;

  select company_id into target_company_id
  from public.organizations where id = target_organization_id;
  if target_company_id is null then
    raise exception 'Organization must be linked to a company before roles are seeded'
      using errcode = '23503';
  end if;

  for role_record in
    select * from (values
      ('admin', 'Admin', 'Company-wide administration, assignment, audit, and exception correction.', 10),
      ('sales_team', 'Sales', 'Own CRM and commercial pipeline with related status and collection summaries.', 20),
      ('backend_team', 'Backend', 'Company-wide operational fulfilment without accounting mutation.', 30),
      ('accounts', 'Accounts', 'Company-wide finance with read-only operational context.', 40),
      ('field_staff', 'Field Staff', 'Assigned site surveys and released installation work only.', 50)
    ) standard_roles(role_key, role_name, description, sort_order)
    order by sort_order
  loop
    insert into public.roles (
      company_id, organization_id, role_key, role_name, description, is_system_role
    ) values (
      target_company_id, target_organization_id, role_record.role_key,
      role_record.role_name, role_record.description, true
    )
    on conflict (organization_id, role_key) where role_key is not null do update
    set company_id = excluded.company_id,
        role_name = excluded.role_name,
        description = excluded.description,
        is_system_role = true,
        updated_at = now()
    returning id into target_role_id;

    delete from public.role_permissions where role_id = target_role_id;
    delete from public.role_module_scopes where role_id = target_role_id;

    if role_record.role_key = 'admin' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions permissions
      join public.modules modules on modules.id = permissions.module_id
      where modules.is_active
      on conflict (role_id, permission_id) do nothing;

      insert into public.role_module_scopes (
        company_id, organization_id, role_id, module_key, scope_key
      )
      select target_company_id, target_organization_id, target_role_id, modules.module_key, 'company'
      from public.modules modules where modules.is_active
      on conflict (role_id, module_key) do update set scope_key = excluded.scope_key;
    else
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions permissions
      join public.modules modules on modules.id = permissions.module_id
      join (
        values
          ('sales_team','dashboard','view'),
          ('sales_team','assistant','view'),
          ('sales_team','leads','view'),('sales_team','leads','create'),('sales_team','leads','update'),
          ('sales_team','customers','view'),('sales_team','customers','create'),('sales_team','customers','update'),
          ('sales_team','site_surveys','view'),
          ('sales_team','quotations','view'),('sales_team','quotations','create'),('sales_team','quotations','update'),
          ('sales_team','projects','view'),
          ('sales_team','b2b_sales','view'),('sales_team','b2b_sales','create'),('sales_team','b2b_sales','update'),
          ('sales_team','product_master','view'),
          ('sales_team','documents','view'),('sales_team','documents','create'),
          ('sales_team','reports','view'),
          ('backend_team','dashboard','view'),('backend_team','assistant','view'),
          ('backend_team','leads','view'),('backend_team','customers','view'),
          ('backend_team','site_surveys','view'),('backend_team','site_surveys','create'),
          ('backend_team','site_surveys','update'),('backend_team','site_surveys','assign'),
          ('backend_team','site_surveys','update_status'),
          ('backend_team','projects','view'),('backend_team','projects','create'),
          ('backend_team','projects','update'),('backend_team','projects','assign'),
          ('backend_team','projects','update_status'),
          ('backend_team','b2b_sales','fulfill'),
          ('backend_team','product_master','view'),('backend_team','product_master','create'),('backend_team','product_master','update'),
          ('backend_team','inventory','view'),('backend_team','inventory','create'),('backend_team','inventory','update'),
          ('backend_team','inventory','correct_stock'),
          ('backend_team','vendors','view'),('backend_team','vendors','create'),('backend_team','vendors','update'),
          ('backend_team','expenses','view'),('backend_team','expenses','create'),('backend_team','expenses','update'),
          ('backend_team','purchases','view'),('backend_team','purchases','create'),('backend_team','purchases','update'),
          ('backend_team','purchases','receive'),
          ('backend_team','documents','view'),('backend_team','documents','create'),('backend_team','documents','update'),
          ('backend_team','reports','view'),
          ('accounts','dashboard','view'),('accounts','assistant','view'),
          ('accounts','customers','view'),('accounts','quotations','view'),('accounts','projects','view'),
          ('accounts','b2b_sales','view'),('accounts','product_master','view'),
          ('accounts','product_pricing','view'),('accounts','product_pricing','create'),
          ('accounts','product_pricing','update'),('accounts','product_pricing','manage_pricing'),
          ('accounts','inventory','view_financials'),
          ('accounts','vendors','view'),('accounts','purchases','view'),
          ('accounts','expenses','view'),('accounts','expenses','create'),('accounts','expenses','update'),
          ('accounts','invoices','view'),('accounts','invoices','create'),('accounts','invoices','update'),
          ('accounts','payments','view'),('accounts','payments','create'),('accounts','payments','update'),
          ('accounts','documents','view'),('accounts','documents','create'),('accounts','documents','update'),
          ('accounts','reports','view'),
          ('field_staff','dashboard','view'),
          ('field_staff','site_surveys','view'),('field_staff','site_surveys','update_status'),
          ('field_staff','site_surveys','update_technical'),('field_staff','site_surveys','upload_evidence'),
          ('field_staff','projects','view'),('field_staff','projects','update_status')
      ) allowed(role_key, module_key, action_key)
        on allowed.role_key = role_record.role_key
       and allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active
      on conflict (role_id, permission_id) do nothing;

      insert into public.role_module_scopes (
        company_id, organization_id, role_id, module_key, scope_key
      )
      select target_company_id, target_organization_id, target_role_id,
             scoped.module_key, scoped.scope_key
      from (values
        ('sales_team','dashboard','assigned_or_unassigned_created'),
        ('sales_team','assistant','assigned_or_unassigned_created'),
        ('sales_team','leads','assigned_or_unassigned_created'),
        ('sales_team','customers','assigned_or_unassigned_created'),
        ('sales_team','site_surveys','related_operations'),
        ('sales_team','quotations','assigned_or_unassigned_created'),
        ('sales_team','projects','related_operations'),
        ('sales_team','b2b_sales','assigned_or_unassigned_created'),
        ('sales_team','product_master','company'),
        ('sales_team','invoices','related_finance'),('sales_team','payments','related_finance'),
        ('sales_team','documents','related_operations'),('sales_team','reports','assigned_or_unassigned_created'),
        ('backend_team','dashboard','company'),('backend_team','assistant','related_operations'),
        ('backend_team','leads','related_operations'),('backend_team','customers','related_operations'),
        ('backend_team','site_surveys','company'),('backend_team','quotations','related_operations'),
        ('backend_team','projects','company'),('backend_team','b2b_sales','related_operations'),
        ('backend_team','product_master','company'),('backend_team','product_pricing','related_operations'),
        ('backend_team','inventory','company'),('backend_team','vendors','company'),
        ('backend_team','expenses','company'),
        ('backend_team','purchases','company'),('backend_team','documents','related_operations'),
        ('backend_team','reports','company'),
        ('accounts','dashboard','company'),('accounts','assistant','related_finance'),
        ('accounts','customers','related_finance'),('accounts','quotations','company'),
        ('accounts','projects','related_finance'),('accounts','b2b_sales','company'),
        ('accounts','product_master','company'),('accounts','product_pricing','company'),
        ('accounts','inventory','company'),('accounts','vendors','related_finance'),
        ('accounts','expenses','company'),
        ('accounts','purchases','company'),('accounts','invoices','company'),
        ('accounts','payments','company'),('accounts','documents','related_finance'),
        ('accounts','reports','company'),
        ('field_staff','dashboard','assigned_field'),
        ('field_staff','site_surveys','assigned_field'),('field_staff','projects','assigned_field')
      ) scoped(role_key, module_key, scope_key)
      where scoped.role_key = role_record.role_key
      on conflict (role_id, module_key) do update set scope_key = excluded.scope_key;
    end if;
  end loop;
end;
$$;

select public.seed_epc_standard_roles(organizations.id)
from public.organizations
where organizations.company_id is not null;

notify pgrst, 'reload schema';
