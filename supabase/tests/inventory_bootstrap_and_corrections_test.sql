begin;
select plan(28);

create temp table inventory_flow_test_ids (
  key text primary key,
  id uuid not null
);

create temp table inventory_flow_test_flags (
  key text primary key,
  value boolean not null
);

with inserted as (
  insert into public.companies (company_name, company_slug, status)
  values ('Inventory Flow Test Company', 'inventory-flow-test-company', 'active')
  returning id
)
insert into inventory_flow_test_ids select 'company', id from inserted;

with inserted as (
  insert into public.organizations (name, slug, status, company_id)
  select 'Inventory Flow Test Organization', 'inventory-flow-test-org', 'active', id
  from inventory_flow_test_ids where key = 'company'
  returning id
)
insert into inventory_flow_test_ids select 'organization', id from inserted;

do $$
begin
  perform public.seed_epc_standard_roles(
    (select id from inventory_flow_test_ids where key = 'organization')
  );
end;
$$;

update public.roles
set company_id = (select id from inventory_flow_test_ids where key = 'company')
where organization_id = (select id from inventory_flow_test_ids where key = 'organization');

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
    'inventory-flow-test@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  returning id
)
insert into inventory_flow_test_ids select 'auth_user', id from inserted;

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
    'Inventory Flow Test Admin',
    'inventory-flow-test@example.invalid',
    'active',
    true
  from inventory_flow_test_ids auth_user
  cross join inventory_flow_test_ids organization
  cross join inventory_flow_test_ids company
  where auth_user.key = 'auth_user'
    and organization.key = 'organization'
    and company.key = 'company'
  returning id
)
insert into inventory_flow_test_ids select 'profile', id from inserted;

insert into public.user_roles (user_profile_id, user_id, role_id)
select
  profile.id,
  auth_user.id,
  roles.id
from inventory_flow_test_ids profile
cross join inventory_flow_test_ids auth_user
join public.roles
  on roles.organization_id = (
    select id from inventory_flow_test_ids where key = 'organization'
  )
 and roles.role_key = 'admin'
where profile.key = 'profile'
  and auth_user.key = 'auth_user';

with inserted as (
  insert into public.product_categories (tenant_id, name, category_type)
  select id, 'Inventory Flow Test Panels', 'SOLAR_PANEL'::public.product_category_type
  from inventory_flow_test_ids where key = 'organization'
  returning id
)
insert into inventory_flow_test_ids select 'category', id from inserted;

do $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    (select id::text from inventory_flow_test_ids where key = 'auth_user'),
    true
  );
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select id from inventory_flow_test_ids where key = 'auth_user'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$$;

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
    'FLOW-PANEL-001',
    'Inventory Flow Test Panel',
    category.id,
    'piece',
    'active'
  from inventory_flow_test_ids organization
  cross join inventory_flow_test_ids category
  where organization.key = 'organization'
    and category.key = 'category'
  returning id
)
insert into inventory_flow_test_ids select 'product', id from inserted;

insert into inventory_flow_test_ids (key, id)
select 'inventory_item', inventory_items.id
from public.inventory_items
where inventory_items.catalog_product_id = (
  select id from inventory_flow_test_ids where key = 'product'
);

select ok(
  (select id is not null from inventory_flow_test_ids where key = 'inventory_item'),
  'creating an active product automatically creates inventory'
);

select is(
  (
    select count(*)::integer
    from public.inventory_items
    where catalog_product_id = (select id from inventory_flow_test_ids where key = 'product')
      and status = 'active'
  ),
  1,
  'a product has exactly one active inventory row'
);

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  0::numeric,
  'automatic inventory starts at zero stock'
);

select is(
  (
    select count(*)::integer
    from public.inventory_opening_balance_candidates()
    where inventory_item_id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  1,
  'new zero-stock inventory is eligible for opening balance'
);

do $$
begin
  perform public.set_inventory_opening_balances(
    jsonb_build_array(
      jsonb_build_object(
        'inventory_item_id', (select id from inventory_flow_test_ids where key = 'inventory_item'),
        'quantity', 5
      )
    ),
    current_date,
    'Initial warehouse count'
  );
end;
$$;

select is(
  (
    select opening_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  5::numeric,
  'opening balance records opening_stock'
);

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  5::numeric,
  'opening balance increases physical stock through the ledger'
);

select is(
  (
    select count(*)::integer
    from public.inventory_transactions
    where item_id = (select id from inventory_flow_test_ids where key = 'inventory_item')
      and transaction_type = 'stock_in'
      and reference_type = 'opening_balance'
      and quantity = 5
  ),
  1,
  'opening balance creates a labelled stock-in transaction'
);

select is(
  (
    select count(*)::integer
    from public.inventory_opening_balance_candidates()
    where inventory_item_id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  0,
  'an initialized item is no longer an opening balance candidate'
);

do $$
begin
  begin
    perform public.set_inventory_opening_balances(
      jsonb_build_array(
        jsonb_build_object(
          'inventory_item_id', (select id from inventory_flow_test_ids where key = 'inventory_item'),
          'quantity', 1
        )
      ),
      current_date,
      'Repeated opening count'
    );
    insert into inventory_flow_test_flags values ('repeat_opening_rejected', false);
  exception when sqlstate '23514' then
    insert into inventory_flow_test_flags values ('repeat_opening_rejected', true);
  end;
end;
$$;

select ok(
  (select value from inventory_flow_test_flags where key = 'repeat_opening_rejected'),
  'an opening balance cannot be applied after ledger history exists'
);

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
    'FLOW-PANEL-PO-001',
    'Inventory Flow Purchase Panel',
    category.id,
    'piece',
    'active'
  from inventory_flow_test_ids organization
  cross join inventory_flow_test_ids category
  where organization.key = 'organization'
    and category.key = 'category'
  returning id
)
insert into inventory_flow_test_ids select 'purchase_product', id from inserted;

insert into inventory_flow_test_ids (key, id)
select 'purchase_inventory_item', inventory_items.id
from public.inventory_items
where inventory_items.catalog_product_id = (
  select id from inventory_flow_test_ids where key = 'purchase_product'
);

select ok(
  (select id is not null from inventory_flow_test_ids where key = 'purchase_inventory_item'),
  'a fresh Product Master item is immediately available to purchasing'
);

with inserted as (
  insert into public.vendors (organization_id, vendor_name, vendor_type, status)
  select id, 'Inventory Flow Test Supplier', 'supplier', 'active'
  from inventory_flow_test_ids where key = 'organization'
  returning id
)
insert into inventory_flow_test_ids select 'vendor', id from inserted;

with inserted as (
  insert into public.purchase_orders (
    organization_id,
    vendor_id,
    order_date,
    status,
    created_by
  )
  select
    organization.id,
    vendor.id,
    current_date,
    'ordered',
    profile.id
  from inventory_flow_test_ids organization
  cross join inventory_flow_test_ids vendor
  cross join inventory_flow_test_ids profile
  where organization.key = 'organization'
    and vendor.key = 'vendor'
    and profile.key = 'profile'
  returning id
)
insert into inventory_flow_test_ids select 'purchase_order', id from inserted;

with inserted as (
  insert into public.purchase_order_items (
    organization_id,
    purchase_order_id,
    item_id,
    quantity,
    unit_price,
    gst_percent,
    line_total
  )
  select
    organization.id,
    purchase_order.id,
    inventory_item.id,
    4,
    100,
    0,
    400
  from inventory_flow_test_ids organization
  cross join inventory_flow_test_ids purchase_order
  cross join inventory_flow_test_ids inventory_item
  where organization.key = 'organization'
    and purchase_order.key = 'purchase_order'
    and inventory_item.key = 'purchase_inventory_item'
  returning id
)
insert into inventory_flow_test_ids select 'purchase_order_item', id from inserted;

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'purchase_inventory_item')
  ),
  0::numeric,
  'creating a purchase order does not change stock'
);

do $$
begin
  perform public.receive_purchase_order_items(
    (select id from inventory_flow_test_ids where key = 'purchase_order'),
    jsonb_build_array(
      jsonb_build_object(
        'purchase_order_item_id', (select id from inventory_flow_test_ids where key = 'purchase_order_item'),
        'received_quantity', 2,
        'actual_unit_purchase_price', 100,
        'gst_percent', 0,
        'update_current_purchase_price', false
      )
    ),
    'FLOW-BILL-001',
    current_date,
    'Partial receipt'
  );
end;
$$;

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'purchase_inventory_item')
  ),
  2::numeric,
  'partial Material Received increases stock by only the received quantity'
);

select is(
  (
    select status
    from public.purchase_orders
    where id = (select id from inventory_flow_test_ids where key = 'purchase_order')
  ),
  'partially_received',
  'partial Material Received keeps the purchase order open'
);

select ok(
  (
    select received_quantity = 2
      and last_received_at is not null
    from public.purchase_order_items
    where id = (select id from inventory_flow_test_ids where key = 'purchase_order_item')
  ),
  'Material Received advances purchase-line receipt quantity and timestamp'
);

do $$
begin
  perform public.receive_purchase_order_items(
    (select id from inventory_flow_test_ids where key = 'purchase_order'),
    jsonb_build_array(
      jsonb_build_object(
        'purchase_order_item_id', (select id from inventory_flow_test_ids where key = 'purchase_order_item'),
        'received_quantity', 2,
        'actual_unit_purchase_price', 100,
        'gst_percent', 0,
        'update_current_purchase_price', false
      )
    ),
    'FLOW-BILL-002',
    current_date,
    'Final receipt'
  );
end;
$$;

select ok(
  (
    select inventory_items.current_stock = 4
      and purchase_orders.status = 'received'
      and (
        select count(*)
        from public.inventory_items
        where catalog_product_id = (
          select id from inventory_flow_test_ids where key = 'purchase_product'
        )
      ) = 1
    from public.inventory_items
    cross join public.purchase_orders
    where inventory_items.id = (
      select id from inventory_flow_test_ids where key = 'purchase_inventory_item'
    )
      and purchase_orders.id = (
        select id from inventory_flow_test_ids where key = 'purchase_order'
      )
  ),
  'final Material Received completes the order on the same inventory row'
);

do $$
begin
  perform public.update_received_purchase_order(
    (select id from inventory_flow_test_ids where key = 'purchase_order'),
    'FLOW-BILL-REVISED',
    current_date + 7,
    'Receipt paperwork updated'
  );
end;
$$;

select ok(
  (
    select purchase_orders.expected_delivery_date = current_date + 7
      and purchase_orders.notes = 'Receipt paperwork updated'
      and not exists (
        select 1
        from public.inventory_batches
        where inventory_batches.purchase_order_id = purchase_orders.id
          and inventory_batches.bill_no is distinct from 'FLOW-BILL-REVISED'
      )
    from public.purchase_orders
    where purchase_orders.id = (
      select id from inventory_flow_test_ids where key = 'purchase_order'
    )
  ),
  'received PO edit updates allowed header fields and every receipt bill number'
);

select ok(
  not exists (
    select 1
    from public.inventory_transactions
    where inventory_transactions.reference_type = 'purchase_order'
      and inventory_transactions.reference_id = (
        select id from inventory_flow_test_ids where key = 'purchase_order'
      )
      and inventory_transactions.transaction_type = 'stock_in'
      and inventory_transactions.bill_no is distinct from 'FLOW-BILL-REVISED'
  ),
  'received PO bill edit keeps inventory ledger metadata in sync'
);

select is(
  public.purchase_order_bill_invoice_no(
    (select id from inventory_flow_test_ids where key = 'purchase_order')
  ),
  'FLOW-BILL-REVISED',
  'PO detail retrieves the corrected bill or invoice number through its controlled RPC'
);

do $$
begin
  perform public.correct_inventory_stock(
    (select id from inventory_flow_test_ids where key = 'inventory_item'),
    7,
    current_date,
    'Counted two additional units'
  );
end;
$$;

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  7::numeric,
  'positive correction sets stock to the counted total'
);

select is(
  (
    select quantity
    from public.inventory_transactions
    where item_id = (select id from inventory_flow_test_ids where key = 'inventory_item')
      and reference_type = 'stock_correction'
    order by created_at desc
    limit 1
  ),
  2::numeric,
  'positive correction records only the calculated difference'
);

do $$
begin
  perform public.correct_inventory_stock(
    (select id from inventory_flow_test_ids where key = 'inventory_item'),
    3,
    current_date,
    'Counted fewer units'
  );
end;
$$;

select is(
  (
    select current_stock
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  3::numeric,
  'negative correction sets stock to the counted total'
);

select is(
  (
    select quantity
    from public.inventory_transactions
    where item_id = (select id from inventory_flow_test_ids where key = 'inventory_item')
      and reference_type = 'stock_correction'
    order by created_at desc
    limit 1
  ),
  (-4)::numeric,
  'negative correction records a signed adjustment'
);

do $$
begin
  begin
    perform public.correct_inventory_stock(
      (select id from inventory_flow_test_ids where key = 'inventory_item'),
      3,
      current_date,
      'No difference'
    );
    insert into inventory_flow_test_flags values ('no_change_rejected', false);
  exception when sqlstate '23514' then
    insert into inventory_flow_test_flags values ('no_change_rejected', true);
  end;

  begin
    perform public.correct_inventory_stock(
      (select id from inventory_flow_test_ids where key = 'inventory_item'),
      4,
      current_date,
      ''
    );
    insert into inventory_flow_test_flags values ('blank_reason_rejected', false);
  exception when sqlstate '23514' then
    insert into inventory_flow_test_flags values ('blank_reason_rejected', true);
  end;
end;
$$;

select ok(
  (select value from inventory_flow_test_flags where key = 'no_change_rejected'),
  'a correction with no stock difference is rejected'
);

select ok(
  (select value from inventory_flow_test_flags where key = 'blank_reason_rejected'),
  'a correction requires a reason'
);

update public.products
set status = 'inactive'
where id = (select id from inventory_flow_test_ids where key = 'product');

select is(
  (
    select status
    from public.inventory_items
    where id = (select id from inventory_flow_test_ids where key = 'inventory_item')
  ),
  'inactive',
  'Product Master status synchronizes to inventory'
);

update public.products
set status = 'active'
where id = (select id from inventory_flow_test_ids where key = 'product');

select is(
  (
    select id
    from public.inventory_items
    where catalog_product_id = (select id from inventory_flow_test_ids where key = 'product')
      and status = 'active'
  ),
  (select id from inventory_flow_test_ids where key = 'inventory_item'),
  'reactivation reuses the original inventory row'
);

select ok(
  not has_table_privilege('authenticated', 'public.inventory_items', 'insert')
    and not has_table_privilege('authenticated', 'public.inventory_items', 'delete')
    and not has_table_privilege('authenticated', 'public.inventory_transactions', 'insert')
    and not has_table_privilege('authenticated', 'public.inventory_transactions', 'update')
    and not has_table_privilege('authenticated', 'public.inventory_transactions', 'delete'),
  'authenticated clients cannot directly create or remove inventory identity or mutate ledger rows'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.set_inventory_opening_balances(jsonb,date,text)',
    'execute'
  )
    and has_function_privilege(
      'authenticated',
      'public.correct_inventory_stock(uuid,numeric,date,text)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.correct_inventory_stock(uuid,numeric,date,text)',
      'execute'
    ),
  'controlled stock RPC execution is granted only to authenticated users'
);

select * from finish();
rollback;
