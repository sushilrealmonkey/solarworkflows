-- Rebuild Inventory around Product Master.
-- Product Master owns product/category/type metadata. Inventory owns stock and
-- stock-alert values.

alter table public.inventory_items
add column if not exists catalog_product_id uuid references public.products(id) on delete set null;

create index if not exists inventory_items_catalog_product_id_idx
on public.inventory_items (catalog_product_id)
where catalog_product_id is not null;

-- Inventory users need read access to Product Master choices even when they do
-- not manage Product Master itself.
drop policy if exists "Tenant users can view product categories" on public.product_categories;
create policy "Tenant users can view product categories"
on public.product_categories
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('product_master', 'view')
    or public.user_has_permission('inventory', 'view')
  )
);

drop policy if exists "Tenant users can view product types" on public.product_types;
create policy "Tenant users can view product types"
on public.product_types
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('product_master', 'view')
    or public.user_has_permission('inventory', 'view')
  )
);

drop policy if exists "Tenant users can view products" on public.products;
create policy "Tenant users can view products"
on public.products
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('product_master', 'view')
    or public.user_has_permission('inventory', 'view')
  )
);

-- Conservative compatibility backfill: exact tenant/name match with compatible
-- brand and model values. Ambiguous active duplicates are left unmapped.
with candidate_matches as (
  select
    inventory_items.id as inventory_item_id,
    products.id as product_id,
    row_number() over (
      partition by inventory_items.id
      order by
        case
          when lower(btrim(coalesce(products.brand, ''))) = lower(btrim(coalesce(inventory_items.brand, ''))) then 0
          else 1
        end,
        case
          when lower(btrim(coalesce(products.model_number, ''))) = lower(btrim(coalesce(inventory_items.model, ''))) then 0
          else 1
        end,
        products.created_at
    ) as item_rank,
    count(*) over (
      partition by inventory_items.organization_id, products.id
    ) as inventory_rows_for_product
  from public.inventory_items
  join public.products
    on products.tenant_id = inventory_items.organization_id
   and lower(btrim(products.product_name)) = lower(btrim(inventory_items.item_name))
  where inventory_items.catalog_product_id is null
    and (
      nullif(btrim(coalesce(inventory_items.brand, '')), '') is null
      or nullif(btrim(coalesce(products.brand, '')), '') is null
      or lower(btrim(products.brand)) = lower(btrim(inventory_items.brand))
    )
    and (
      nullif(btrim(coalesce(inventory_items.model, '')), '') is null
      or nullif(btrim(coalesce(products.model_number, '')), '') is null
      or lower(btrim(products.model_number)) = lower(btrim(inventory_items.model))
    )
),
safe_matches as (
  select inventory_item_id, product_id
  from candidate_matches
  where item_rank = 1
    and inventory_rows_for_product = 1
)
update public.inventory_items
set catalog_product_id = safe_matches.product_id
from safe_matches
where inventory_items.id = safe_matches.inventory_item_id;

-- Make any pre-existing duplicate active product links explicit unmapped rows so
-- the unique guard can be installed safely.
with ranked_links as (
  select
    inventory_items.id,
    row_number() over (
      partition by inventory_items.organization_id, inventory_items.catalog_product_id
      order by
        case when inventory_items.status = 'active' then 0 else 1 end,
        coalesce(inventory_items.current_stock, 0) desc,
        inventory_items.created_at
    ) as link_rank
  from public.inventory_items
  where inventory_items.catalog_product_id is not null
    and inventory_items.status = 'active'
)
update public.inventory_items
set catalog_product_id = null
from ranked_links
where inventory_items.id = ranked_links.id
  and ranked_links.link_rank > 1;

create unique index if not exists inventory_items_organization_catalog_product_active_unique
on public.inventory_items (organization_id, catalog_product_id)
where catalog_product_id is not null
  and status = 'active';

create or replace function public.inventory_item_category_from_product_category_type(
  category_type public.product_category_type
)
returns text
language sql
immutable
as $$
  select case category_type
    when 'SOLAR_PANEL'::public.product_category_type then 'solar_panel'
    when 'INVERTER'::public.product_category_type then 'inverter'
    when 'BATTERY'::public.product_category_type then 'battery'
    when 'STRUCTURE'::public.product_category_type then 'mounting_structure'
    when 'DC_CABLE'::public.product_category_type then 'cable'
    when 'AC_CABLE'::public.product_category_type then 'cable'
    when 'MONITORING_DEVICE'::public.product_category_type then 'meter'
    when 'PROTECTION_DEVICE'::public.product_category_type then 'safety_equipment'
    when 'EARTHING'::public.product_category_type then 'safety_equipment'
    when 'LIGHTNING_ARRESTOR'::public.product_category_type then 'safety_equipment'
    when 'ACCESSORY'::public.product_category_type then 'connector'
    else 'other'
  end;
$$;

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
  vendor_record public.vendors_master%rowtype;
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
    -- Legacy compatibility for older unmapped rows only.
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
    from public.vendors_master
    where vendors_master.id = new.vendor_id;

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

drop trigger if exists set_inventory_items_defaults on public.inventory_items;

create trigger set_inventory_items_defaults
before insert or update on public.inventory_items
for each row
execute function public.set_inventory_item_defaults();

notify pgrst, 'reload schema';
