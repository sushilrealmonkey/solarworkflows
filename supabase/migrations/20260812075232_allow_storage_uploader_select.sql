-- Supabase Storage returns the inserted object row after a successful upload.
-- The record-scoped read policy only recognizes an object after its matching
-- public.documents row exists, but document uploads create that row after the
-- file upload. Permit the authenticated uploader to read their own object so
-- Storage can return the new row without broadening access to other users'
-- files or other organizations.
drop policy if exists "Organization uploaders can read their new files"
on storage.objects;

create policy "Organization uploaders can read their new files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-documents'
  and owner_id = (select auth.uid()::text)
  and split_part(name, '/', 1) = public.current_user_organization_id()::text
  and (
    public.is_super_admin()
    or public.user_has_permission('documents', 'create')
    or public.user_has_permission('site_surveys', 'create')
    or public.user_has_permission('site_surveys', 'update')
    or (
      public.user_has_permission('site_surveys', 'upload_evidence')
      and private.field_can_access_survey_object(name)
    )
  )
);
