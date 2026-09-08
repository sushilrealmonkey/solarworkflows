-- Product Bank contains a large shared catalog. Count and page it before
-- looking up tenant-specific import state, and return filter facets directly
-- from the database instead of downloading the full catalog to the browser.
create index if not exists catalog_library_products_published_category_brand_idx
  on public.catalog_library_products (category_id, brand)
  where publication_status = 'published';

create or replace function public.product_bank_public_page(
  p_search text default null,
  p_category_id uuid default null,
  p_brand text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(product_data jsonb, total_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
  organization_company_id uuid;
  normalized_search text := nullif(btrim(coalesce(p_search, '')), '');
  normalized_brand text := nullif(btrim(coalesce(p_brand, '')), '');
begin
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'Invalid Product Bank page request' using errcode = '22023';
  end if;

  if not public.is_super_admin() then
    if target_organization_id is null or target_company_id is null then
      raise exception 'An organization and company are required to browse Product Bank'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('product_master', 'view') then
      raise exception 'Missing product_master view permission' using errcode = '42501';
    end if;

    select organizations.company_id into organization_company_id
    from public.organizations
    where organizations.id = target_organization_id;

    if organization_company_id is distinct from target_company_id then
      raise exception 'Current organization and company do not match' using errcode = '42501';
    end if;
  end if;

  return query
  with paged_products as materialized (
    select
      bank.*,
      categories.id as category_row_id,
      categories.name as category_name,
      categories.category_type as category_type
    from public.catalog_library_products bank
    join public.catalog_library_categories categories on categories.id = bank.category_id
    where (public.is_super_admin() or bank.publication_status = 'published')
      and (p_category_id is null or bank.category_id = p_category_id)
      and (normalized_brand is null or bank.brand = normalized_brand)
      and (
        normalized_search is null
        or bank.product_name ilike '%' || normalized_search || '%'
        or coalesce(bank.brand, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.model_number, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.specifications, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.hsn_code, '') ilike '%' || normalized_search || '%'
      )
    order by categories.display_order, bank.product_name, bank.brand, bank.model_number, bank.id
    limit p_limit offset p_offset
  ), matching_count as materialized (
    select count(*) as value
    from public.catalog_library_products bank
    where (public.is_super_admin() or bank.publication_status = 'published')
      and (p_category_id is null or bank.category_id = p_category_id)
      and (normalized_brand is null or bank.brand = normalized_brand)
      and (
        normalized_search is null
        or bank.product_name ilike '%' || normalized_search || '%'
        or coalesce(bank.brand, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.model_number, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.specifications, '') ilike '%' || normalized_search || '%'
        or coalesce(bank.hsn_code, '') ilike '%' || normalized_search || '%'
      )
  )
  select jsonb_build_object(
    'id', bank.id,
    'company_id', bank.company_id,
    'category_id', bank.category_id,
    'product_name', bank.product_name,
    'brand', bank.brand,
    'model_number', bank.model_number,
    'specifications', bank.specifications,
    'unit', bank.unit,
    'hsn_code', bank.hsn_code,
    'gst_percent', bank.gst_percent,
    'warranty_description', bank.warranty_description,
    'notes', bank.notes,
    'publication_status', bank.publication_status,
    'revision', bank.revision,
    'published_at', bank.published_at,
    'created_at', bank.created_at,
    'updated_at', bank.updated_at,
    'category', jsonb_build_object(
      'id', bank.category_row_id,
      'name', bank.category_name,
      'category_type', bank.category_type
    ),
    'workspace_product', case when workspace_products.id is null then null else jsonb_build_object(
      'id', workspace_products.id,
      'archived_at', workspace_products.archived_at,
      'product_bank_revision', workspace_products.product_bank_revision
    ) end
  ), matching_count.value
  from paged_products bank
  cross join matching_count
  left join lateral (
    select products.id, products.archived_at, products.product_bank_revision
    from public.products products
    where products.product_bank_id = bank.id
      and products.tenant_id = target_organization_id
      and products.company_id = target_company_id
    limit 1
  ) workspace_products on true;
end;
$$;

create or replace function public.product_bank_filter_options()
returns table(category_id uuid, brand text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
  target_company_id uuid := public.get_current_user_company_id();
  organization_company_id uuid;
begin
  if not public.is_super_admin() then
    if target_organization_id is null or target_company_id is null then
      raise exception 'An organization and company are required to browse Product Bank'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('product_master', 'view') then
      raise exception 'Missing product_master view permission' using errcode = '42501';
    end if;

    select organizations.company_id into organization_company_id
    from public.organizations
    where organizations.id = target_organization_id;

    if organization_company_id is distinct from target_company_id then
      raise exception 'Current organization and company do not match' using errcode = '42501';
    end if;
  end if;

  return query
  select bank.category_id, bank.brand
  from public.catalog_library_products bank
  where public.is_super_admin() or bank.publication_status = 'published'
  group by bank.category_id, bank.brand
  order by bank.category_id, bank.brand;
end;
$$;

revoke all on function public.product_bank_public_page(text, uuid, text, integer, integer)
  from public, anon;
revoke all on function public.product_bank_filter_options() from public, anon;
grant execute on function public.product_bank_public_page(text, uuid, text, integer, integer)
  to authenticated;
grant execute on function public.product_bank_filter_options() to authenticated;

notify pgrst, 'reload schema';
