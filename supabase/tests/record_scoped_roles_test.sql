begin;

do $$
begin
  if exists (
    select 1 from public.organizations o
    where not exists (
      select 1 from public.roles r
      where r.organization_id = o.id and r.role_key = 'field_staff'
        and r.is_system_role
    )
  ) then
    raise exception 'Every tenant must have a locked Field Staff role';
  end if;

  if exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where r.role_key in ('sales_team','backend_team','accounts','field_staff')
      and p.action_key = 'delete'
  ) then
    raise exception 'Non-admin standard roles must not have permanent delete';
  end if;

  if exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    join public.modules m on m.id = p.module_id
    where r.role_key = 'field_staff'
      and m.module_key in ('projects','site_surveys')
      and p.action_key = 'update'
  ) then
    raise exception 'Field Staff must not have generic project or survey update';
  end if;

  if not exists (
    select 1 from public.roles r
    join public.role_module_scopes s on s.role_id = r.id
    where r.role_key = 'field_staff'
      and s.module_key = 'projects' and s.scope_key = 'assigned_field'
  ) then
    raise exception 'Field Staff projects must use assigned_field scope';
  end if;

  if not has_function_privilege('authenticated', 'public.get_field_projects(uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.get_field_site_surveys(uuid)', 'execute') then
    raise exception 'Field safe projection RPCs must be explicitly exposed';
  end if;

  if has_table_privilege('anon', 'public.project_staff_assignments', 'select')
    or has_table_privilege('authenticated', 'public.project_staff_assignments', 'insert')
    or has_table_privilege('authenticated', 'public.project_staff_assignments', 'update') then
    raise exception 'Installation assignments must be read-only through the Data API';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.project_staff_assignments'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.role_module_scopes'::regclass) then
    raise exception 'New authorization tables must have RLS enabled';
  end if;

  if has_function_privilege('anon', 'public.seed_epc_standard_roles(uuid)', 'execute')
    or has_function_privilege('anon', 'public.user_has_permission(text,text)', 'execute')
    or has_function_privilege('anon', 'public.get_settings_roles()', 'execute')
    or has_function_privilege('anon', 'public.create_settings_staff(text,text,text,uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.update_settings_staff(uuid,text,text,text,uuid,text)', 'execute') then
    raise exception 'Anonymous users must not execute role or staff management functions';
  end if;
end;
$$;

rollback;
