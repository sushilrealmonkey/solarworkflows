alter table public.site_surveys
  add column if not exists google_map_link text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'site_surveys_google_map_link_check'
      and conrelid = 'public.site_surveys'::regclass
  ) then
    alter table public.site_surveys
    add constraint site_surveys_google_map_link_check
    check (
      google_map_link is null
      or btrim(google_map_link) ~* '^https?://'
    );
  end if;
end;
$$;

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
