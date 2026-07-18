-- Active tenant members need the tenant logo in the application shell even
-- when their role cannot open Settings. Keep this read surface deliberately
-- narrower than get_organization_settings, which also returns operational and
-- financial configuration.
create or replace function public.get_current_organization_branding()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  branding jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read organization branding'
      using errcode = '42501';
  end if;

  select users_profile.organization_id
  into current_organization_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;

  if current_organization_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'organization_id', organization_settings.organization_id,
    'company_logo_url', nullif(btrim(organization_settings.company_logo_url), '')
  )
  into branding
  from public.organization_settings
  where organization_settings.organization_id = current_organization_id
  limit 1;

  return coalesce(
    branding,
    jsonb_build_object(
      'organization_id', current_organization_id,
      'company_logo_url', null
    )
  );
end;
$$;

revoke all on function public.get_current_organization_branding() from public;
revoke all on function public.get_current_organization_branding() from anon;
grant execute on function public.get_current_organization_branding() to authenticated;

notify pgrst, 'reload schema';
