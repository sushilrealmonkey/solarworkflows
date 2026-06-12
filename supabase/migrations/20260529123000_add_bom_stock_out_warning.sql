create or replace function public.update_project_status(target_project_id uuid, new_status text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
  quotation_record public.quotations%rowtype;
  current_profile_id uuid;
  inserted_count integer := 0;
  out_of_stock_warning text;
begin
  if new_status not in (
    'created',
    'material_pending',
    'material_dispatched',
    'installation_scheduled',
    'installation_in_progress',
    'installation_completed',
    'inspection_pending',
    'inspection_completed',
    'net_metering_pending',
    'commissioned',
    'cancelled',
    'on_hold'
  ) then
    raise exception 'Unsupported project status: %', new_status
      using errcode = '23514';
  end if;

  select *
  into project_record
  from public.projects
  where projects.id = target_project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if project_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot update a project from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('projects', 'update') then
      raise exception 'Missing projects update permission'
        using errcode = '42501';
    end if;

    if new_status = 'material_dispatched'
      and not public.user_has_permission('inventory', 'create') then
      raise exception 'Missing inventory create permission'
        using errcode = '42501';
    end if;
  end if;

  if new_status = 'material_dispatched' then
    if project_record.quotation_id is null then
      raise exception 'A linked quotation is required to dispatch BOM material. BOM stock out entry is not placed.'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.inventory_transactions
      where inventory_transactions.project_id = project_record.id
        and inventory_transactions.transaction_type = 'stock_out'
        and inventory_transactions.reference_type = 'material_dispatched'
        and inventory_transactions.reference_id = project_record.id
    ) then
      select *
      into quotation_record
      from public.quotations
      where quotations.id = project_record.quotation_id
        and quotations.organization_id = project_record.organization_id;

      if not found then
        raise exception 'Linked quotation was not found for this project. BOM stock out entry is not placed.'
          using errcode = 'P0002';
      end if;

      with raw_bom as (
        select
          nullif(trim(coalesce(item.inventory_item_id, '')), '') as inventory_item_id,
          nullif(trim(coalesce(item.quantity, '')), '') as quantity_text
        from jsonb_to_recordset(coalesce(quotation_record.material_items, '[]'::jsonb))
          as item(inventory_item_id text, quantity text)
      ),
      bom_totals as (
        select
          raw_bom.inventory_item_id::uuid as item_id,
          sum(raw_bom.quantity_text::numeric) as quantity
        from raw_bom
        where raw_bom.inventory_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and raw_bom.quantity_text ~ '^[0-9]+(\.[0-9]+)?$'
          and raw_bom.quantity_text::numeric > 0
        group by raw_bom.inventory_item_id
      )
      select string_agg(
        format(
          '%s requires %s%s but only %s%s is available',
          coalesce(
            nullif(concat_ws(' / ', inventory_items.item_name, inventory_items.brand, inventory_items.model), ''),
            inventory_items.item_code,
            'Inventory item'
          ),
          bom_totals.quantity,
          coalesce(' ' || nullif(inventory_items.unit, ''), ''),
          coalesce(inventory_items.current_stock, 0),
          coalesce(' ' || nullif(inventory_items.unit, ''), '')
        ),
        E'\n'
      )
      into out_of_stock_warning
      from bom_totals
      join public.inventory_items
        on inventory_items.id = bom_totals.item_id
       and inventory_items.organization_id = project_record.organization_id
      where coalesce(inventory_items.current_stock, 0) < bom_totals.quantity;

      if out_of_stock_warning is not null then
        raise exception 'Out of stock warning:% % BOM stock out entry is not placed.',
          E'\n' || out_of_stock_warning,
          E'\n'
          using errcode = '23514';
      end if;

      select users_profile.id
      into current_profile_id
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
      limit 1;

      with raw_bom as (
        select
          nullif(trim(coalesce(item.inventory_item_id, '')), '') as inventory_item_id,
          nullif(trim(coalesce(item.quantity, '')), '') as quantity_text
        from jsonb_to_recordset(coalesce(quotation_record.material_items, '[]'::jsonb))
          as item(inventory_item_id text, quantity text)
      ),
      bom_totals as (
        select
          raw_bom.inventory_item_id::uuid as item_id,
          sum(raw_bom.quantity_text::numeric) as quantity
        from raw_bom
        where raw_bom.inventory_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and raw_bom.quantity_text ~ '^[0-9]+(\.[0-9]+)?$'
          and raw_bom.quantity_text::numeric > 0
        group by raw_bom.inventory_item_id
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
        project_record.organization_id,
        inventory_items.id,
        project_record.id,
        'stock_out',
        bom_totals.quantity,
        current_date,
        'material_dispatched',
        project_record.id,
        'Auto stock out for material dispatched from quotation BOM',
        current_profile_id
      from bom_totals
      join public.inventory_items
        on inventory_items.id = bom_totals.item_id
       and inventory_items.organization_id = project_record.organization_id;

      get diagnostics inserted_count = row_count;

      if inserted_count = 0 then
        raise exception 'No inventory-linked BOM items found to dispatch. BOM stock out entry is not placed.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  update public.projects
  set
    project_status = new_status,
    completed_at = case
      when new_status in ('installation_completed', 'commissioned')
        then coalesce(public.projects.completed_at, now())
      else public.projects.completed_at
    end,
    updated_at = now()
  where public.projects.id = target_project_id
  returning * into project_record;

  return project_record;
end;
$$;

grant execute on function public.update_project_status(uuid, text) to authenticated;
