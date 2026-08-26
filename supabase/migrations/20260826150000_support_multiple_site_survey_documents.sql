-- Keep survey documents in an append-only JSON array, matching site_photos.
-- electricity_bill_url remains for backwards compatibility with older uploads.

alter table public.site_surveys
  add column if not exists survey_documents jsonb default '[]'::jsonb;

alter table public.site_surveys
  alter column survey_documents set default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_surveys_survey_documents_array_check'
      and conrelid = 'public.site_surveys'::regclass
  ) then
    alter table public.site_surveys
    add constraint site_surveys_survey_documents_array_check
    check (jsonb_typeof(survey_documents) = 'array');
  end if;
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
  evidence_type text;
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

  for evidence, evidence_type in
    select value, 'site_photo'
    from jsonb_array_elements(coalesce(survey_record.site_photos, '[]'::jsonb))
    union all
    select value, 'site_survey_document'
    from jsonb_array_elements(coalesce(survey_record.survey_documents, '[]'::jsonb))
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

    document_name := coalesce(
      nullif(btrim(evidence->>'name'), ''),
      case when evidence_type = 'site_photo' then 'Site photo' else 'Survey document' end
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
      evidence_type,
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

drop trigger if exists sync_site_surveys_evidence_documents on public.site_surveys;

create trigger sync_site_surveys_evidence_documents
after insert or update of site_photos, survey_documents, electricity_bill_url
on public.site_surveys
for each row
execute function private.sync_site_survey_evidence_documents_trigger();

create or replace function public.get_field_site_surveys(target_survey_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', s.id,
    'company_id', s.company_id,
    'organization_id', s.organization_id,
    'survey_code', s.survey_code,
    'scheduled_date', s.scheduled_date,
    'scheduled_time', s.scheduled_time,
    'survey_status', s.survey_status,
    'completed_at', s.completed_at,
    'assigned_to', s.assigned_to,
    'contact_name', coalesce(c.full_name, l.full_name),
    'contact_phone', coalesce(c.phone, l.phone),
    'site_address', coalesce(
      nullif(concat_ws(', ', c.address_line_1, c.address_line_2, c.city, c.district, c.state, c.pincode), ''),
      nullif(concat_ws(', ', l.address, l.city, l.district, l.state, l.pincode), '')
    ),
    'roof_type', s.roof_type,
    'roof_area_sqft', s.roof_area_sqft,
    'shadow_free_area_sqft', s.shadow_free_area_sqft,
    'recommended_capacity_kw', s.recommended_capacity_kw,
    'sanctioned_load_kw', s.sanctioned_load_kw,
    'phase_type', s.phase_type,
    'latitude', s.latitude,
    'longitude', s.longitude,
    'google_map_link', s.google_map_link,
    'address_notes', s.address_notes,
    'remarks', s.remarks,
    'site_photos', coalesce(s.site_photos, '[]'::jsonb),
    'survey_documents', coalesce(s.survey_documents, '[]'::jsonb),
    'electricity_bill_url', s.electricity_bill_url,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
  from public.site_surveys s
  left join public.customers c on c.id = s.customer_id and c.organization_id = s.organization_id
  left join public.leads l on l.id = s.lead_id and l.organization_id = s.organization_id
  where (target_survey_id is null or s.id = target_survey_id)
    and public.user_has_permission('site_surveys','view')
    and private.is_assigned_field_survey(s.id)
  order by s.scheduled_date desc nulls last, s.created_at desc;
$$;

create or replace function public.register_field_survey_evidence(
  target_survey_id uuid,
  evidence_kind text,
  evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare survey_record public.site_surveys%rowtype;
begin
  if not public.user_has_permission('site_surveys','upload_evidence') then
    raise exception 'Survey evidence permission is required' using errcode = '42501';
  end if;
  select * into survey_record from public.site_surveys where id = target_survey_id for update;
  if not found or not private.is_assigned_field_survey(target_survey_id) then
    raise exception 'Assigned site survey not found' using errcode = '42501';
  end if;
  if survey_record.survey_status in ('completed','cancelled') then
    raise exception 'Completed or cancelled surveys are read-only' using errcode = '23514';
  end if;
  if evidence_kind = 'photo' then
    update public.site_surveys
    set site_photos = coalesce(site_photos,'[]'::jsonb) || jsonb_build_array(evidence), updated_at = now()
    where id = target_survey_id returning * into survey_record;
  elsif evidence_kind = 'document' then
    update public.site_surveys
    set survey_documents = coalesce(survey_documents,'[]'::jsonb) || jsonb_build_array(evidence), updated_at = now()
    where id = target_survey_id returning * into survey_record;
  else
    raise exception 'Evidence kind must be photo or document' using errcode = '22023';
  end if;
  return jsonb_build_object('id', survey_record.id, 'site_photos', survey_record.site_photos,
    'survey_documents', survey_record.survey_documents,
    'electricity_bill_url', survey_record.electricity_bill_url, 'updated_at', survey_record.updated_at);
end;
$$;
