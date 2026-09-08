-- Supports category maintenance and removes the missing foreign-key index
-- reported by the Supabase performance advisor.
create index if not exists catalog_library_products_category_id_idx
  on public.catalog_library_products (category_id);

-- A page-scoped Product Bank projection. The previous endpoint returned the
-- full catalog and relied on the browser to filter and paginate it.
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

    select company_id into organization_company_id
    from public.organizations
    where id = target_organization_id;

    if organization_company_id is distinct from target_company_id then
      raise exception 'Current organization and company do not match' using errcode = '42501';
    end if;
  end if;

  return query
  with matching_products as (
    select
      bank.*,
      categories.id as category_row_id,
      categories.name as category_name,
      categories.category_type as category_type,
      categories.display_order as category_display_order,
      workspace_products.id as workspace_product_id,
      workspace_products.archived_at as workspace_product_archived_at,
      workspace_products.product_bank_revision as workspace_product_revision
    from public.catalog_library_products bank
    join public.catalog_library_categories categories on categories.id = bank.category_id
    left join lateral (
      select products.id, products.archived_at, products.product_bank_revision
      from public.products products
      where products.product_bank_id = bank.id
        and products.tenant_id = target_organization_id
        and products.company_id = target_company_id
      limit 1
    ) workspace_products on true
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
    'id', id,
    'company_id', company_id,
    'category_id', category_id,
    'product_name', product_name,
    'brand', brand,
    'model_number', model_number,
    'specifications', specifications,
    'unit', unit,
    'hsn_code', hsn_code,
    'gst_percent', gst_percent,
    'warranty_description', warranty_description,
    'notes', notes,
    'publication_status', publication_status,
    'revision', revision,
    'published_at', published_at,
    'created_at', created_at,
    'updated_at', updated_at,
    'category', jsonb_build_object(
      'id', category_row_id,
      'name', category_name,
      'category_type', category_type
    ),
    'workspace_product', case when workspace_product_id is null then null else jsonb_build_object(
      'id', workspace_product_id,
      'archived_at', workspace_product_archived_at,
      'product_bank_revision', workspace_product_revision
    ) end
  ), count(*) over()
  from matching_products
  order by category_display_order, product_name, brand, model_number, id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.product_bank_public_page(text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.product_bank_public_page(text, uuid, text, integer, integer)
  to authenticated;
