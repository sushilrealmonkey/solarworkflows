begin;

do $$
declare
  uploader_policy pg_policies%rowtype;
begin
  select *
  into uploader_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Organization uploaders can read their new files';

  if uploader_policy.policyname is null then
    raise exception 'The uploader SELECT policy must exist for Storage upload RETURNING';
  end if;

  if uploader_policy.cmd <> 'SELECT'
    or uploader_policy.roles <> array['authenticated']::name[] then
    raise exception 'The uploader policy must grant SELECT only to authenticated users';
  end if;

  if position('owner_id' in coalesce(uploader_policy.qual, '')) = 0
    or position('current_user_organization_id' in coalesce(uploader_policy.qual, '')) = 0
    or position('organization-documents' in coalesce(uploader_policy.qual, '')) = 0
    or position('documents' in coalesce(uploader_policy.qual, '')) = 0 then
    raise exception 'The uploader policy must remain owner, tenant, bucket, and permission scoped';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'organization-documents' and public = false
  ) then
    raise exception 'The organization-documents bucket must exist and remain private';
  end if;
end;
$$;

rollback;
