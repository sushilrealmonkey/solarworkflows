-- Provision the private storage bucket used by quotation PDFs, invoice PDFs,
-- uploaded documents, and site-survey files.

insert into storage.buckets (
  id,
  name,
  "public",
  file_size_limit,
  allowed_mime_types
)
values (
  'organization-documents',
  'organization-documents',
  false,
  52428800,
  null
)
on conflict (id) do update
set
  "public" = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organization users can read organization document files"
on storage.objects;

drop policy if exists "Organization users can upload organization document files"
on storage.objects;

drop policy if exists "Organization users can update organization document files"
on storage.objects;

drop policy if exists "Organization users can delete organization document files"
on storage.objects;

create policy "Organization users can read organization document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'view')
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('site_surveys', 'view')
    or public.user_has_permission('site_surveys', 'update')
  )
);

create policy "Organization users can upload organization document files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('site_surveys', 'create')
    or public.user_has_permission('site_surveys', 'update')
  )
);

create policy "Organization users can update organization document files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('documents', 'update')
    or public.user_has_permission('site_surveys', 'update')
  )
)
with check (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('documents', 'update')
    or public.user_has_permission('site_surveys', 'update')
  )
);

create policy "Organization users can delete organization document files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.current_user_organization_id()::text
  )
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'delete')
    or public.user_has_permission('site_surveys', 'delete')
    or public.user_has_permission('site_surveys', 'update')
  )
);
