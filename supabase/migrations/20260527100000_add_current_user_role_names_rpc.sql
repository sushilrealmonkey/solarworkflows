-- Exposes the current user's assigned role names without requiring direct
-- user_roles select visibility. Permissions still remain enforced separately.

create or replace function public.get_current_user_role_names()
returns table(role_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct roles.role_name
  from public.users_profile
  join public.user_roles on (
    user_roles.user_profile_id = users_profile.id
    or user_roles.user_id = users_profile.auth_user_id
  )
  join public.roles on roles.id = user_roles.role_id
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
    and roles.organization_id = users_profile.organization_id
    and roles.role_name is not null
  order by roles.role_name;
$$;

grant execute on function public.get_current_user_role_names() to authenticated;
