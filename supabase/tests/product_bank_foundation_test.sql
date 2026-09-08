begin;

do $$
begin
  if to_regclass('public.catalog_library_products') is null then
    raise exception 'Product Bank table is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.catalog_library_products'::regclass) then
    raise exception 'Product Bank must have row level security enabled';
  end if;

  if has_table_privilege('anon', 'public.catalog_library_products', 'select')
    or has_function_privilege('anon', 'public.product_bank_public_rows()', 'execute')
    or has_function_privilege('anon', 'public.import_product_bank_products(uuid[])', 'execute') then
    raise exception 'Anonymous callers must not access Product Bank data or import functions';
  end if;

  if not has_function_privilege('authenticated', 'public.product_bank_public_rows()', 'execute')
    or not has_function_privilege('authenticated', 'public.import_product_bank_products(uuid[])', 'execute') then
    raise exception 'Authenticated Product Master users need the Product Bank RPCs';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'company_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'product_bank_id'
  ) then
    raise exception 'Workspace products must retain company ownership and Product Bank source mapping';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'products'
      and indexname = 'products_company_product_bank_unique'
  ) then
    raise exception 'Product Bank imports must be unique per company';
  end if;
end;
$$;

rollback;
