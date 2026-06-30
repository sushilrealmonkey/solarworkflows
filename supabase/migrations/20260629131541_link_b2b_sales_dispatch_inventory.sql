create or replace function public.dispatch_b2b_sale(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  current_profile_id uuid;
  stock_warning text;
  inserted_count integer := 0;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = target_sale_id
  for update;

  if not found then
    raise exception 'B2B sale not found'
      using errcode = 'P0002';
  end if;

  if sale_record.status = 'dispatched' then
    raise exception 'B2B sale is already dispatched'
      using errcode = '23514';
  end if;

  if sale_record.status <> 'confirmed' then
    raise exception 'Confirm the B2B sale before dispatch'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('b2b_sales', 'update')
      or not (
        public.user_has_permission('inventory', 'create')
        or public.user_has_permission('inventory', 'update')
      )
    ) then
    raise exception 'Missing permission to dispatch B2B sale'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.inventory_transactions
    where inventory_transactions.reference_type = 'b2b_sale'
      and inventory_transactions.reference_id = sale_record.id
      and inventory_transactions.transaction_type = 'stock_out'
  ) then
    raise exception 'Stock out has already been recorded for this B2B sale'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
      and b2b_sale_items.organization_id = sale_record.organization_id
  ) then
    raise exception 'Add at least one item before dispatching a B2B sale'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.b2b_sale_items
    join public.inventory_items
      on inventory_items.id = b2b_sale_items.inventory_item_id
    where b2b_sale_items.b2b_sale_id = sale_record.id
      and b2b_sale_items.organization_id = sale_record.organization_id
      and inventory_items.organization_id <> sale_record.organization_id
  ) then
    raise exception 'B2B sale items must use inventory from the same organization'
      using errcode = '23503';
  end if;

  with stock_lines as (
    select
      b2b_sale_items.inventory_item_id,
      sum(b2b_sale_items.quantity) as quantity
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
      and b2b_sale_items.organization_id = sale_record.organization_id
    group by b2b_sale_items.inventory_item_id
  )
  select string_agg(
    format(
      '%s needs %s%s but only %s%s is available',
      coalesce(
        nullif(concat_ws(' / ', inventory_items.item_name, inventory_items.brand, inventory_items.model), ''),
        inventory_items.item_code,
        'Inventory item'
      ),
      stock_lines.quantity,
      coalesce(' ' || nullif(inventory_items.unit, ''), ''),
      public.inventory_item_available_quantity(inventory_items.id, null),
      coalesce(' ' || nullif(inventory_items.unit, ''), '')
    ),
    E'\n'
  )
  into stock_warning
  from stock_lines
  join public.inventory_items
    on inventory_items.id = stock_lines.inventory_item_id
   and inventory_items.organization_id = sale_record.organization_id
  where public.inventory_item_available_quantity(inventory_items.id, null) < stock_lines.quantity;

  if stock_warning is not null then
    raise exception 'Out of stock warning:% % B2B dispatch was not recorded.',
      E'\n' || stock_warning,
      E'\n'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  with stock_lines as (
    select
      b2b_sale_items.inventory_item_id,
      sum(b2b_sale_items.quantity) as quantity
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
      and b2b_sale_items.organization_id = sale_record.organization_id
    group by b2b_sale_items.inventory_item_id
  )
  insert into public.inventory_transactions (
    organization_id,
    item_id,
    project_id,
    transaction_type,
    quantity,
    transaction_date,
    reference_type,
    reference_id,
    notes,
    created_by
  )
  select
    sale_record.organization_id,
    inventory_items.id,
    null,
    'stock_out',
    stock_lines.quantity,
    current_date,
    'b2b_sale',
    sale_record.id,
    'B2B sale dispatch: ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  from stock_lines
  join public.inventory_items
    on inventory_items.id = stock_lines.inventory_item_id
   and inventory_items.organization_id = sale_record.organization_id;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    raise exception 'Add at least one item before dispatching a B2B sale'
      using errcode = '23514';
  end if;

  update public.b2b_sales
  set
    status = 'dispatched',
    dispatch_date = coalesce(dispatch_date, current_date),
    updated_at = now()
  where b2b_sales.id = sale_record.id
  returning * into sale_record;

  return sale_record;
end;
$$;

revoke execute on function public.dispatch_b2b_sale(uuid) from public;
grant execute on function public.dispatch_b2b_sale(uuid) to authenticated;

notify pgrst, 'reload schema';
