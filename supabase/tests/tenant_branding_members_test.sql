-- Active members without Settings access must receive the same safe tenant
-- display name and logo as another active member of their organization.
do $$
declare
  staff_user_id uuid;
  companion_user_id uuid;
  tenant_id uuid;
  staff_branding jsonb;
  companion_branding jsonb;
begin
  if not has_function_privilege(
    'authenticated',
    'public.get_current_organization_branding()'::regprocedure,
    'execute'
  ) then
    raise exception 'authenticated must execute get_current_organization_branding';
  end if;

  if has_function_privilege(
    'anon',
    'public.get_current_organization_branding()'::regprocedure,
    'execute'
  ) then
    raise exception 'anon must not execute get_current_organization_branding';
  end if;

  select
    users_profile.auth_user_id,
    users_profile.organization_id
  into
    staff_user_id,
    tenant_id
  from public.users_profile
  join public.organization_settings
    on organization_settings.organization_id = users_profile.organization_id
  where users_profile.auth_user_id is not null
    and users_profile.status = 'active'
    and nullif(btrim(organization_settings.company_logo_url), '') is not null
    and not exists (
      select 1
      from public.user_roles
      join public.roles on roles.id = user_roles.role_id
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where (
          user_roles.user_profile_id = users_profile.id
          or user_roles.user_id = users_profile.auth_user_id
        )
        and roles.organization_id = users_profile.organization_id
        and modules.module_key = 'settings'
        and permissions.action_key in ('view', 'update')
    )
  order by users_profile.created_at desc
  limit 1;

  if staff_user_id is null then
    raise notice 'Skipping member comparison: no active branded tenant member without Settings access is available';
    return;
  end if;

  select users_profile.auth_user_id
  into companion_user_id
  from public.users_profile
  where users_profile.organization_id = tenant_id
    and users_profile.auth_user_id is not null
    and users_profile.auth_user_id <> staff_user_id
    and users_profile.status = 'active'
  order by users_profile.created_at
  limit 1;

  if companion_user_id is null then
    raise notice 'Skipping member comparison: branded tenant has no second active member';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', staff_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', staff_user_id, 'role', 'authenticated')::text,
    true
  );
  staff_branding := public.get_current_organization_branding();

  perform set_config('request.jwt.claim.sub', companion_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', companion_user_id, 'role', 'authenticated')::text,
    true
  );
  companion_branding := public.get_current_organization_branding();

  if staff_branding ->> 'organization_id' <> tenant_id::text
    or companion_branding ->> 'organization_id' <> tenant_id::text then
    raise exception 'tenant branding returned the wrong organization';
  end if;

  if nullif(btrim(staff_branding ->> 'company_name'), '') is null
    or nullif(btrim(staff_branding ->> 'company_logo_url'), '') is null then
    raise exception 'staff branding is missing the tenant display name or logo';
  end if;

  if staff_branding is distinct from companion_branding then
    raise exception 'active tenant members received inconsistent branding';
  end if;
end;
$$;
