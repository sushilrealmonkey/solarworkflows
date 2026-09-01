begin;
select plan(13);

create temp table manual_stock_test_ids (
  key text primary key,
  id uuid not null
);

create temp table manual_stock_test_flags (
  key text primary key,
  value boolean not null
);

with inserted as (
  insert into public.companies (company_name, company_slug, status)
  values ('Manual Stock Test Company', 'manual-stock-test-company', 'active')
  returning id
)
insert into manual_stock_test_ids
select 'company', id from inserted;

with inserted as (
  insert into public.organizations (name, slug, status, company_id)
  select 'Manual Stock Test Organization', 'manual-stock-test-org', 'active', id
  from manual_stock_test_ids
  where key = 'company'
  returning id
)
insert into manual_stock_test_ids
select 'organization', id from inserted;

do $$
begin
  perform public.seed_epc_standard_roles(
    (select id from manual_stock_test_ids where key = 'organization')
  );
end;
$$;

update public.roles
set company_id = (select id from manual_stock_test_ids where key = 'company')
where organization_id = (select id from manual_stock_test_ids where key = 'organization');

with inserted as (
  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'manual-stock-test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  returning id
)
insert into manual_stock_test_ids
select 'auth_user', id from inserted;

with inserted as (
  insert into public.users_profile (
    auth_user_id,
    organization_id,
    company_id,
    full_name,
    email,
    status,
    email_verified
  )
  select
    auth_user.id,
    organization.id,
    company.id,
    'Manual Stock Test Admin',
    'manual-stock-test@example.invalid',
    'active',
    true
  from manual_stock_test_ids auth_user
  cross join manual_stock_test_ids organization
  cross join manual_stock_test_ids company
  where auth_user.key = 'auth_user'
    and organization.key = 'organization'
    and company.key = 'company'
  returning id
)
insert into manual_stock_test_ids
select 'profile', id from inserted;

insert into public.user_roles (user_profile_id, role_id)
select
  profile.id,
  roles.id
from manual_stock_test_ids profile
join public.roles
  on roles.organization_id = (
    select id from manual_stock_test_ids where key = 'organization'
  )
 and roles.role_key = 'admin'
where profile.key = 'profile';

do $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    (select id::text from manual_stock_test_ids where key = 'auth_user'),
    true
  );
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select id from manual_stock_test_ids where key = 'auth_user'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$$;

with inserted as (
  insert into public.product_categories (tenant_id, name, category_type)
  select id, 'Manual Stock Test Panels', 'SOLAR_PANEL'::public.product_category_type
  from manual_stock_test_ids
  where key = 'organization'
  returning id
)
insert into manual_stock_test_ids
select 'category', id from inserted;

with inserted as (
  insert into public.products (
    tenant_id,
    product_code,
    product_name,
    category_id,
    unit,
    status
  )
  select
    organization.id,
    'MANUAL-STOCK-001',
    'Manual Stock Test Panel',
    category.id,
    'piece',
    'active'
  from manual_stock_test_ids organization
  cross join manual_stock_test_ids category
  where organization.key = 'organization'
    and category.key = 'category'
  returning id
)
insert into manual_stock_test_ids
select 'product', id from inserted;

insert into manual_stock_test_ids (key, id)
select 'inventory_item', inventory_items.id
from public.inventory_items
where inventory_items.catalog_product_id = (
  select id from manual_stock_test_ids where key = 'product'
);

with inserted as (
  insert into public.vendors (organization_id, vendor_name, vendor_type, status)
  select id, 'Manual Stock Test Supplier', 'supplier', 'active'
  from manual_stock_test_ids
  where key = 'organization'
  returning id
)
insert into manual_stock_test_ids
select 'vendor', id from inserted;

select ok(
  (select id is not null from manual_stock_test_ids where key = 'inventory_item'),
  'active Product Master item has an inventory row'
);

select is(
  (
    public.add_inventory_stock(
      (select id from manual_stock_test_ids where key = 'inventory_item'),
      5,
      current_date,
      (select id from manual_stock_test_ids where key = 'vendor'),
      'MANUAL-BILL-001',
      125,
      18,
      'Received into the warehouse'
    )->>'quantity'
  )::numeric,
  5::numeric,
  'RPC returns the added quantity'
);

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from manual_stock_test_ids where key = 'inventory_item')
  ),
  5::numeric,
  'manual stock add increases physical stock exactly once'
);

select is(
  (
    select opening_stock
    from public.inventory_items
    where id = (select id from manual_stock_test_ids where key = 'inventory_item')
  ),
  0::numeric,
  'manual stock add does not change opening stock'
);

select ok(
  exists (
    select 1
    from public.inventory_batches
    where inventory_item_id = (select id from manual_stock_test_ids where key = 'inventory_item')
      and organization_id = (select id from manual_stock_test_ids where key = 'organization')
      and company_id = (select id from manual_stock_test_ids where key = 'company')
      and purchase_order_id is null
      and received_quantity = 5
      and remaining_quantity = 5
      and vendor_id = (select id from manual_stock_test_ids where key = 'vendor')
      and bill_no = 'MANUAL-BILL-001'
      and actual_unit_purchase_price = 125
      and gst_percent = 18
      and notes = 'Received into the warehouse'
  ),
  'manual stock add creates a traceable non-PO batch'
);

select ok(
  exists (
    select 1
    from public.inventory_transactions
    where item_id = (select id from manual_stock_test_ids where key = 'inventory_item')
      and company_id = (select id from manual_stock_test_ids where key = 'company')
      and transaction_type = 'stock_in'
      and quantity = 5
      and reference_type = 'manual_stock_in'
      and vendor_id = (select id from manual_stock_test_ids where key = 'vendor')
      and bill_no = 'MANUAL-BILL-001'
      and notes = 'Received into the warehouse'
  ),
  'manual stock add creates an append-only manual stock-in transaction'
);

select is(
  (
    select count(*)::integer
    from public.inventory_transactions
    where item_id = (select id from manual_stock_test_ids where key = 'inventory_item')
      and reference_type = 'manual_stock_in'
  ),
  1,
  'successful manual stock add creates one ledger row'
);

do $$
begin
  begin
    perform public.add_inventory_stock(
      (select id from manual_stock_test_ids where key = 'inventory_item'),
      0,
      current_date
    );
    insert into manual_stock_test_flags values ('zero_quantity_rejected', false);
  exception when sqlstate '23514' then
    insert into manual_stock_test_flags values ('zero_quantity_rejected', true);
  end;

  begin
    perform public.add_inventory_stock(
      (select id from manual_stock_test_ids where key = 'inventory_item'),
      1,
      current_date + 1
    );
    insert into manual_stock_test_flags values ('future_date_rejected', false);
  exception when sqlstate '23514' then
    insert into manual_stock_test_flags values ('future_date_rejected', true);
  end;
end;
$$;

select ok(
  (select value from manual_stock_test_flags where key = 'zero_quantity_rejected'),
  'zero quantity is rejected'
);

select ok(
  (select value from manual_stock_test_flags where key = 'future_date_rejected'),
  'future stock date is rejected'
);

select is(
  (
    select count(*)::integer
    from public.inventory_transactions
    where item_id = (select id from manual_stock_test_ids where key = 'inventory_item')
      and reference_type = 'manual_stock_in'
  ),
  1,
  'rejected manual stock requests do not create ledger rows'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.add_inventory_stock(uuid,numeric,date,uuid,text,numeric,numeric,text)',
    'execute'
  )
    and has_function_privilege(
      'authenticated',
      'public.add_inventory_stock(uuid,numeric,date,uuid,text,numeric,numeric,text)',
      'execute'
    ),
  'manual stock RPC is executable only by authenticated users'
);

select * from finish();
rollback;
