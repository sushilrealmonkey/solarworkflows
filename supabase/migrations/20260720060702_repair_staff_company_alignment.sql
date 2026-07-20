-- Staff profiles created by create_settings_staff() carried organization_id
-- but not company_id. Organization-scoped permissions still worked, while RPCs
-- that also validate company access rejected those users. Keep both profile
-- models aligned with the canonical company owned by the organization.

create or replace function private.enforce_profile_company_alignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_company_id uuid;
begin
  if new.organization_id is null then
    return new;
  end if;

  select organizations.company_id
  into canonical_company_id
  from public.organizations
  where organizations.id = new.organization_id;

  if canonical_company_id is null then
    raise exception 'Profile organization must have a company mapping'
      using errcode = '23503';
  end if;

  if new.company_id is not null
    and new.company_id is distinct from canonical_company_id then
    raise exception 'Profile company_id must match its organization'
      using errcode = '23503';
  end if;

  new.company_id := canonical_company_id;
  return new;
end;
$$;

revoke all on function private.enforce_profile_company_alignment() from public;

drop trigger if exists enforce_users_profile_company_alignment
on public.users_profile;

create trigger enforce_users_profile_company_alignment
before insert or update of organization_id, company_id
on public.users_profile
for each row
execute function private.enforce_profile_company_alignment();

drop trigger if exists enforce_legacy_profile_company_alignment
on public.profiles;

create trigger enforce_legacy_profile_company_alignment
before insert or update of organization_id, company_id
on public.profiles
for each row
execute function private.enforce_profile_company_alignment();

update public.users_profile
set
  company_id = organizations.company_id,
  updated_at = now()
from public.organizations
where organizations.id = users_profile.organization_id
  and organizations.company_id is not null
  and users_profile.company_id is distinct from organizations.company_id;

update public.profiles
set
  company_id = organizations.company_id,
  updated_at = now()
from public.organizations
where organizations.id = profiles.organization_id
  and organizations.company_id is not null
  and profiles.company_id is distinct from organizations.company_id;

notify pgrst, 'reload schema';
