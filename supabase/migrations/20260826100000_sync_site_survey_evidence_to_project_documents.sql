-- Keep site-survey evidence in the shared documents register so project
-- documents show the same files uploaded by tenant field users and office users.

alter table public.documents
  add column if not exists site_survey_id uuid
    references public.site_surveys(id) on delete set null;

create index if not exists documents_site_survey_id_idx
  on public.documents (site_survey_id);

create unique index if not exists documents_site_survey_file_unique
  on public.documents (site_survey_id, file_path);

create or replace function private.validate_document_site_survey_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.site_survey_id is not null and not exists (
    select 1
    from public.site_surveys
    where site_surveys.id = new.site_survey_id
      and site_surveys.organization_id = new.organization_id
      and site_surveys.company_id = new.company_id
  ) then
    raise exception 'site_survey_id must belong to the same organization and company as the document'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_documents_site_survey_link on public.documents;

create trigger validate_documents_site_survey_link
before insert or update of site_survey_id, organization_id, company_id
on public.documents
for each row
execute function private.validate_document_site_survey_link();

create or replace function private.site_survey_evidence_path(
  raw_path text,
  target_organization_id uuid,
  target_survey_id uuid
)
returns text
language plpgsql
immutable
as $$
declare
  normalized_path text := nullif(btrim(raw_path), '');
  expected_prefix text := target_organization_id::text || '/site-surveys/' || target_survey_id::text || '/';
begin
  if normalized_path is null then
    return null;
  end if;

  if normalized_path ~* '^https?://' then
    normalized_path := regexp_replace(
      normalized_path,
      '^.*?/organization-documents/',
      '',
      1,
      1,
      'i'
    );
  end if;

  normalized_path := split_part(normalized_path, '?', 1);

  if left(normalized_path, length(expected_prefix)) <> expected_prefix then
    return null;
  end if;

  return normalized_path;
end;
$$;

create or replace function private.sync_site_survey_evidence_documents(
  target_survey_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  survey_record public.site_surveys%rowtype;
  linked_project_id uuid;
  linked_project_customer_id uuid;
  actor_profile_id uuid;
  evidence jsonb;
  evidence_path text;
  evidence_url text;
  evidence_size bigint;
  document_name text;
begin
  select *
  into survey_record
  from public.site_surveys
  where site_surveys.id = target_survey_id;

  if not found then
    return;
  end if;

  select projects.id, projects.customer_id
  into linked_project_id, linked_project_customer_id
  from public.projects
  where projects.organization_id = survey_record.organization_id
    and (
      projects.site_survey_id = survey_record.id
      or exists (
        select 1
        from public.quotations
        where quotations.id = projects.quotation_id
          and quotations.site_survey_id = survey_record.id
          and quotations.organization_id = survey_record.organization_id
      )
    )
  order by projects.created_at asc nulls last
  limit 1;

  select users_profile.id
  into actor_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
    and users_profile.organization_id = survey_record.organization_id
    and users_profile.status = 'active'
  limit 1;

  for evidence in
    select value
    from jsonb_array_elements(coalesce(survey_record.site_photos, '[]'::jsonb))
  loop
    evidence_path := private.site_survey_evidence_path(
      coalesce(
        nullif(btrim(evidence->>'file_path'), ''),
        nullif(btrim(evidence->>'url'), '')
      ),
      survey_record.organization_id,
      survey_record.id
    );

    if evidence_path is null then
      continue;
    end if;

    evidence_url := coalesce(nullif(btrim(evidence->>'url'), ''), evidence_path);
    evidence_size := case
      when coalesce(evidence->>'size', '') ~ '^[0-9]+$'
        then (evidence->>'size')::bigint
      else null
    end;

    document_name := coalesce(nullif(btrim(evidence->>'name'), ''), 'Site photo');

    insert into public.documents (
      organization_id,
      company_id,
      customer_id,
      lead_id,
      project_id,
      site_survey_id,
      document_type,
      document_name,
      file_url,
      file_path,
      file_size,
      mime_type,
      uploaded_by,
      status
    )
    select
      survey_record.organization_id,
      survey_record.company_id,
      coalesce(survey_record.customer_id, linked_project_customer_id),
      survey_record.lead_id,
      linked_project_id,
      survey_record.id,
      'site_photo',
      document_name,
      evidence_url,
      evidence_path,
      evidence_size,
      nullif(btrim(evidence->>'mime_type'), ''),
      actor_profile_id,
      'pending'
    where not exists (
      select 1
      from public.documents
      where documents.site_survey_id = survey_record.id
        and documents.file_path = evidence_path
    )
    on conflict (site_survey_id, file_path) do nothing;
  end loop;

  evidence_path := private.site_survey_evidence_path(
    survey_record.electricity_bill_url,
    survey_record.organization_id,
    survey_record.id
  );

  if evidence_path is not null then
    document_name := nullif(
      regexp_replace(regexp_replace(evidence_path, '^.*/', ''), '^[0-9]+-', ''),
      ''
    );

    insert into public.documents (
      organization_id,
      company_id,
      customer_id,
      lead_id,
      project_id,
      site_survey_id,
      document_type,
      document_name,
      file_url,
      file_path,
      uploaded_by,
      status
    )
    select
      survey_record.organization_id,
      survey_record.company_id,
      coalesce(survey_record.customer_id, linked_project_customer_id),
      survey_record.lead_id,
      linked_project_id,
      survey_record.id,
      'site_survey_document',
      coalesce(document_name, 'Survey document'),
      survey_record.electricity_bill_url,
      evidence_path,
      actor_profile_id,
      'pending'
    where not exists (
      select 1
      from public.documents
      where documents.site_survey_id = survey_record.id
        and documents.file_path = evidence_path
    )
    on conflict (site_survey_id, file_path) do nothing;
  end if;
end;
$$;

create or replace function private.sync_site_survey_evidence_documents_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.sync_site_survey_evidence_documents(new.id);
  return new;
end;
$$;

drop trigger if exists sync_site_surveys_evidence_documents on public.site_surveys;

create trigger sync_site_surveys_evidence_documents
after insert or update of site_photos, electricity_bill_url
on public.site_surveys
for each row
execute function private.sync_site_survey_evidence_documents_trigger();

create or replace function private.sync_project_site_survey_documents(
  target_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  project_record public.projects%rowtype;
  linked_survey_id uuid;
begin
  select *
  into project_record
  from public.projects
  where projects.id = target_project_id;

  if not found then
    return;
  end if;

  linked_survey_id := project_record.site_survey_id;

  if linked_survey_id is null then
    select quotations.site_survey_id
    into linked_survey_id
    from public.quotations
    where quotations.id = project_record.quotation_id
      and quotations.organization_id = project_record.organization_id;
  end if;

  if linked_survey_id is null then
    return;
  end if;

  update public.documents
  set project_id = project_record.id
  where documents.site_survey_id = linked_survey_id
    and documents.organization_id = project_record.organization_id
    and documents.project_id is null
    and (
      documents.customer_id is null
      or documents.customer_id = project_record.customer_id
    );
end;
$$;

create or replace function private.sync_project_site_survey_documents_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.sync_project_site_survey_documents(new.id);
  return new;
end;
$$;

drop trigger if exists sync_projects_site_survey_documents on public.projects;

create trigger sync_projects_site_survey_documents
after insert or update of site_survey_id, quotation_id
on public.projects
for each row
when (new.site_survey_id is not null or new.quotation_id is not null)
execute function private.sync_project_site_survey_documents_trigger();

-- Backfill the shared document register for evidence that was uploaded before
-- this sync was introduced, and attach it to projects that already exist.
do $$
declare
  target_id uuid;
begin
  for target_id in select id from public.site_surveys loop
    perform private.sync_site_survey_evidence_documents(target_id);
  end loop;

  for target_id in
    select id from public.projects where site_survey_id is not null
  loop
    perform private.sync_project_site_survey_documents(target_id);
  end loop;
end;
$$;
