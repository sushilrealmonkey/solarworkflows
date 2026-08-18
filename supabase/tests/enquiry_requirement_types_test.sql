-- Transactional checks for tenant-owned enquiry requirement types.
begin;

do $$
begin
  if to_regclass('public.lead_requirement_types') is null then
    raise exception 'lead_requirement_types table is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.lead_requirement_types'::regclass
  ) then
    raise exception 'lead_requirement_types must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.lead_requirement_types', 'select')
    or has_table_privilege('anon', 'public.lead_requirement_types', 'insert') then
    raise exception 'Anonymous users must not access enquiry requirement types';
  end if;

  if not has_table_privilege('authenticated', 'public.lead_requirement_types', 'select')
    or not has_table_privilege('authenticated', 'public.lead_requirement_types', 'insert') then
    raise exception 'Authenticated users need select and insert grants';
  end if;

  if has_table_privilege('authenticated', 'public.lead_requirement_types', 'update')
    or has_table_privilege('authenticated', 'public.lead_requirement_types', 'delete') then
    raise exception 'Requirement types must not be mutable through the Data API';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_requirement_types'
      and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_requirement_types'
      and cmd = 'INSERT'
  ) then
    raise exception 'Tenant select and insert policies are required';
  end if;
end;
$$;

insert into public.companies (id, company_name, company_slug, status)
values
  (
    '81000000-0000-0000-0000-000000000001',
    'Requirement Type Test One',
    'requirement-type-test-one',
    'active'
  ),
  (
    '81000000-0000-0000-0000-000000000002',
    'Requirement Type Test Two',
    'requirement-type-test-two',
    'active'
  );

insert into public.lead_requirement_types (company_id, name)
values
  ('81000000-0000-0000-0000-000000000001', 'Industrial Rooftop'),
  ('81000000-0000-0000-0000-000000000002', 'Industrial Rooftop');

do $$
declare
  duplicate_blocked boolean := false;
  default_blocked boolean := false;
begin
  begin
    insert into public.lead_requirement_types (company_id, name)
    values ('81000000-0000-0000-0000-000000000001', 'industrial rooftop');
  exception
    when unique_violation then duplicate_blocked := true;
  end;

  begin
    insert into public.lead_requirement_types (company_id, name)
    values ('81000000-0000-0000-0000-000000000001', 'Residential');
  exception
    when check_violation then default_blocked := true;
  end;

  if not duplicate_blocked then
    raise exception 'Case-insensitive tenant duplicates must be rejected';
  end if;

  if not default_blocked then
    raise exception 'Built-in defaults must not be duplicated as custom types';
  end if;
end;
$$;

rollback;
