-- Dashboard onboarding only needs to know whether another active or invited
-- team member exists. Keep the lookup tenant-scoped and expose no staff data.
create or replace function public.get_current_company_team_member_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.users_profile as member
  where auth.uid() is not null
    and member.company_id = public.get_current_user_company_id()
    and member.status in ('active', 'invited')
    and member.auth_user_id is distinct from auth.uid();
$$;

revoke execute on function public.get_current_company_team_member_count()
  from public, anon;
grant execute on function public.get_current_company_team_member_count()
  to authenticated;

notify pgrst, 'reload schema';
