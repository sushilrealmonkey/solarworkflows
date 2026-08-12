-- Bizlee AI role-permission catalogue checks.

do $$
begin
  if not exists (
    select 1
    from public.modules
    join public.permissions on permissions.module_id = modules.id
    where modules.module_key = 'assistant'
      and modules.is_active
      and permissions.action_key = 'view'
  ) then
    raise exception 'Bizlee AI view permission is missing';
  end if;

  if exists (
    select 1
    from public.roles
    where roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
      and not exists (
        select 1
        from public.role_permissions
        join public.permissions on permissions.id = role_permissions.permission_id
        join public.modules on modules.id = permissions.module_id
        where role_permissions.role_id = roles.id
          and modules.module_key = 'assistant'
          and permissions.action_key = 'view'
      )
  ) then
    raise exception 'An eligible standard role is missing Bizlee AI view access';
  end if;

  if exists (
    select 1
    from public.roles
    join public.role_permissions on role_permissions.role_id = roles.id
    join public.permissions on permissions.id = role_permissions.permission_id
    join public.modules on modules.id = permissions.module_id
    where roles.role_key = 'field_staff'
      and modules.module_key = 'assistant'
  ) then
    raise exception 'Field Staff must not receive Bizlee AI access';
  end if;

  if exists (
    select 1
    from public.roles
    left join public.role_module_scopes
      on role_module_scopes.role_id = roles.id
     and role_module_scopes.module_key = 'assistant'
    where roles.role_key in ('admin', 'sales_team', 'backend_team', 'accounts')
      and role_module_scopes.scope_key is distinct from case roles.role_key
        when 'admin' then 'company'
        when 'sales_team' then 'assigned_or_unassigned_created'
        when 'backend_team' then 'related_operations'
        when 'accounts' then 'related_finance'
      end
  ) then
    raise exception 'A Bizlee AI role scope is missing or incorrect';
  end if;
end;
$$;
