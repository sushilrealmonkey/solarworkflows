BEGIN;
SELECT plan(20);

CREATE TEMP TABLE reservation_test_ids (
  key text PRIMARY KEY,
  id uuid NOT NULL
);

CREATE TEMP TABLE reservation_test_flags (
  key text PRIMARY KEY,
  value boolean NOT NULL
);

WITH inserted AS (
  INSERT INTO public.organizations (name, slug, status)
  VALUES ('Reservation Test Org', 'reservation-test-org', 'active')
  RETURNING id
)
INSERT INTO reservation_test_ids (key, id)
SELECT 'org', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.customers (organization_id, full_name, phone, status)
  SELECT id, 'Reservation Test Customer', '9000000000', 'active'
  FROM reservation_test_ids
  WHERE key = 'org'
  RETURNING id
)
INSERT INTO reservation_test_ids (key, id)
SELECT 'customer', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.product_categories (tenant_id, name, category_type)
  SELECT id, 'Reservation Test Panels', 'SOLAR_PANEL'::public.product_category_type
  FROM reservation_test_ids
  WHERE key = 'org'
  RETURNING id
)
INSERT INTO reservation_test_ids (key, id)
SELECT 'category', id FROM inserted;

CREATE FUNCTION pg_temp.create_reservation_test_product(
  product_code text,
  product_name text,
  stock_qty numeric default null
)
RETURNS TABLE(product_id uuid, item_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  next_product_id uuid;
  next_item_id uuid;
  target_org_id uuid;
  target_category_id uuid;
BEGIN
  SELECT id INTO target_org_id FROM reservation_test_ids WHERE key = 'org';
  SELECT id INTO target_category_id FROM reservation_test_ids WHERE key = 'category';

  INSERT INTO public.products (
    tenant_id,
    product_code,
    product_name,
    category_id,
    unit,
    status
  )
  VALUES (
    target_org_id,
    product_code,
    product_name,
    target_category_id,
    'nos',
    'active'
  )
  RETURNING id INTO next_product_id;

  IF stock_qty IS NOT NULL THEN
    INSERT INTO public.inventory_items (
      organization_id,
      catalog_product_id,
      current_stock,
      opening_stock,
      minimum_stock,
      status
    )
    VALUES (
      target_org_id,
      next_product_id,
      stock_qty,
      stock_qty,
      0,
      'active'
    )
    RETURNING id INTO next_item_id;
  END IF;

  RETURN QUERY SELECT next_product_id, next_item_id;
END;
$$;

CREATE FUNCTION pg_temp.create_reservation_test_quote(
  quote_code text,
  target_product_id uuid,
  quantities numeric[]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  next_quotation_id uuid;
  target_org_id uuid;
  target_customer_id uuid;
BEGIN
  SELECT id INTO target_org_id FROM reservation_test_ids WHERE key = 'org';
  SELECT id INTO target_customer_id FROM reservation_test_ids WHERE key = 'customer';

  INSERT INTO public.quotations (
    organization_id,
    customer_id,
    quotation_code,
    status,
    material_items
  )
  SELECT
    target_org_id,
    target_customer_id,
    quote_code,
    'accepted',
    jsonb_agg(
      jsonb_build_object(
        'product_id', target_product_id::text,
        'quantity', quantity_value::text,
        'description', quote_code || ' line ' || line_number::text
      )
      ORDER BY line_number
    )
  FROM unnest(quantities) WITH ORDINALITY AS quote_lines(quantity_value, line_number)
  RETURNING id INTO next_quotation_id;

  RETURN next_quotation_id;
END;
$$;

DO $$
DECLARE
  target_org_id uuid;
  next_product_id uuid;
  next_item_id uuid;
  next_quotation_id uuid;
  stock_lowered_item_id uuid;
BEGIN
  SELECT id INTO target_org_id FROM reservation_test_ids WHERE key = 'org';

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('FULL-ACTIVE', 'Full active stock panel', 10);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-FULL-ACTIVE', next_product_id, ARRAY[6::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('FULL-STOCK', 'Full stock panel', 10);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-FULL', next_product_id, ARRAY[6::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  PERFORM public.release_inventory_reservations_for_quotation(next_quotation_id, 'quotation_rejected');

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('PARTIAL-STOCK', 'Partial stock panel', 4);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-PARTIAL', next_product_id, ARRAY[10::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('ZERO-STOCK', 'Zero stock panel', 0);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-ZERO', next_product_id, ARRAY[5::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('NO-MAP', 'No mapped inventory panel', null);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-NO-MAP', next_product_id, ARRAY[3::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('EXISTING-HELD', 'Existing held panel', 10);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-EXISTING-ONE', next_product_id, ARRAY[7::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-EXISTING-TWO', next_product_id, ARRAY[5::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('DUPLICATE-LINES', 'Duplicate line panel', 10);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-DUPLICATE', next_product_id, ARRAY[7::numeric, 7::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  SELECT product_id, item_id
  INTO next_product_id, next_item_id
  FROM pg_temp.create_reservation_test_product('DIRECT-GUARD', 'Direct guard panel', 5);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-DIRECT-GUARD', next_product_id, ARRAY[1::numeric]);

  BEGIN
    INSERT INTO public.inventory_reservations (
      organization_id,
      quotation_id,
      inventory_item_id,
      required_qty,
      reserved_qty,
      shortage_qty,
      status
    )
    VALUES (
      target_org_id,
      next_quotation_id,
      next_item_id,
      6,
      6,
      0,
      'active'
    );
    INSERT INTO reservation_test_flags VALUES ('direct_over_reservation_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO reservation_test_flags
    VALUES ('direct_over_reservation_blocked', SQLSTATE = '23514');
  END;

  SELECT product_id, item_id
  INTO next_product_id, stock_lowered_item_id
  FROM pg_temp.create_reservation_test_product('LOWERED-DISPATCH', 'Lowered dispatch panel', 5);
  next_quotation_id := pg_temp.create_reservation_test_quote('Q-LOWERED-DISPATCH', next_product_id, ARRAY[5::numeric]);
  PERFORM public.sync_inventory_reservations_for_quotation(next_quotation_id);

  UPDATE public.inventory_items
  SET current_stock = 3
  WHERE id = stock_lowered_item_id;

  BEGIN
    INSERT INTO public.inventory_transactions (
      organization_id,
      item_id,
      transaction_type,
      quantity,
      transaction_date,
      reference_type,
      reference_id,
      notes
    )
    VALUES (
      target_org_id,
      stock_lowered_item_id,
      'stock_out',
      5,
      current_date,
      'material_dispatched',
      next_quotation_id,
      'Test lowered stock dispatch'
    );
    INSERT INTO reservation_test_flags VALUES ('lowered_stock_dispatch_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO reservation_test_flags
    VALUES ('lowered_stock_dispatch_blocked', SQLSTATE = '23514');
  END;
END;
$$;

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-FULL-ACTIVE')),
  'active',
  'full stock creates an active reservation'
);

SELECT is(
  (SELECT reserved_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-FULL-ACTIVE')),
  6::numeric,
  'full stock reserves the required quantity'
);

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-FULL')),
  'released',
  'released quotation reservations are marked released'
);

SELECT is(
  (SELECT reserved_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-FULL')),
  0::numeric,
  'released quotation reservations hold zero quantity'
);

SELECT is(
  (SELECT current_stock FROM public.inventory_items WHERE catalog_product_id = (SELECT id FROM public.products WHERE product_code = 'FULL-STOCK')),
  10::numeric,
  'reservation does not reduce physical current stock'
);

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-PARTIAL')),
  'partial',
  'low stock creates a partial reservation'
);

SELECT is(
  (SELECT reserved_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-PARTIAL')),
  4::numeric,
  'partial reservation holds only available stock'
);

SELECT is(
  (SELECT shortage_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-PARTIAL')),
  6::numeric,
  'partial reservation records the remaining shortage'
);

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-ZERO')),
  'shortage',
  'zero stock creates a shortage reservation'
);

SELECT is(
  (SELECT reserved_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-ZERO')),
  0::numeric,
  'zero stock reserves nothing'
);

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-NO-MAP')),
  'shortage',
  'unmapped products create shortage reservations'
);

SELECT ok(
  (SELECT inventory_item_id IS NULL FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-NO-MAP')),
  'unmapped shortage keeps inventory item empty'
);

SELECT is(
  (SELECT status FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-EXISTING-TWO')),
  'partial',
  'existing reservations reduce availability for later quotations'
);

SELECT is(
  (SELECT reserved_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-EXISTING-TWO')),
  3::numeric,
  'later quotation reserves only remaining stock'
);

SELECT is(
  (SELECT shortage_qty FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-EXISTING-TWO')),
  2::numeric,
  'later quotation records shortage after prior hold'
);

SELECT is(
  (SELECT count(*)::integer FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-DUPLICATE')),
  2,
  'duplicate product lines create separate reservations'
);

SELECT is(
  (SELECT sum(reserved_qty) FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-DUPLICATE')),
  10::numeric,
  'duplicate product lines cannot over-reserve within one quotation'
);

SELECT is(
  (SELECT sum(shortage_qty) FROM public.inventory_reservations WHERE quotation_id = (SELECT id FROM public.quotations WHERE quotation_code = 'Q-DUPLICATE')),
  4::numeric,
  'duplicate product lines carry the unreserved shortage'
);

SELECT ok(
  (SELECT value FROM reservation_test_flags WHERE key = 'direct_over_reservation_blocked'),
  'direct writes cannot create over-reservations'
);

SELECT ok(
  (SELECT value FROM reservation_test_flags WHERE key = 'lowered_stock_dispatch_blocked'),
  'stock-out is blocked when physical stock falls below reserved dispatch quantity'
);

SELECT * FROM finish();
ROLLBACK;
