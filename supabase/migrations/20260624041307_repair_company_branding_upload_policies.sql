-- Repair live company logo uploads for EPC admins.
--
-- The app authenticates tenant users through users_profile. These helper
-- definitions keep storage policies aligned with that profile model before the
-- company-branding bucket policies evaluate tenant and settings permissions.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
        and users_profile.is_super_admin = true
        and users_profile.status = 'active'
    );
$$;

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users_profile.organization_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.status = 'active'
  limit 1;
$$;

create or replace function public.user_has_permission(module text, action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.users_profile
      join public.user_roles on (
        user_roles.user_profile_id = users_profile.id
        or user_roles.user_id = users_profile.auth_user_id
      )
      join public.roles on roles.id = user_roles.role_id
      join public.role_permissions on role_permissions.role_id = roles.id
      join public.permissions on permissions.id = role_permissions.permission_id
      join public.modules on modules.id = permissions.module_id
      where users_profile.auth_user_id = auth.uid()
        and users_profile.status = 'active'
        and roles.organization_id = users_profile.organization_id
        and modules.module_key = $1
        and permissions.action_key = $2
        and modules.is_active = true
    );
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.user_has_permission(text, text) to authenticated;

-- Cropped logos are normalized to PNG by the frontend. The public bucket is
-- intentional because logos are used on branded documents and portals.
insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values ('company-branding', 'company-branding', true, 1048576, array['image/png'])
on conflict (id) do update
set
  "public" = excluded."public",
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organization users can read company branding" on storage.objects;
drop policy if exists "Organization admins can upload company branding" on storage.objects;
drop policy if exists "Organization admins can update company branding" on storage.objects;
drop policy if exists "Organization admins can delete company branding" on storage.objects;

create policy "Organization users can read company branding"
on storage.objects for select to authenticated
using (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
);

create policy "Organization admins can upload company branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and public.user_has_permission('settings', 'update')
    )
  )
);

create policy "Organization admins can update company branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and public.user_has_permission('settings', 'update')
    )
  )
)
with check (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and public.user_has_permission('settings', 'update')
    )
  )
);

create policy "Organization admins can delete company branding"
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-branding'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and public.user_has_permission('settings', 'update')
    )
  )
);

notify pgrst, 'reload schema';
