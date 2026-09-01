-- Separate procurement suppliers from expense vendors.
-- Existing vendor rows predate Expense Management and are migrated as suppliers
-- with their UUIDs preserved so purchase and inventory history remains intact.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_code text,
  supplier_name text not null,
  contact_person text,
  phone text,
  alternate_phone text,
  email text,
  gst_number text,
  pan_number text,
  address_line_1 text,
  address_line_2 text,
  city text,
  district text,
  state text,
  pincode text,
  status text not null default 'active',
  preferred_payment_method text,
  payment_terms_days integer,
  notes text,
  created_by uuid references public.users_profile(id) on delete set null,
  updated_by uuid references public.users_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.users_profile(id) on delete set null,
  archive_reason text,
  constraint suppliers_status_check
    check (status in ('active', 'inactive', 'blacklisted')),
  constraint suppliers_payment_terms_days_check
    check (payment_terms_days is null or payment_terms_days between 0 and 365)
);

create unique index suppliers_company_supplier_code_unique
on public.suppliers (company_id, supplier_code)
where supplier_code is not null;

create index suppliers_company_name_idx
on public.suppliers (company_id, supplier_name);

create index suppliers_company_status_idx
on public.suppliers (company_id, status);

create index suppliers_organization_id_idx
on public.suppliers (organization_id);

insert into public.suppliers (
  id,
  company_id,
  organization_id,
  supplier_code,
  supplier_name,
  contact_person,
  phone,
  alternate_phone,
  email,
  gst_number,
  pan_number,
  address_line_1,
  address_line_2,
  city,
  district,
  state,
  pincode,
  status,
  preferred_payment_method,
  payment_terms_days,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at,
  archived_at,
  archived_by,
  archive_reason
)
select
  vendors.id,
  vendors.company_id,
  vendors.organization_id,
  case
    when vendors.vendor_code ~ '^VEN-[0-9]+$'
      then regexp_replace(vendors.vendor_code, '^VEN-', 'SUP-')
    else vendors.vendor_code
  end,
  vendors.vendor_name,
  vendors.contact_person,
  vendors.phone,
  vendors.alternate_phone,
  vendors.email,
  vendors.gst_number,
  vendors.pan_number,
  vendors.address_line_1,
  vendors.address_line_2,
  vendors.city,
  vendors.district,
  vendors.state,
  vendors.pincode,
  coalesce(vendors.status, 'active'),
  vendors.preferred_payment_method,
  vendors.payment_terms_days,
  vendors.notes,
  vendors.created_by,
  null,
  coalesce(vendors.created_at, now()),
  coalesce(vendors.updated_at, now()),
  vendors.archived_at,
  vendors.archived_by,
  vendors.archive_reason
from public.vendors;

alter table public.purchase_orders
drop constraint purchase_orders_vendor_id_fkey;
alter table public.purchase_orders
add constraint purchase_orders_vendor_id_fkey
foreign key (vendor_id) references public.suppliers(id) on delete restrict;

alter table public.inventory_items
drop constraint inventory_items_vendor_id_fkey;
alter table public.inventory_items
add constraint inventory_items_vendor_id_fkey
foreign key (vendor_id) references public.suppliers(id) on delete set null;

alter table public.inventory_batches
drop constraint inventory_batches_vendor_id_fkey;
alter table public.inventory_batches
add constraint inventory_batches_vendor_id_fkey
foreign key (vendor_id) references public.suppliers(id) on delete set null;

alter table public.inventory_transactions
drop constraint inventory_transactions_vendor_id_fkey;
alter table public.inventory_transactions
add constraint inventory_transactions_vendor_id_fkey
foreign key (vendor_id) references public.suppliers(id) on delete set null;

-- Expense vendors are now an independent directory. Keep a row only if an
-- expense was created against it during deployment.
alter table public.vendors disable trigger guard_vendors_lifecycle_delete;

delete from public.vendors
where exists (
  select 1 from public.suppliers where suppliers.id = vendors.id
)
and not exists (
  select 1 from public.vendor_expenses where vendor_expenses.vendor_id = vendors.id
);

alter table public.vendors enable trigger guard_vendors_lifecycle_delete;

update public.vendors
set vendor_type = 'service_provider'
where vendor_type = 'supplier';

alter table public.vendors alter column vendor_type set default 'service_provider';
alter table public.vendors drop constraint if exists vendors_vendor_type_check;
alter table public.vendors
add constraint vendors_vendor_type_check
check (vendor_type in ('contractor', 'installer', 'transporter', 'service_provider', 'other'));

create or replace function public.generate_supplier_code(target_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if target_company_id is null then
    raise exception 'company_id is required to generate a supplier code'
      using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('supplier:' || target_company_id::text, 0)
  );

  select coalesce(
    max(substring(suppliers.supplier_code from '^SUP-([0-9]+)$')::integer),
    0
  ) + 1
  into next_number
  from public.suppliers
  where suppliers.company_id = target_company_id
    and suppliers.supplier_code ~ '^SUP-[0-9]+$';

  return 'SUP-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function private.set_supplier_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  organization_company_id uuid;
  actor_profile_id uuid;
begin
  select organizations.company_id
  into organization_company_id
  from public.organizations
  where organizations.id = new.organization_id;

  if organization_company_id is null
    or organization_company_id is distinct from new.company_id then
    raise exception 'organization_id must belong to the supplier company'
      using errcode = '23503';
  end if;

  if new.supplier_code is null or btrim(new.supplier_code) = '' then
    new.supplier_code := public.generate_supplier_code(new.company_id);
  end if;

  new.supplier_name := btrim(new.supplier_name);
  new.status := coalesce(nullif(btrim(new.status), ''), 'active');

  select users_profile.id
  into actor_profile_id
  from public.users_profile
  where users_profile.auth_user_id = (select auth.uid())
    and users_profile.company_id = new.company_id
    and users_profile.status = 'active'
  limit 1;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor_profile_id);
  end if;
  new.updated_by := coalesce(actor_profile_id, new.updated_by);

  return new;
end;
$$;

create trigger set_suppliers_defaults
before insert or update on public.suppliers
for each row execute function private.set_supplier_defaults();

create trigger set_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

create trigger enforce_subscription_write_suppliers
before insert or update or delete on public.suppliers
for each row execute function public.enforce_company_subscription_write('vendors');

alter table public.suppliers enable row level security;

create policy "Super admins can manage suppliers"
on public.suppliers for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Company users can view suppliers"
on public.suppliers for select to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'view'))
);

create policy "Company users can create suppliers"
on public.suppliers for insert to authenticated
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'create'))
);

create policy "Company users can update suppliers"
on public.suppliers for update to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
)
with check (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'update'))
);

create policy "Company users can delete suppliers"
on public.suppliers for delete to authenticated
using (
  company_id = (select public.current_user_company_id())
  and (select public.user_has_permission('vendors', 'delete'))
);

revoke all on table public.suppliers from anon, authenticated;
grant select, insert, update, delete on table public.suppliers to authenticated;
grant select, insert, update, delete on table public.suppliers to service_role;

create or replace function public.set_purchase_order_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.purchase_code is null or trim(new.purchase_code) = '' then
    new.purchase_code := public.generate_purchase_code(new.organization_id);
  end if;

  new.order_date := coalesce(new.order_date, current_date);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');
  new.subtotal := coalesce(new.subtotal, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);

  if not exists (
    select 1
    from public.suppliers
    where suppliers.id = new.vendor_id
      and suppliers.organization_id = new.organization_id
  ) then
    raise exception 'supplier must belong to the same organization as the purchase order'
      using errcode = '23503';
  end if;

  if new.created_by is null and auth.uid() is not null then
    select users_profile.id into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;
    new.created_by := current_profile_id;
  end if;

  if new.created_by is not null and not exists (
    select 1 from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the purchase order'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.purchase_vendor_options()
returns table (
  id uuid,
  vendor_code text,
  vendor_name text,
  contact_person text,
  phone text
)
language sql
security definer
set search_path = public
as $$
  select
    suppliers.id,
    suppliers.supplier_code as vendor_code,
    suppliers.supplier_name as vendor_name,
    suppliers.contact_person,
    suppliers.phone
  from public.suppliers
  where (
      public.is_super_admin()
      or (
        suppliers.company_id = public.current_user_company_id()
        and public.user_has_permission('inventory', 'view')
      )
    )
    and suppliers.status = 'active'
    and suppliers.archived_at is null
  order by suppliers.supplier_name;
$$;

grant execute on function public.purchase_vendor_options() to authenticated;

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
  supplier_record public.suppliers%rowtype;
begin
  if new.item_code is null or trim(new.item_code) = '' then
    new.item_code := public.generate_inventory_item_code(new.organization_id);
  end if;

  if tg_op = 'INSERT' and new.catalog_product_id is null then
    raise exception 'catalog_product_id is required for new inventory items'
      using errcode = '23502';
  end if;

  if new.catalog_product_id is not null then
    select * into catalog_product_record
    from public.products where products.id = new.catalog_product_id;

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
    new.model := coalesce(catalog_product_record.model_number, catalog_product_record.specifications);
    new.unit := catalog_product_record.unit;
    new.purchase_price := coalesce(catalog_product_record.purchase_price, 0);
    new.selling_price := coalesce(catalog_product_record.selling_price, 0);
    new.gst_percent := coalesce(catalog_product_record.gst_percent, 0);
  elsif new.product_id is not null then
    select * into product_record
    from public.products_master where products_master.id = new.product_id;

    if not found or product_record.organization_id <> new.organization_id then
      raise exception 'product_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;

    new.item_name := product_record.name;
    new.item_category := public.inventory_category_from_product_name(product_record.name);
  end if;

  if new.catalog_product_id is null and new.brand_id is not null then
    select * into brand_record from public.brands_master where brands_master.id = new.brand_id;
    if not found or brand_record.organization_id <> new.organization_id then
      raise exception 'brand_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;
    new.brand := brand_record.name;
  end if;

  if new.catalog_product_id is null and new.model_id is not null then
    select * into model_record from public.models_master where models_master.id = new.model_id;
    if not found or model_record.organization_id <> new.organization_id then
      raise exception 'model_id must belong to the same organization as the inventory item'
        using errcode = '23503';
    end if;
    if new.product_id is not null and model_record.product_id <> new.product_id then
      raise exception 'model_id must match the selected product_id' using errcode = '23503';
    end if;
    if new.brand_id is not null and model_record.brand_id <> new.brand_id then
      raise exception 'model_id must match the selected brand_id' using errcode = '23503';
    end if;
    new.model := model_record.name;
  end if;

  if new.vendor_id is not null then
    select * into supplier_record
    from public.suppliers where suppliers.id = new.vendor_id;

    if not found or supplier_record.organization_id <> new.organization_id then
      raise exception 'supplier must belong to the same organization as the inventory item'
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

create or replace function public.set_inventory_transactions_receipt_details()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  organization_company_id uuid;
  receipt_vendor_id uuid;
  receipt_bill_no text;
begin
  select organizations.company_id into organization_company_id
  from public.organizations where organizations.id = new.organization_id;

  if not found then
    raise exception 'organization_id must reference an existing organization'
      using errcode = '23503';
  end if;
  if new.company_id is null then
    new.company_id := organization_company_id;
  elsif new.company_id is distinct from organization_company_id then
    raise exception 'company_id must match the inventory transaction organization'
      using errcode = '23503';
  end if;

  if new.transaction_type = 'stock_in'
    and new.reference_type = 'purchase_order'
    and new.reference_id is not null then
    select batch.vendor_id, batch.bill_no
    into receipt_vendor_id, receipt_bill_no
    from public.inventory_batches as batch
    where batch.organization_id = new.organization_id
      and batch.inventory_item_id = new.item_id
      and batch.purchase_order_id = new.reference_id
      and batch.received_date = coalesce(new.transaction_date, current_date)
      and batch.received_quantity = new.quantity
    order by batch.created_at desc, batch.id desc
    limit 1;
    new.vendor_id := coalesce(new.vendor_id, receipt_vendor_id);
    new.bill_no := coalesce(new.bill_no, receipt_bill_no);
  end if;

  if new.vendor_id is not null and not exists (
    select 1 from public.suppliers
    where suppliers.id = new.vendor_id
      and suppliers.organization_id = new.organization_id
  ) then
    raise exception 'supplier must belong to the same organization as the inventory transaction'
      using errcode = '23503';
  end if;

  new.bill_no := nullif(btrim(coalesce(new.bill_no, '')), '');
  return new;
end;
$$;

create or replace function public.inventory_batch_history(target_item_id uuid)
returns table (
  id uuid,
  inventory_item_id uuid,
  product_id uuid,
  purchase_order_id uuid,
  purchase_order_item_id uuid,
  vendor_id uuid,
  vendor_name text,
  received_quantity numeric,
  remaining_quantity numeric,
  actual_unit_purchase_price numeric,
  gst_percent numeric,
  bill_no text,
  received_date date,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  item_organization_id uuid;
  can_view_cost boolean;
begin
  select inventory_items.organization_id into item_organization_id
  from public.inventory_items where inventory_items.id = target_item_id;
  if item_organization_id is null then return; end if;

  if not public.is_super_admin() then
    if item_organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot view inventory batches for another organization'
        using errcode = '42501';
    end if;
    if not public.user_has_permission('inventory', 'view') then
      raise exception 'Missing inventory view permission' using errcode = '42501';
    end if;
  end if;

  can_view_cost := public.is_super_admin()
    or public.user_has_permission('product_pricing', 'view');

  return query
  select
    inventory_batches.id,
    inventory_batches.inventory_item_id,
    inventory_batches.product_id,
    inventory_batches.purchase_order_id,
    inventory_batches.purchase_order_item_id,
    inventory_batches.vendor_id,
    suppliers.supplier_name,
    inventory_batches.received_quantity,
    inventory_batches.remaining_quantity,
    case when can_view_cost then inventory_batches.actual_unit_purchase_price else null end,
    case when can_view_cost then inventory_batches.gst_percent else null end,
    inventory_batches.bill_no,
    inventory_batches.received_date,
    inventory_batches.notes,
    inventory_batches.created_at
  from public.inventory_batches
  left join public.suppliers on suppliers.id = inventory_batches.vendor_id
  where inventory_batches.inventory_item_id = target_item_id
  order by inventory_batches.received_date desc, inventory_batches.created_at desc;
end;
$$;

create or replace function public.purchase_order_public_rows(target_item_id uuid default null)
returns table (order_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := public.current_user_organization_id();
begin
  if not public.is_super_admin() and target_organization_id is null then
    raise exception 'No organization is assigned to this user' using errcode = '42501';
  end if;
  if not public.is_super_admin()
    and not public.user_has_permission('inventory', 'view') then
    raise exception 'Missing inventory view permission' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', purchase_orders.id,
    'organization_id', purchase_orders.organization_id,
    'purchase_code', purchase_orders.purchase_code,
    'vendor_id', purchase_orders.vendor_id,
    'order_date', purchase_orders.order_date,
    'expected_delivery_date', purchase_orders.expected_delivery_date,
    'status', purchase_orders.status,
    'subtotal', null,
    'gst_amount', null,
    'total_amount', null,
    'notes', purchase_orders.notes,
    'created_by', purchase_orders.created_by,
    'created_at', purchase_orders.created_at,
    'updated_at', purchase_orders.updated_at,
    'vendor', jsonb_build_object(
      'id', suppliers.id,
      'vendor_code', suppliers.supplier_code,
      'vendor_name', suppliers.supplier_name,
      'contact_person', suppliers.contact_person,
      'phone', suppliers.phone
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', purchase_order_items.id,
          'organization_id', purchase_order_items.organization_id,
          'purchase_order_id', purchase_order_items.purchase_order_id,
          'item_id', purchase_order_items.item_id,
          'quantity', purchase_order_items.quantity,
          'received_quantity', purchase_order_items.received_quantity,
          'unit_price', null,
          'gst_percent', null,
          'line_total', null,
          'created_at', purchase_order_items.created_at,
          'updated_at', purchase_order_items.updated_at,
          'item', jsonb_build_object(
            'id', inventory_items.id,
            'item_code', inventory_items.item_code,
            'item_name', inventory_items.item_name,
            'unit', inventory_items.unit,
            'brand', inventory_items.brand,
            'model', inventory_items.model
          )
        ) order by purchase_order_items.created_at
      )
      from public.purchase_order_items
      join public.inventory_items on inventory_items.id = purchase_order_items.item_id
      where purchase_order_items.purchase_order_id = purchase_orders.id
    ), '[]'::jsonb)
  )
  from public.purchase_orders
  left join public.suppliers on suppliers.id = purchase_orders.vendor_id
  where (
      public.is_super_admin()
      or purchase_orders.organization_id = target_organization_id
    )
    and (
      target_item_id is null
      or exists (
        select 1 from public.purchase_order_items
        where purchase_order_items.purchase_order_id = purchase_orders.id
          and purchase_order_items.item_id = target_item_id
      )
    )
  order by purchase_orders.created_at desc;
end;
$$;

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
    raise exception 'No organization is assigned to this user' using errcode = '42501';
  end if;
  if not public.is_super_admin()
    and not (
      public.user_has_permission('inventory', 'view')
      or public.user_has_permission('quotations', 'view')
    ) then
    raise exception 'Missing inventory item view permission' using errcode = '42501';
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
      when suppliers.id is null then null
      else jsonb_build_object('id', suppliers.id, 'name', suppliers.supplier_name)
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
  left join public.suppliers on suppliers.id = inventory_items.vendor_id
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

-- If the direct stock-add function is present, repoint its supplier validation
-- after the table split. This keeps the migration safe in environments where
-- the optional stock-add migration has not been deployed yet.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(pg_proc.oid)
  into function_definition
  from pg_proc
  join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
  where pg_namespace.nspname = 'public'
    and pg_proc.proname = 'add_inventory_stock'
  order by pg_proc.oid desc
  limit 1;

  if function_definition is not null then
    function_definition := replace(
      function_definition,
      'public.vendors%ROWTYPE',
      'public.suppliers%ROWTYPE'
    );
    function_definition := replace(
      function_definition,
      'public.vendors%rowtype',
      'public.suppliers%rowtype'
    );
    function_definition := replace(function_definition, 'FROM public.vendors', 'FROM public.suppliers');
    function_definition := replace(function_definition, 'from public.vendors', 'from public.suppliers');
    function_definition := replace(function_definition, 'vendors.id', 'suppliers.id');
    function_definition := replace(function_definition, 'vendors.organization_id', 'suppliers.organization_id');
    function_definition := replace(function_definition, 'vendors.status', 'suppliers.status');
    function_definition := replace(function_definition, 'vendors.archived_at', 'suppliers.archived_at');
    execute function_definition;
  end if;
end;
$$;

notify pgrst, 'reload schema';
