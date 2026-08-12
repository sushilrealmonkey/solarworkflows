-- Copies a freshly confirmed Supabase Auth phone number to the caller's tenant
-- profile. This is intentionally separate from the general login sync so an
-- email-signup tenant can add or replace their own number from Settings.

create or replace function public.sync_verified_phone_to_profile()
returns public.users_profile
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_auth_user_id uuid := auth.uid();
  verified_phone text;
  updated_profile public.users_profile%rowtype;
begin
  if current_auth_user_id is null then
    raise exception 'Authentication is required to verify a phone number'
      using errcode = '42501';
  end if;

  select nullif(trim(users.phone), '')
  into verified_phone
  from auth.users
  where users.id = current_auth_user_id
    and users.phone_confirmed_at is not null;

  if verified_phone is null then
    raise exception 'The phone number has not been verified'
      using errcode = '42501';
  end if;

  update public.users_profile
  set
    phone = verified_phone,
    phone_verified = true,
    updated_at = now()
  where users_profile.auth_user_id = current_auth_user_id
    and users_profile.status = 'active'
    and coalesce(users_profile.is_super_admin, false) = false
    and users_profile.company_id is not null
  returning * into updated_profile;

  if not found then
    raise exception 'An active tenant profile is required'
      using errcode = '42501';
  end if;

  update public.profiles
  set
    phone = verified_phone,
    updated_at = now()
  where profiles.id = current_auth_user_id;

  return updated_profile;
end;
$$;

revoke all on function public.sync_verified_phone_to_profile() from public;
revoke all on function public.sync_verified_phone_to_profile() from anon;
grant execute on function public.sync_verified_phone_to_profile() to authenticated;
