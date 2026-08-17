-- Tenant-safe company state access for the authenticated onboarding setup owner.
--
-- The legacy companies RLS policies intentionally require companies:view/edit,
-- permissions which the standard EPC roles do not use. Onboarding still needs
-- to prefill and persist the existing company's state without granting broad
-- access to the companies table, so these narrowly scoped RPCs perform the
-- operation only for the active setup owner of the caller's own company.

create or replace function public.get_current_onboarding_company_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company_state text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read onboarding company state'
      using errcode = '42501';
  end if;

  select company.state
  into company_state
  from public.companies as company
  join public.company_onboarding_progress as progress
    on progress.company_id = company.id
  join public.users_profile as profile
    on profile.id = progress.setup_owner_profile_id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.company_id = company.id
    and progress.status in ('pending', 'in_progress', 'deferred')
  limit 1;

  if not found then
    raise exception 'Only the active setup owner can read onboarding company state'
      using errcode = '42501';
  end if;

  return coalesce(company_state, '');
end;
$$;

create or replace function public.update_current_onboarding_company_state(new_state text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_state text := nullif(btrim(new_state), '');
  updated_state text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update onboarding company state'
      using errcode = '42501';
  end if;

  update public.companies as company
  set state = normalized_state
  from public.company_onboarding_progress as progress,
    public.users_profile as profile
  where progress.company_id = company.id
    and profile.id = progress.setup_owner_profile_id
    and profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and profile.company_id = company.id
    and progress.status in ('pending', 'in_progress', 'deferred')
  returning coalesce(company.state, '') into updated_state;

  if not found then
    raise exception 'Only the active setup owner can update onboarding company state'
      using errcode = '42501';
  end if;

  return updated_state;
end;
$$;

revoke all on function public.get_current_onboarding_company_state()
from public, anon, authenticated;
revoke all on function public.update_current_onboarding_company_state(text)
from public, anon, authenticated;

grant execute on function public.get_current_onboarding_company_state()
to authenticated;
grant execute on function public.update_current_onboarding_company_state(text)
to authenticated;

notify pgrst, 'reload schema';
