begin;

do $$
begin
  if to_regclass('public.quotation_packages') is null then
    raise exception 'quotation_packages table is missing';
  end if;

  if to_regclass('public.quotation_package_items') is null then
    raise exception 'quotation_package_items table is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotations'
      and column_name = 'quotation_package_id'
  ) then
    raise exception 'quotations.quotation_package_id is missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'quotation_packages'
      and policyname = 'Company users can view quotation packages'
  ) then
    raise exception 'quotation package company read policy is missing';
  end if;
end;
$$;

select
  (select relrowsecurity from pg_class where oid = 'public.quotation_packages'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.quotation_package_items'::regclass)
  as quotation_packages_schema_passed;

rollback;
