-- A UPI QR code belongs to an organization, alongside its existing company
-- branding and bank details. It is embedded into newly generated quotations.
alter table public.organization_settings
  add column if not exists upi_qr_code_url text;

comment on column public.organization_settings.upi_qr_code_url is
  'Public company-branding URL for the tenant UPI payment QR code.';

-- Keep UPI QR changes narrowly scoped instead of extending the broader
-- company-profile RPC. The same settings:update permission and active
-- organization scope that protect the rest of the profile apply here.
create or replace function public.set_organization_upi_qr_code(
  target_upi_qr_code_url text
)
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  updated_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update the UPI QR code'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('settings', 'update') then
    raise exception 'Missing permission to update organization settings'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  update public.organization_settings as organization_settings
  set upi_qr_code_url = nullif(btrim(target_upi_qr_code_url), '')
  where organization_settings.organization_id = current_organization_id
  returning * into updated_settings;

  return updated_settings;
end;
$$;

revoke all on function public.set_organization_upi_qr_code(text)
  from public, anon;
grant execute on function public.set_organization_upi_qr_code(text)
  to authenticated;

-- The company-branding bucket is deliberately public because the QR code is
-- printed on customer-facing quotations. Uploads remain tenant-scoped by the
-- existing storage policies, and QR screenshots may be PNG or JPEG.
insert into storage.buckets (
  id,
  name,
  "public",
  file_size_limit,
  allowed_mime_types
)
values (
  'company-branding',
  'company-branding',
  true,
  1048576,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
set
  "public" = excluded."public",
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
