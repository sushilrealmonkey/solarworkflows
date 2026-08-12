-- Bizlee AI has its own subscription entitlement and route guard. Register it
-- in the role-permission catalogue so eligible tenant roles can pass that
-- guard, while Field Staff remains excluded from the assistant.

insert into public.modules (
  module_key,
  module_name,
  description,
  sort_order,
  is_active
)
values (
  'assistant',
  'Bizlee AI',
  'AI daily brief and assistant chat access',
  305,
  true
)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.permissions (module_id, action_key, action_name)
select modules.id, 'view', 'View'
from public.modules
where modules.module_key = 'assistant'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
cross join public.permissions
join public.modules on modules.id = permissions.module_id
where roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  and modules.module_key = 'assistant'
  and permissions.action_key = 'view'
on conflict (role_id, permission_id) do nothing;

insert into public.role_module_scopes (
  company_id,
  organization_id,
  role_id,
  module_key,
  scope_key
)
select
  roles.company_id,
  roles.organization_id,
  roles.id,
  'assistant',
  case roles.role_key
    when 'admin' then 'company'
    when 'sales_team' then 'assigned_or_unassigned_created'
    when 'backend_team' then 'related_operations'
    when 'accounts' then 'related_finance'
  end
from public.roles
where roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
  and roles.company_id is not null
  and roles.organization_id is not null
on conflict (role_id, module_key) do update
set
  company_id = excluded.company_id,
  organization_id = excluded.organization_id,
  scope_key = excluded.scope_key,
  updated_at = now();

notify pgrst, 'reload schema';
