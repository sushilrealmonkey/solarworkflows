-- Use the tenant supplier directory for both Inventory and Purchase Orders.
-- Inventory previously referenced the one-time vendors_master snapshot, so
-- suppliers added later were unavailable in Inventory edit forms.

-- Preserve legacy inventory-only supplier names as real supplier records.
insert into public.vendors (
  id,
  organization_id,
  vendor_name,
  vendor_type,
  status
)
select
  vendors_master.id,
  vendors_master.organization_id,
  vendors_master.name,
  'supplier',
  'active'
from public.vendors_master
where not exists (
  select 1
  from public.vendors
  where vendors.id = vendors_master.id
)
and not exists (
  select 1
  from public.vendors
  where vendors.organization_id = vendors_master.organization_id
    and lower(btrim(vendors.vendor_name)) = lower(btrim(vendors_master.name))
);

alter table public.inventory_items
drop constraint if exists inventory_items_vendor_id_fkey;

create or replace function public.set_inventory_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  catalog_product_record public.products%rowtype;
  product_record public.products_master%rowtype;
  brand_record public.brands_master%rowtype;
  model_record public.models_master%rowtype;
  vendor_record public.vendors%rowtype;
begin
  if new.item_code is null or trim(new.item_code) = '' then
    new.item_code := public.generate_inventory_item_code(new.organization_id);
  end if;

  if tg_op = 'INSERT' and new.catalog_product_id is null then
    raise exception 'catalog_product_id is required for new inventory items'
      using errcode = '23502';
  end if;

  if new.catalog_product_id is not null then
    select *
    into catalog_product_record
    from public.products
    where products.id = new.catalog_product_id;

    if not found or catalog_product_record.tenant_id <> new.organization_id then
      raise exception 'catalog_product_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    if (
      tg_op = 'INSERT'
      or old.catalog_product_id is distinct from new.catalog_product_id
    ) and catalog_product_record.status <> 'active' then
      raise exception 'catalog_product_id must reference an active product'
        using errcode = '23514';
    end if;

    new.item_name := catalog_product_record.product_name;
    new.item_category := public.inventory_item_category_from_product_category_type(
      catalog_product_record.category_type
    );
    new.brand := catalog_product_record.brand;
    new.model := coalesce(
      catalog_product_record.model_number,
      catalog_product_record.specifications
    );
    new.unit := catalog_product_record.unit;
    new.purchase_price := coalesce(catalog_product_record.purchase_price, 0);
    new.selling_price := coalesce(catalog_product_record.selling_price, 0);
    new.gst_percent := coalesce(catalog_product_record.gst_percent, 0);
  elsif new.product_id is not null then
    select *
    into product_record
    from public.products_master
    where products_master.id = new.product_id;

    if not found or product_record.organization_id <> new.organization_id then
      raise exception 'product_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    new.item_name := product_record.name;
    new.item_category := public.inventory_category_from_product_name(product_record.name);
  end if;

  if new.catalog_product_id is null and new.brand_id is not null then
    select *
    into brand_record
    from public.brands_master
    where brands_master.id = new.brand_id;

    if not found or brand_record.organization_id <> new.organization_id then
      raise exception 'brand_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    new.brand := brand_record.name;
  end if;

  if new.catalog_product_id is null and new.model_id is not null then
    select *
    into model_record
    from public.models_master
    where models_master.id = new.model_id;

    if not found or model_record.organization_id <> new.organization_id then
      raise exception 'model_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    if new.product_id is not null and model_record.product_id <> new.product_id then
      raise exception 'model_id must match the selected product_id'
        using errcode = '23503';
    end if;

    if new.brand_id is not null and model_record.brand_id <> new.brand_id then
      raise exception 'model_id must match the selected brand_id'
        using errcode = '23503';
    end if;

    new.model := model_record.name;
  end if;

  if new.vendor_id is not null then
    select *
    into vendor_record
    from public.vendors
    where vendors.id = new.vendor_id;

    if not found or vendor_record.organization_id <> new.organization_id then
      raise exception 'vendor_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;
  end if;

  new.item_category := coalesce(nullif(trim(new.item_category), ''), 'other');
  new.current_stock := coalesce(new.current_stock, 0);
  new.opening_stock := coalesce(new.opening_stock, 0);
  new.minimum_stock := coalesce(new.minimum_stock, 0);
  new.purchase_price := coalesce(new.purchase_price, 0);
  new.selling_price := coalesce(new.selling_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.status := coalesce(nullif(trim(new.status), ''), 'active');

  return new;
end;
$$;

-- Translate legacy master IDs to the matching real supplier IDs.
with supplier_mapping as (
  select
    inventory_items.id as inventory_item_id,
    (
      select vendors.id
      from public.vendors
      where vendors.organization_id = inventory_items.organization_id
        and (
          vendors.id = vendors_master.id
          or lower(btrim(vendors.vendor_name)) = lower(btrim(vendors_master.name))
        )
      order by (vendors.id = vendors_master.id) desc, vendors.created_at, vendors.id
      limit 1
    ) as vendor_id
  from public.inventory_items
  join public.vendors_master on vendors_master.id = inventory_items.vendor_id
)
update public.inventory_items
set vendor_id = supplier_mapping.vendor_id
from supplier_mapping
where inventory_items.id = supplier_mapping.inventory_item_id;

-- Clear only invalid legacy links that could not be resolved inside the tenant.
update public.inventory_items
set vendor_id = null
where inventory_items.vendor_id is not null
  and not exists (
    select 1
    from public.vendors
    where vendors.id = inventory_items.vendor_id
      and vendors.organization_id = inventory_items.organization_id
  );

alter table public.inventory_items
add constraint inventory_items_vendor_id_fkey
foreign key (vendor_id) references public.vendors(id) on delete set null;

create or replace function public.inventory_item_public_rows(target_item_id uuid default null)
returns table(item_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user'
      using errcode = '42501';
  end if;

  if not public.is_super_admin()
    and not (
      public.user_has_permission('inventory', 'view')
      or public.user_has_permission('quotations', 'view')
    ) then
    raise exception 'Missing inventory item view permission'
      using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', inventory_items.id,
    'organization_id', inventory_items.organization_id,
    'catalog_product_id', inventory_items.catalog_product_id,
    'product_id', inventory_items.product_id,
    'brand_id', inventory_items.brand_id,
    'model_id', inventory_items.model_id,
    'vendor_id', inventory_items.vendor_id,
    'item_code', inventory_items.item_code,
    'item_name', inventory_items.item_name,
    'item_category', inventory_items.item_category,
    'brand', inventory_items.brand,
    'model', inventory_items.model,
    'unit', inventory_items.unit,
    'current_stock', inventory_items.current_stock,
    'opening_stock', inventory_items.opening_stock,
    'minimum_stock', inventory_items.minimum_stock,
    'purchase_price', null,
    'selling_price', null,
    'gst_percent', inventory_items.gst_percent,
    'status', inventory_items.status,
    'bill_no', inventory_items.bill_no,
    'inventory_date', inventory_items.inventory_date,
    'notes', inventory_items.notes,
    'created_at', inventory_items.created_at,
    'updated_at', inventory_items.updated_at,
    'vendor_master', case
      when vendors.id is null then null
      else jsonb_build_object('id', vendors.id, 'name', vendors.vendor_name)
    end,
    'catalog_product', case
      when products.id is null then null
      else jsonb_build_object(
        'id', products.id,
        'tenant_id', products.tenant_id,
        'product_code', products.product_code,
        'product_name', products.product_name,
        'category_id', products.category_id,
        'category_type', products.category_type,
        'hsn_code', products.hsn_code,
        'brand', products.brand,
        'model_number', products.model_number,
        'specifications', products.specifications,
        'unit', products.unit,
        'gst_percent', products.gst_percent,
        'status', products.status,
        'category', case
          when product_categories.id is null then null
          else jsonb_build_object(
            'id', product_categories.id,
            'name', product_categories.name,
            'category_type', product_categories.category_type,
            'display_order', product_categories.display_order
          )
        end
      )
    end
  )
  from public.inventory_items
  left join public.vendors on vendors.id = inventory_items.vendor_id
  left join public.products on products.id = inventory_items.catalog_product_id
  left join public.product_categories on product_categories.id = products.category_id
  where inventory_items.catalog_product_id is not null
    and (target_item_id is null or inventory_items.id = target_item_id)
    and (
      public.is_super_admin()
      or inventory_items.organization_id = target_organization_id
    )
  order by inventory_items.item_name;
end;
$$;

grant execute on function public.inventory_item_public_rows(uuid) to authenticated;

notify pgrst, 'reload schema';
