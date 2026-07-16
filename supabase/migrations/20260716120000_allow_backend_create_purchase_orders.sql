-- Allow the locked Backend role to create purchase orders.
-- Purchase-order creation is protected by both inventory and product-pricing
-- permissions in the UI and RLS policies, so Backend needs pricing view/create
-- in addition to its existing inventory permissions.

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
        ('backend_team', 'Backend', 'Operational access across CRM, projects, quotations, products, categories, inventory, purchases, payments, and invoices without delete access.', 30),
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
          ('product_pricing', 'view'), ('product_pricing', 'create'),
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

-- Backfill existing tenant Backend roles without resetting any unrelated
-- permissions that may already be assigned to those roles.
update public.roles
set
  description = 'Operational access across CRM, projects, quotations, products, categories, inventory, purchases, payments, and invoices without delete access.',
  updated_at = now()
where roles.role_key = 'backend_team'
  and coalesce(roles.is_system_role, false);

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where roles.role_key = 'backend_team'
  and coalesce(roles.is_system_role, false)
  and modules.module_key = 'product_pricing'
  and permissions.action_key in ('view', 'create')
on conflict (role_id, permission_id) do nothing;

grant execute on function public.seed_epc_standard_roles(uuid) to authenticated;
