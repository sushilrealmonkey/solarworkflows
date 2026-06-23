-- Locked EPC standard roles and safe catalog selectors.
--
-- EPC admins assign locked standard roles to staff. They no longer create,
-- delete, or edit role permission matrices inside the tenant portal.

alter table public.roles
add column if not exists role_key text;

with ranked_admin_roles as (
  select
    roles.id,
    row_number() over (
      partition by roles.organization_id
      order by coalesce(roles.is_system_role, false) desc, roles.created_at, roles.id
    ) as role_rank
  from public.roles
  where roles.organization_id is not null
    and roles.role_key is null
    and lower(btrim(roles.role_name)) in ('admin', 'administrator')
)
update public.roles
set
  role_key = 'admin',
  role_name = 'Admin',
  description = coalesce(nullif(btrim(public.roles.description), ''), 'Full workspace administration with all controls.'),
  is_system_role = true,
  updated_at = now()
from ranked_admin_roles
where ranked_admin_roles.id = roles.id
  and ranked_admin_roles.role_rank = 1;

create unique index if not exists roles_organization_role_key_unique
on public.roles (organization_id, role_key)
where role_key is not null;

update public.roles
set
  role_key = 'sales_team',
  role_name = 'Sales',
  description = 'Leads, customers, sales, projects, and quotation access without product pricing.',
  is_system_role = true,
  updated_at = now()
where roles.role_key is null
  and lower(btrim(roles.role_name)) in ('sales', 'sales staff', 'sales team')
  and not exists (
    select 1
    from public.roles as existing_sales
    where existing_sales.organization_id = roles.organization_id
      and existing_sales.role_key = 'sales_team'
  );

update public.roles
set
  role_key = 'backend_team',
  role_name = 'Backend',
  description = 'Operational access across CRM, projects, quotations, products, categories, inventory, purchases, payments, and invoices without delete or pricing access.',
  is_system_role = true,
  updated_at = now()
where roles.role_key is null
  and lower(btrim(roles.role_name)) in ('backend', 'backend staff', 'backend team', 'inventory staff')
  and not exists (
    select 1
    from public.roles as existing_backend
    where existing_backend.organization_id = roles.organization_id
      and existing_backend.role_key = 'backend_team'
  );

update public.roles
set
  role_key = 'accounts',
  role_name = 'Accounts',
  description = 'Invoice, quotation, payment, and purchase access for accounts teams.',
  is_system_role = true,
  updated_at = now()
where roles.role_key is null
  and lower(btrim(roles.role_name)) in ('accounts', 'accountant', 'accounts staff', 'accounts team')
  and not exists (
    select 1
    from public.roles as existing_accounts
    where existing_accounts.organization_id = roles.organization_id
      and existing_accounts.role_key = 'accounts'
  );

update public.roles
set
  role_key = 'accounts',
  role_name = 'Accounts',
  description = 'Invoice, quotation, payment, and purchase access for accounts teams.',
  is_system_role = true,
  updated_at = now()
where roles.role_key = 'finance_team'
  and not exists (
    select 1
    from public.roles as existing_accounts
    where existing_accounts.organization_id = roles.organization_id
      and existing_accounts.role_key = 'accounts'
  );

update public.roles
set
  role_key = 'retired_'
    || coalesce(
      roles.role_key,
      regexp_replace(lower(btrim(roles.role_name)), '[^a-z0-9]+', '_', 'g')
    )
    || '_'
    || replace(roles.id::text, '-', ''),
  role_name = 'Retired ' || roles.role_name,
  description = 'Retired standard role. Reassign staff to Admin, Sales, Backend, or Accounts.',
  is_system_role = false,
  updated_at = now()
where roles.role_key in (
  'operations_team',
  'finance_team',
  'survey_staff',
  'inventory_staff'
)
or (
  roles.role_key is null
  and lower(btrim(roles.role_name)) in (
    'survey',
    'survey staff',
    'site survey',
    'site survey staff',
    'inventory staff',
    'sales staff',
    'accountant'
  )
);

delete from public.role_permissions
using public.roles
where role_permissions.role_id = roles.id
  and (
    roles.role_key like 'retired_operations_team_%'
    or roles.role_key like 'retired_finance_team_%'
    or roles.role_key like 'retired_survey_staff_%'
    or roles.role_key like 'retired_inventory_staff_%'
  );

create or replace function public.seed_epc_standard_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_record record;
  target_role_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required'
      using errcode = '23502';
  end if;

  for role_record in
    select *
    from (
      values
        ('admin', 'Admin', 'Full workspace administration with all controls.', 10),
        ('sales_team', 'Sales', 'Leads, customers, sales, projects, and quotation access without product pricing.', 20),
        ('backend_team', 'Backend', 'Operational access across CRM, projects, quotations, products, categories, inventory, purchases, payments, and invoices without delete or pricing access.', 30),
        ('accounts', 'Accounts', 'Invoice, quotation, payment, and purchase access for accounts teams.', 40)
    ) as standard_roles(role_key, role_name, description, sort_order)
    order by standard_roles.sort_order
  loop
    insert into public.roles (
      organization_id,
      role_key,
      role_name,
      description,
      is_system_role
    )
    values (
      target_organization_id,
      role_record.role_key,
      role_record.role_name,
      role_record.description,
      true
    )
    on conflict (organization_id, role_key) where role_key is not null do update
    set
      role_name = excluded.role_name,
      description = excluded.description,
      is_system_role = true,
      updated_at = now()
    returning id into target_role_id;

    delete from public.role_permissions
    where role_permissions.role_id = target_role_id;

    if role_record.role_key = 'admin' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'sales_team' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('leads', 'view'), ('leads', 'create'), ('leads', 'update'),
          ('customers', 'view'), ('customers', 'create'), ('customers', 'update'),
          ('b2b_sales', 'view'), ('b2b_sales', 'create'), ('b2b_sales', 'update'),
          ('projects', 'view'), ('projects', 'create'), ('projects', 'update'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'backend_team' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('leads', 'view'), ('leads', 'create'), ('leads', 'update'),
          ('customers', 'view'), ('customers', 'create'), ('customers', 'update'),
          ('projects', 'view'), ('projects', 'create'), ('projects', 'update'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update'),
          ('product_master', 'view'), ('product_master', 'create'), ('product_master', 'update'),
          ('inventory', 'view'), ('inventory', 'create'), ('inventory', 'update'),
          ('vendors', 'view'), ('vendors', 'create'), ('vendors', 'update'),
          ('payments', 'view'), ('payments', 'create'), ('payments', 'update'),
          ('invoices', 'view'), ('invoices', 'create'), ('invoices', 'update'),
          ('documents', 'view'), ('documents', 'create'), ('documents', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'accounts' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update'),
          ('invoices', 'view'), ('invoices', 'create'), ('invoices', 'update'),
          ('payments', 'view'), ('payments', 'create'), ('payments', 'update'),
          ('inventory', 'view'), ('inventory', 'create'), ('inventory', 'update'),
          ('product_pricing', 'view'), ('product_pricing', 'create'), ('product_pricing', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    end if;
  end loop;
end;
$$;

select public.seed_epc_standard_roles(organizations.id)
from public.organizations
where organizations.id is not null;

create or replace function public.settings_critical_permission_ids()
returns table(permission_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select permissions.id
  from public.permissions
  join public.modules on modules.id = permissions.module_id
  where modules.module_key in ('settings', 'staff')
    and permissions.action_key in ('view', 'create', 'update');
$$;

create or replace function public.apply_role_permissions(
  target_role_id uuid,
  selected_permission_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  target_role public.roles%rowtype;
  next_permission_ids uuid[];
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_role
  from public.roles
  where roles.id = target_role_id
  for update;

  if not found then
    raise exception 'Role not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_role.organization_id <> current_organization_id then
    raise exception 'Cannot update permissions for a role in another organization'
      using errcode = '42501';
  end if;

  if coalesce(target_role.is_system_role, false) and not public.is_super_admin() then
    raise exception 'System role permissions are locked'
      using errcode = '42501';
  end if;

  next_permission_ids := coalesce(selected_permission_ids, array[]::uuid[]);

  delete from public.role_permissions
  where role_permissions.role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, permissions.id
  from public.permissions
  where permissions.id = any(next_permission_ids)
  on conflict (role_id, permission_id) do nothing;
end;
$$;

drop function if exists public.get_settings_roles();

create or replace function public.get_settings_roles()
returns table(
  id uuid,
  organization_id uuid,
  role_key text,
  role_name text,
  description text,
  is_system_role boolean,
  permission_count bigint,
  permission_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
begin
  current_organization_id := public.require_settings_update();

  if current_organization_id is not null then
    perform public.seed_epc_standard_roles(current_organization_id);
  end if;

  return query
  select
    roles.id,
    roles.organization_id,
    roles.role_key,
    roles.role_name,
    roles.description,
    coalesce(roles.is_system_role, false) as is_system_role,
    count(role_permissions.permission_id) as permission_count,
    coalesce(
      array_agg(role_permissions.permission_id order by role_permissions.permission_id)
        filter (where role_permissions.permission_id is not null),
      array[]::uuid[]
    ) as permission_ids
  from public.roles
  left join public.role_permissions on role_permissions.role_id = roles.id
  where (
    current_organization_id is null
    or roles.organization_id = current_organization_id
  )
    and (
      public.is_super_admin()
      or (
        coalesce(roles.is_system_role, false)
        and roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
      )
    )
  group by roles.id
  order by coalesce(roles.is_system_role, false) desc, roles.role_key nulls last, roles.role_name;
end;
$$;

create or replace function public.create_settings_staff(
  full_name text,
  phone text,
  email text,
  role_id uuid,
  status text default 'invited'
)
returns public.users_profile
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  normalized_status text := coalesce(nullif(trim(status), ''), 'invited');
  created_profile public.users_profile%rowtype;
begin
  current_organization_id := public.require_settings_update();

  if current_organization_id is null then
    raise exception 'organization_id is required to create staff'
      using errcode = '23502';
  end if;

  perform public.seed_epc_standard_roles(current_organization_id);

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status'
      using errcode = '22023';
  end if;

  if role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = role_id
      and roles.organization_id = current_organization_id
      and coalesce(roles.is_system_role, false)
      and roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  ) then
    raise exception 'Role must be a standard role in the current organization'
      using errcode = '42501';
  end if;

  insert into public.users_profile (
    organization_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at
  )
  values (
    current_organization_id,
    nullif(trim(full_name), ''),
    nullif(trim(phone), ''),
    nullif(lower(trim(email)), ''),
    normalized_status,
    false,
    now()
  )
  returning * into created_profile;

  if role_id is not null then
    insert into public.user_roles (user_profile_id, role_id)
    values (created_profile.id, role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  return created_profile;
end;
$$;

create or replace function public.update_settings_staff(
  target_profile_id uuid,
  full_name text,
  phone text,
  email text,
  role_id uuid,
  status text
)
returns public.users_profile
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  target_profile public.users_profile%rowtype;
  normalized_status text := coalesce(nullif(trim(status), ''), 'invited');
begin
  current_organization_id := public.require_settings_update();

  select *
  into target_profile
  from public.users_profile
  where users_profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'Staff profile not found'
      using errcode = 'P0002';
  end if;

  if current_organization_id is not null
    and target_profile.organization_id <> current_organization_id then
    raise exception 'Cannot update staff for another organization'
      using errcode = '42501';
  end if;

  if target_profile.auth_user_id = auth.uid()
    and normalized_status <> 'active' then
    raise exception 'You cannot deactivate your own account'
      using errcode = '42501';
  end if;

  if normalized_status not in ('invited', 'active', 'inactive') then
    raise exception 'Invalid staff status'
      using errcode = '22023';
  end if;

  if target_profile.organization_id is not null then
    perform public.seed_epc_standard_roles(target_profile.organization_id);
  end if;

  if role_id is not null and not exists (
    select 1
    from public.roles
    where roles.id = role_id
      and roles.organization_id = target_profile.organization_id
      and coalesce(roles.is_system_role, false)
      and roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  ) then
    raise exception 'Role must be a standard role in the staff organization'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    full_name = nullif(trim(update_settings_staff.full_name), ''),
    phone = nullif(trim(update_settings_staff.phone), ''),
    email = nullif(lower(trim(update_settings_staff.email)), ''),
    status = normalized_status,
    is_super_admin = target_profile.is_super_admin,
    updated_at = now()
  where users_profile.id = target_profile_id
  returning * into target_profile;

  delete from public.user_roles
  where user_roles.user_profile_id = target_profile_id
     or user_roles.user_id = target_profile.auth_user_id;

  if role_id is not null then
    insert into public.user_roles (user_profile_id, user_id, role_id)
    values (target_profile_id, target_profile.auth_user_id, role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;

  return target_profile;
end;
$$;

create or replace function public.create_settings_role(
  role_name text,
  description text,
  permission_ids uuid[] default array[]::uuid[]
)
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Standard roles are locked for EPC admins'
      using errcode = '42501';
  end if;

  raise exception 'Create roles through seed_epc_standard_roles instead'
    using errcode = '42501';
end;
$$;

create or replace function public.update_settings_role(
  target_role_id uuid,
  role_name text,
  description text,
  permission_ids uuid[] default array[]::uuid[]
)
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Standard roles are locked for EPC admins'
      using errcode = '42501';
  end if;

  raise exception 'Update standard role definitions through seed_epc_standard_roles instead'
    using errcode = '42501';
end;
$$;

create or replace function public.delete_settings_role(target_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Standard roles are locked for EPC admins'
      using errcode = '42501';
  end if;

  raise exception 'Standard roles cannot be deleted'
    using errcode = '42501';
end;
$$;

create or replace function public.product_category_public_rows()
returns table(category_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('product_master', 'view')
      or public.user_has_permission('quotations', 'view')
      or public.user_has_permission('inventory', 'view')
    ) then
    raise exception 'Missing product catalog view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', product_categories.id,
    'tenant_id', product_categories.tenant_id,
    'name', product_categories.name,
    'description', product_categories.description,
    'category_type', product_categories.category_type,
    'display_order', product_categories.display_order,
    'is_active', product_categories.is_active,
    'created_at', product_categories.created_at,
    'updated_at', product_categories.updated_at
  )
  from public.product_categories
  where public.is_super_admin()
     or product_categories.tenant_id = target_organization_id
  order by product_categories.display_order, product_categories.name;
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
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('product_master', 'view')
      or public.user_has_permission('quotations', 'view')
      or public.user_has_permission('inventory', 'view')
    ) then
    raise exception 'Missing product catalog view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', products.id,
    'tenant_id', products.tenant_id,
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
    'purchase_price', null,
    'selling_price', null,
    'minimum_stock_alert', null,
    'created_at', products.created_at,
    'updated_at', products.updated_at,
    'category', case
      when product_categories.id is null then null
      else jsonb_build_object(
        'id', product_categories.id,
        'name', product_categories.name,
        'category_type', product_categories.category_type,
        'display_order', product_categories.display_order
      )
    end
  )
  from public.products
  left join public.product_categories on product_categories.id = products.category_id
  where public.is_super_admin()
     or products.tenant_id = target_organization_id
  order by products.product_name;
end;
$$;

create or replace function public.inventory_item_public_rows(target_item_id uuid default null)
returns table(item_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('inventory', 'view')
      or public.user_has_permission('quotations', 'view')
    ) then
    raise exception 'Missing inventory item view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', inventory_items.id,
    'organization_id', inventory_items.organization_id,
    'catalog_product_id', inventory_items.catalog_product_id,
    'product_id', inventory_items.product_id,
    'brand_id', inventory_items.brand_id,
    'model_id', inventory_items.model_id,
    'vendor_id', inventory_items.vendor_id,
    'item_code', inventory_items.item_code,
    'item_name', inventory_items.item_name,
    'item_category', inventory_items.item_category,
    'brand', inventory_items.brand,
    'model', inventory_items.model,
    'unit', inventory_items.unit,
    'current_stock', inventory_items.current_stock,
    'opening_stock', inventory_items.opening_stock,
    'minimum_stock', inventory_items.minimum_stock,
    'purchase_price', null,
    'selling_price', null,
    'gst_percent', inventory_items.gst_percent,
    'status', inventory_items.status,
    'bill_no', inventory_items.bill_no,
    'inventory_date', inventory_items.inventory_date,
    'notes', inventory_items.notes,
    'created_at', inventory_items.created_at,
    'updated_at', inventory_items.updated_at,
    'vendor_master', case
      when vendors_master.id is null then null
      else jsonb_build_object('id', vendors_master.id, 'name', vendors_master.name)
    end,
    'catalog_product', case
      when products.id is null then null
      else jsonb_build_object(
        'id', products.id,
        'tenant_id', products.tenant_id,
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
        'status', products.status,
        'category', case
          when product_categories.id is null then null
          else jsonb_build_object(
            'id', product_categories.id,
            'name', product_categories.name,
            'category_type', product_categories.category_type,
            'display_order', product_categories.display_order
          )
        end
      )
    end
  )
  from public.inventory_items
  left join public.vendors_master on vendors_master.id = inventory_items.vendor_id
  left join public.products on products.id = inventory_items.catalog_product_id
  left join public.product_categories on product_categories.id = products.category_id
  where inventory_items.catalog_product_id is not null
    and (target_item_id is null or inventory_items.id = target_item_id)
    and (
      public.is_super_admin()
      or inventory_items.organization_id = target_organization_id
    )
  order by inventory_items.item_name;
end;
$$;

create or replace function public.create_organization_with_admin(
  organization_name text,
  organization_slug text,
  admin_full_name text,
  admin_phone text,
  admin_email text default null,
  admin_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
  normalized_slug text;
  normalized_admin_email text;
  normalized_admin_phone text;
  admin_profile_status text := 'pending_auth_invite';
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can create organizations'
      using errcode = '42501';
  end if;

  normalized_slug := lower(trim(organization_slug));
  normalized_admin_email := nullif(lower(trim(admin_email)), '');
  normalized_admin_phone := nullif(trim(admin_phone), '');

  if normalized_admin_email is null then
    raise exception 'Primary admin email is required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = normalized_admin_email
  ) then
    raise exception 'A user profile already exists for this admin email'
      using errcode = '23505';
  end if;

  if normalized_admin_phone is not null and exists (
    select 1
    from public.users_profile
    where users_profile.phone = normalized_admin_phone
  ) then
    raise exception 'A user profile already exists for this admin phone'
      using errcode = '23505';
  end if;

  insert into public.organizations (name, slug, subdomain, status)
  values (organization_name, normalized_slug, normalized_slug, 'active')
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, normalized_admin_email, normalized_admin_phone)
  on conflict (organization_id) do nothing;

  perform public.seed_epc_standard_roles(new_organization_id);

  select roles.id
  into admin_role_id
  from public.roles
  where roles.organization_id = new_organization_id
    and roles.role_key = 'admin'
  limit 1;

  if admin_role_id is null then
    raise exception 'Admin role could not be created'
      using errcode = 'P0002';
  end if;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at,
    phone_verified,
    email_verified
  )
  values (
    admin_auth_user_id,
    new_organization_id,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'invited',
    false,
    now(),
    false,
    false
  )
  on conflict (phone) where phone is not null do update
  set
    auth_user_id = coalesce(public.users_profile.auth_user_id, excluded.auth_user_id),
    organization_id = excluded.organization_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = 'invited',
    is_super_admin = false,
    updated_at = now()
  returning id into admin_profile_id;

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, null, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  if admin_auth_user_id is not null then
    admin_profile_status := 'invite_sent_pending_password';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$$;

revoke select on public.products from authenticated;
grant select (
  id,
  tenant_id,
  product_code,
  product_name,
  category_id,
  category_type,
  hsn_code,
  brand,
  model_number,
  specifications,
  unit,
  gst_percent,
  warranty_description,
  minimum_stock_alert,
  status,
  notes,
  created_at,
  updated_at
) on public.products to authenticated;

revoke select on public.inventory_items from authenticated;
grant select (
  id,
  organization_id,
  catalog_product_id,
  product_id,
  brand_id,
  model_id,
  vendor_id,
  item_code,
  item_name,
  item_category,
  brand,
  model,
  unit,
  current_stock,
  opening_stock,
  minimum_stock,
  gst_percent,
  status,
  bill_no,
  inventory_date,
  notes,
  created_at,
  updated_at
) on public.inventory_items to authenticated;

grant execute on function public.seed_epc_standard_roles(uuid) to authenticated;
grant execute on function public.get_settings_roles() to authenticated;
grant execute on function public.apply_role_permissions(uuid, uuid[]) to authenticated;
grant execute on function public.create_settings_staff(text, text, text, uuid, text) to authenticated;
grant execute on function public.update_settings_staff(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.create_settings_role(text, text, uuid[]) to authenticated;
grant execute on function public.update_settings_role(uuid, text, text, uuid[]) to authenticated;
grant execute on function public.delete_settings_role(uuid) to authenticated;
grant execute on function public.product_category_public_rows() to authenticated;
grant execute on function public.product_catalog_public_rows() to authenticated;
grant execute on function public.inventory_item_public_rows(uuid) to authenticated;
grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
