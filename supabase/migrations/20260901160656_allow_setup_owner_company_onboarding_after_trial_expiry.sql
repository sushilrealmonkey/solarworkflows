-- An expired subscription blocks ordinary settings mutations. The initial
-- company-setup step must still be completable by the tenant's one captured
-- setup owner, so expose a separate, deliberately narrow RPC for that flow.

create or replace function private.is_current_company_onboarding_setup_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_onboarding_progress as progress
    join public.users_profile as profile
      on profile.id = progress.setup_owner_profile_id
     and profile.organization_id = progress.organization_id
     and profile.company_id = progress.company_id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'active'
      and progress.status = 'in_progress'
      and progress.current_step = 'company'
  );
$$;

revoke all on function private.is_current_company_onboarding_setup_owner()
  from public, anon, authenticated;
grant execute on function private.is_current_company_onboarding_setup_owner()
  to authenticated;

create or replace function public.update_current_onboarding_company_settings(
  settings jsonb
)
returns public.organization_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming_settings jsonb := coalesce(settings, '{}'::jsonb);
  current_organization_id uuid;
  updated_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update onboarding company details'
      using errcode = '42501';
  end if;

  if jsonb_typeof(incoming_settings) <> 'object' then
    raise exception 'settings must be a JSON object'
      using errcode = '22023';
  end if;

  if incoming_settings - array[
    'company_name',
    'company_logo_url',
    'address',
    'contact_email',
    'contact_phone',
    'gst_number'
  ] <> '{}'::jsonb then
    raise exception 'Only company setup fields can be updated during onboarding'
      using errcode = '42501';
  end if;

  select progress.organization_id
  into current_organization_id
  from public.company_onboarding_progress as progress
  join public.users_profile as profile
    on profile.id = progress.setup_owner_profile_id
   and profile.organization_id = progress.organization_id
   and profile.company_id = progress.company_id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'active'
    and progress.status = 'in_progress'
    and progress.current_step = 'company'
  for update of progress;

  if current_organization_id is null then
    raise exception 'Only the active setup owner can update onboarding company details'
      using errcode = '42501';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  update public.organization_settings as organization_settings
  set
    company_name = case
      when incoming_settings ? 'company_name'
        then incoming_settings ->> 'company_name'
      else organization_settings.company_name
    end,
    company_logo_url = case
      when incoming_settings ? 'company_logo_url'
        then incoming_settings ->> 'company_logo_url'
      else organization_settings.company_logo_url
    end,
    address = case
      when incoming_settings ? 'address'
        then incoming_settings ->> 'address'
      else organization_settings.address
    end,
    contact_email = case
      when incoming_settings ? 'contact_email'
        then incoming_settings ->> 'contact_email'
      else organization_settings.contact_email
    end,
    contact_phone = case
      when incoming_settings ? 'contact_phone'
        then incoming_settings ->> 'contact_phone'
      else organization_settings.contact_phone
    end,
    gst_number = case
      when incoming_settings ? 'gst_number'
        then incoming_settings ->> 'gst_number'
      else organization_settings.gst_number
    end
  where organization_settings.organization_id = current_organization_id
  returning * into updated_settings;

  return updated_settings;
end;
$$;

revoke all on function public.update_current_onboarding_company_settings(jsonb)
  from public, anon;
grant execute on function public.update_current_onboarding_company_settings(jsonb)
  to authenticated;

-- The onboarding UI stores a cropped logo before saving the settings record.
-- Its object key is still constrained to the setup owner's organization.
drop policy if exists "Organization admins can upload company branding" on storage.objects;

create policy "Organization admins can upload company branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and (
        public.user_has_permission('settings', 'update')
        or private.is_current_company_onboarding_setup_owner()
      )
    )
  )
);

notify pgrst, 'reload schema';
