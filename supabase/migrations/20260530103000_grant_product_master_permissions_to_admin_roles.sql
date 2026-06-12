-- Ensures existing tenant Admin roles can open Product Master after the module
-- is introduced. This is intentionally additive and does not touch Inventory or
-- downstream business tables.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'product_master',
  'Product Master',
  'Central product catalog used by inventory, purchases, quotations, projects, and reports',
  385,
  true
)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.permissions (module_id, action_key, action_name)
select
  modules.id,
  actions.action_key,
  actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('update', 'Update'),
    ('delete', 'Delete')
) as actions(action_key, action_name)
where modules.module_key = 'product_master'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where modules.module_key = 'product_master'
  and (
    coalesce(roles.is_system_role, false) = true
    or lower(btrim(roles.role_name)) = 'admin'
  )
on conflict (role_id, permission_id) do nothing;

notify pgrst, 'reload schema';
