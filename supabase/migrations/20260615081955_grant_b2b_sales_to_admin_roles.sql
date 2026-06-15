-- Repair B2B Sales access for tenant admin roles that existed before or missed
-- the original B2B module permission seed.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'b2b_sales',
  'B2B Sales',
  'Project-free product sales to installer customers',
  365,
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
where modules.module_key = 'b2b_sales'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where modules.module_key = 'b2b_sales'
  and (
    coalesce(roles.is_system_role, false) = true
    or lower(btrim(roles.role_name)) in ('admin', 'administrator')
  )
on conflict (role_id, permission_id) do nothing;
