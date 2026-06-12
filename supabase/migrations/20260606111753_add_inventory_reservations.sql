-- Adds soft inventory reservations for accepted quotations.
-- Reservations hold available stock for an accepted quotation without reducing
-- physical current_stock until material dispatch creates stock-out ledger rows.

alter table public.inventory_items
add column if not exists catalog_product_id uuid references public.products(id) on delete set null;

create index if not exists inventory_items_catalog_product_id_idx
on public.inventory_items (catalog_product_id)
where catalog_product_id is not null;

-- Best-effort compatibility backfill. Existing inventory rows were created from
-- inventory masters, while quotation rows use products. Keep this conservative
-- and let users/admins correct unmapped rows later.
update public.inventory_items as inventory_items
set catalog_product_id = (
  select products.id
  from public.products
  where products.tenant_id = inventory_items.organization_id
    and lower(btrim(products.product_name)) = lower(btrim(inventory_items.item_name))
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
  order by
    case when lower(btrim(coalesce(products.brand, ''))) = lower(btrim(coalesce(inventory_items.brand, ''))) then 0 else 1 end,
    case when lower(btrim(coalesce(products.model_number, ''))) = lower(btrim(coalesce(inventory_items.model, ''))) then 0 else 1 end,
    products.created_at
  limit 1
)
where inventory_items.catalog_product_id is null
  and exists (
    select 1
    from public.products
    where products.tenant_id = inventory_items.organization_id
      and lower(btrim(products.product_name)) = lower(btrim(inventory_items.item_name))
  );

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  quotation_bom_item_id uuid references public.quotation_bom_items(id) on delete cascade,
  material_item_index integer,
  catalog_product_id uuid references public.products(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  required_qty numeric not null default 0,
  reserved_qty numeric not null default 0,
  shortage_qty numeric not null default 0,
  status text not null default 'active',
  source_event text not null default 'quotation_accepted',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_reservations add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.inventory_reservations add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.inventory_reservations add column if not exists quotation_id uuid references public.quotations(id) on delete cascade;
alter table public.inventory_reservations add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.inventory_reservations add column if not exists quotation_bom_item_id uuid references public.quotation_bom_items(id) on delete cascade;
alter table public.inventory_reservations add column if not exists material_item_index integer;
alter table public.inventory_reservations add column if not exists catalog_product_id uuid references public.products(id) on delete restrict;
alter table public.inventory_reservations add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict;
alter table public.inventory_reservations add column if not exists required_qty numeric default 0;
alter table public.inventory_reservations add column if not exists reserved_qty numeric default 0;
alter table public.inventory_reservations add column if not exists shortage_qty numeric default 0;
alter table public.inventory_reservations add column if not exists status text default 'active';
alter table public.inventory_reservations add column if not exists source_event text default 'quotation_accepted';
alter table public.inventory_reservations add column if not exists notes text;
alter table public.inventory_reservations add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.inventory_reservations add column if not exists created_at timestamptz default now();
alter table public.inventory_reservations add column if not exists updated_at timestamptz default now();

alter table public.inventory_reservations alter column organization_id set not null;
alter table public.inventory_reservations alter column quotation_id set not null;
alter table public.inventory_reservations alter column required_qty set not null;
alter table public.inventory_reservations alter column reserved_qty set not null;
alter table public.inventory_reservations alter column shortage_qty set not null;
alter table public.inventory_reservations alter column status set not null;
alter table public.inventory_reservations alter column source_event set not null;
alter table public.inventory_reservations alter column required_qty set default 0;
alter table public.inventory_reservations alter column reserved_qty set default 0;
alter table public.inventory_reservations alter column shortage_qty set default 0;
alter table public.inventory_reservations alter column status set default 'active';
alter table public.inventory_reservations alter column source_event set default 'quotation_accepted';
alter table public.inventory_reservations alter column created_at set default now();
alter table public.inventory_reservations alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_reservations_status_check'
      and conrelid = 'public.inventory_reservations'::regclass
  ) then
    alter table public.inventory_reservations
    add constraint inventory_reservations_status_check
    check (status in ('active', 'partial', 'shortage', 'released', 'converted'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_reservations_quantity_check'
      and conrelid = 'public.inventory_reservations'::regclass
  ) then
    alter table public.inventory_reservations
    add constraint inventory_reservations_quantity_check
    check (
      required_qty >= 0
      and reserved_qty >= 0
      and shortage_qty >= 0
      and reserved_qty <= required_qty
      and shortage_qty <= required_qty
    );
  end if;
end;
$$;

create index if not exists inventory_reservations_company_id_idx
on public.inventory_reservations (company_id)
where company_id is not null;

create index if not exists inventory_reservations_organization_id_idx
on public.inventory_reservations (organization_id);

create index if not exists inventory_reservations_quotation_id_idx
on public.inventory_reservations (quotation_id);

create index if not exists inventory_reservations_project_id_idx
on public.inventory_reservations (project_id)
where project_id is not null;

create index if not exists inventory_reservations_inventory_item_id_idx
on public.inventory_reservations (inventory_item_id)
where inventory_item_id is not null;

create index if not exists inventory_reservations_catalog_product_id_idx
on public.inventory_reservations (catalog_product_id)
where catalog_product_id is not null;

create index if not exists inventory_reservations_status_idx
on public.inventory_reservations (organization_id, status);

create unique index if not exists inventory_reservations_active_bom_item_unique
on public.inventory_reservations (quotation_bom_item_id)
where quotation_bom_item_id is not null
  and status in ('active', 'partial', 'shortage');

create unique index if not exists inventory_reservations_active_material_item_unique
on public.inventory_reservations (quotation_id, material_item_index)
where material_item_index is not null
  and status in ('active', 'partial', 'shortage');

drop trigger if exists set_inventory_reservations_updated_at on public.inventory_reservations;

create trigger set_inventory_reservations_updated_at
before update on public.inventory_reservations
for each row
execute function public.set_updated_at();

create or replace function public.inventory_item_reserved_quantity(
  target_item_id uuid,
  excluded_quotation_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(inventory_reservations.reserved_qty), 0)
  from public.inventory_reservations
  where inventory_reservations.inventory_item_id = target_item_id
    and inventory_reservations.status in ('active', 'partial')
    and (
      excluded_quotation_id is null
      or inventory_reservations.quotation_id <> excluded_quotation_id
    );
$$;

create or replace function public.inventory_item_available_quantity(
  target_item_id uuid,
  excluded_quotation_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce(inventory_items.current_stock, 0)
      - public.inventory_item_reserved_quantity(target_item_id, excluded_quotation_id),
    0
  )
  from public.inventory_items
  where inventory_items.id = target_item_id;
$$;

create or replace function public.reservation_company_id_for_quotation(
  quotation_record public.quotations
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_company_id uuid;
begin
  if quotation_record.created_by is not null then
    select profiles.company_id
    into resolved_company_id
    from public.profiles
    where profiles.id = quotation_record.created_by;
  end if;

  if resolved_company_id is null and auth.uid() is not null then
    select profiles.company_id
    into resolved_company_id
    from public.profiles
    where profiles.id = auth.uid();
  end if;

  return resolved_company_id;
end;
$$;

create or replace function public.find_inventory_item_for_reservation(
  target_organization_id uuid,
  target_catalog_product_id uuid,
  target_inventory_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_item_id uuid;
begin
  if target_inventory_item_id is not null then
    select inventory_items.id
    into resolved_item_id
    from public.inventory_items
    where inventory_items.id = target_inventory_item_id
      and inventory_items.organization_id = target_organization_id
      and inventory_items.status = 'active';

    if resolved_item_id is not null then
      return resolved_item_id;
    end if;
  end if;

  if target_catalog_product_id is null then
    return null;
  end if;

  select inventory_items.id
  into resolved_item_id
  from public.inventory_items
  where inventory_items.organization_id = target_organization_id
    and inventory_items.catalog_product_id = target_catalog_product_id
    and inventory_items.status = 'active'
  order by coalesce(inventory_items.current_stock, 0) desc, inventory_items.created_at
  limit 1;

  return resolved_item_id;
end;
$$;

create or replace function public.release_inventory_reservations_for_quotation(
  target_quotation_id uuid,
  release_reason text default 'quotation_released'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  released_count integer := 0;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    return 0;
  end if;

  if auth.uid() is not null
    and not public.is_super_admin()
    and quotation_record.organization_id <> public.current_user_organization_id() then
    raise exception 'Cannot release reservations for another organization'
      using errcode = '42501';
  end if;

  update public.inventory_reservations
  set
    status = 'released',
    reserved_qty = 0,
    shortage_qty = 0,
    source_event = coalesce(nullif(btrim(release_reason), ''), 'quotation_released'),
    updated_at = now()
  where inventory_reservations.quotation_id = quotation_record.id
    and inventory_reservations.organization_id = quotation_record.organization_id
    and inventory_reservations.status in ('active', 'partial', 'shortage');

  get diagnostics released_count = row_count;

  update public.quotation_bom_items
  set reserved_qty = 0, updated_at = now()
  where quotation_bom_items.quotation_id = quotation_record.id
    and quotation_bom_items.tenant_id = quotation_record.organization_id;

  return released_count;
end;
$$;

create or replace function public.sync_inventory_reservations_for_quotation(
  target_quotation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  reservation_company_id uuid;
  current_profile_id uuid;
  source_row record;
  selected_inventory_item_id uuid;
  available_qty numeric;
  next_reserved_qty numeric;
  next_shortage_qty numeric;
  next_status text;
  inserted_count integer := 0;
  bom_source_count integer := 0;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is not null and not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot reserve inventory for another organization quotation'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('quotations', 'update')
      or public.user_has_permission('inventory', 'update')
    ) then
      raise exception 'Missing permission to reserve inventory'
        using errcode = '42501';
    end if;
  end if;

  reservation_company_id := public.reservation_company_id_for_quotation(quotation_record);

  select profiles.id
  into current_profile_id
  from public.profiles
  where profiles.id = auth.uid();

  perform public.release_inventory_reservations_for_quotation(
    quotation_record.id,
    'quotation_reservation_refresh'
  );

  select count(*)
  into bom_source_count
  from public.quotation_bom_items
  where quotation_bom_items.quotation_id = quotation_record.id
    and quotation_bom_items.tenant_id = quotation_record.organization_id
    and quotation_bom_items.product_id is not null
    and coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) > 0;

  if bom_source_count > 0 then
    for source_row in
      select
        quotation_bom_items.id as quotation_bom_item_id,
        null::integer as material_item_index,
        quotation_bom_items.product_id as catalog_product_id,
        null::uuid as inventory_item_id,
        coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) as required_qty,
        coalesce(products.product_name, quotation_bom_items.item_name, 'Quotation BOM item') as item_label
      from public.quotation_bom_items
      left join public.products on products.id = quotation_bom_items.product_id
      where quotation_bom_items.quotation_id = quotation_record.id
        and quotation_bom_items.tenant_id = quotation_record.organization_id
        and quotation_bom_items.product_id is not null
        and coalesce(quotation_bom_items.required_qty, quotation_bom_items.quantity, 0) > 0
      order by quotation_bom_items.display_order, quotation_bom_items.created_at
    loop
      selected_inventory_item_id := public.find_inventory_item_for_reservation(
        quotation_record.organization_id,
        source_row.catalog_product_id,
        source_row.inventory_item_id
      );
      available_qty := case
        when selected_inventory_item_id is null then 0
        else public.inventory_item_available_quantity(selected_inventory_item_id, quotation_record.id)
      end;
      next_reserved_qty := least(source_row.required_qty, greatest(coalesce(available_qty, 0), 0));
      next_shortage_qty := greatest(source_row.required_qty - next_reserved_qty, 0);
      next_status := case
        when next_reserved_qty >= source_row.required_qty then 'active'
        when next_reserved_qty > 0 then 'partial'
        else 'shortage'
      end;

      insert into public.inventory_reservations (
        company_id,
        organization_id,
        quotation_id,
        project_id,
        quotation_bom_item_id,
        material_item_index,
        catalog_product_id,
        inventory_item_id,
        required_qty,
        reserved_qty,
        shortage_qty,
        status,
        source_event,
        notes,
        created_by
      )
      values (
        reservation_company_id,
        quotation_record.organization_id,
        quotation_record.id,
        null,
        source_row.quotation_bom_item_id,
        null,
        source_row.catalog_product_id,
        selected_inventory_item_id,
        source_row.required_qty,
        next_reserved_qty,
        next_shortage_qty,
        next_status,
        'quotation_accepted',
        case
          when selected_inventory_item_id is null then 'No active inventory item is mapped to this quotation product.'
          when next_shortage_qty > 0 then 'Reservation created with a procurement shortage.'
          else null
        end,
        current_profile_id
      );

      update public.quotation_bom_items
      set reserved_qty = next_reserved_qty, updated_at = now()
      where quotation_bom_items.id = source_row.quotation_bom_item_id;

      inserted_count := inserted_count + 1;
    end loop;
  else
    for source_row in
      select
        (source_items.ordinality::integer - 1) as material_item_index,
        case
          when nullif(source_items.item ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then nullif(source_items.item ->> 'product_id', '')::uuid
          else null
        end as catalog_product_id,
        case
          when nullif(source_items.item ->> 'inventory_item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then nullif(source_items.item ->> 'inventory_item_id', '')::uuid
          else null
        end as inventory_item_id,
        case
          when nullif(source_items.item ->> 'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
            then nullif(source_items.item ->> 'quantity', '')::numeric
          else 0
        end as required_qty,
        coalesce(source_items.item ->> 'description', 'Quotation material item') as item_label
      from jsonb_array_elements(coalesce(quotation_record.material_items, '[]'::jsonb)) with ordinality as source_items(item, ordinality)
      where nullif(source_items.item ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and nullif(source_items.item ->> 'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
      order by source_items.ordinality
    loop
      if source_row.required_qty <= 0 then
        continue;
      end if;

      selected_inventory_item_id := public.find_inventory_item_for_reservation(
        quotation_record.organization_id,
        source_row.catalog_product_id,
        source_row.inventory_item_id
      );
      available_qty := case
        when selected_inventory_item_id is null then 0
        else public.inventory_item_available_quantity(selected_inventory_item_id, quotation_record.id)
      end;
      next_reserved_qty := least(source_row.required_qty, greatest(coalesce(available_qty, 0), 0));
      next_shortage_qty := greatest(source_row.required_qty - next_reserved_qty, 0);
      next_status := case
        when next_reserved_qty >= source_row.required_qty then 'active'
        when next_reserved_qty > 0 then 'partial'
        else 'shortage'
      end;

      insert into public.inventory_reservations (
        company_id,
        organization_id,
        quotation_id,
        material_item_index,
        catalog_product_id,
        inventory_item_id,
        required_qty,
        reserved_qty,
        shortage_qty,
        status,
        source_event,
        notes,
        created_by
      )
      values (
        reservation_company_id,
        quotation_record.organization_id,
        quotation_record.id,
        source_row.material_item_index,
        source_row.catalog_product_id,
        selected_inventory_item_id,
        source_row.required_qty,
        next_reserved_qty,
        next_shortage_qty,
        next_status,
        'quotation_accepted',
        case
          when selected_inventory_item_id is null then 'No active inventory item is mapped to this quotation product.'
          when next_shortage_qty > 0 then 'Reservation created with a procurement shortage.'
          else null
        end,
        current_profile_id
      );

      inserted_count := inserted_count + 1;
    end loop;
  end if;

  return inserted_count;
end;
$$;

create or replace function public.handle_quotation_reservation_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from 'accepted' and new.status = 'accepted' then
    perform public.sync_inventory_reservations_for_quotation(new.id);
  elsif old.status = 'accepted'
    and new.status in ('rejected', 'expired', 'cancelled') then
    perform public.release_inventory_reservations_for_quotation(
      new.id,
      'quotation_' || new.status
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_inventory_reservations_on_quotation_status on public.quotations;

create trigger sync_inventory_reservations_on_quotation_status
after update of status on public.quotations
for each row
when (old.status is distinct from new.status)
execute function public.handle_quotation_reservation_status_change();

create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to accept quotation'
      using errcode = '42501';
  end if;

  update public.quotations
  set
    status = 'accepted',
    bom_status = 'locked',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  perform public.sync_inventory_reservations_for_quotation(quotation_record.id);

  return quotation_record;
end;
$$;

create or replace function public.reject_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      quotation_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('quotations', 'update')
    ) then
    raise exception 'Missing permission to reject quotation'
      using errcode = '42501';
  end if;

  update public.quotations
  set
    status = 'rejected',
    rejected_at = coalesce(rejected_at, now()),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  perform public.release_inventory_reservations_for_quotation(
    quotation_record.id,
    'quotation_rejected'
  );

  return quotation_record;
end;
$$;

create or replace function public.create_project_from_quotation(target_quotation_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
  project_record public.projects%rowtype;
  current_profile_id uuid;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if quotation_record.status <> 'accepted' then
    raise exception 'Only accepted quotations can become projects'
      using errcode = '23514';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot create a project from another organization quotation'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('projects', 'create') then
      raise exception 'Missing projects create permission'
        using errcode = '42501';
    end if;
  end if;

  select *
  into customer_record
  from public.customers
  where customers.id = quotation_record.customer_id
    and customers.organization_id = quotation_record.organization_id;

  if not found then
    raise exception 'Quotation customer was not found in the same organization'
      using errcode = '23503';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  insert into public.projects (
    organization_id,
    customer_id,
    lead_id,
    quotation_id,
    site_survey_id,
    project_name,
    system_capacity_kw,
    project_type,
    installation_address,
    city,
    district,
    state,
    pincode,
    project_status,
    priority,
    notes,
    created_by
  )
  values (
    quotation_record.organization_id,
    quotation_record.customer_id,
    quotation_record.lead_id,
    quotation_record.id,
    quotation_record.site_survey_id,
    customer_record.full_name || ' Solar Installation - ' || coalesce(quotation_record.quotation_code, 'Quotation'),
    quotation_record.system_capacity_kw,
    coalesce(customer_record.customer_type, 'residential'),
    coalesce(customer_record.address_line_1, ''),
    customer_record.city,
    customer_record.district,
    customer_record.state,
    customer_record.pincode,
    'created',
    'medium',
    quotation_record.notes,
    current_profile_id
  )
  returning * into project_record;

  update public.inventory_reservations
  set project_id = project_record.id, updated_at = now()
  where inventory_reservations.quotation_id = quotation_record.id
    and inventory_reservations.organization_id = quotation_record.organization_id
    and inventory_reservations.status in ('active', 'partial', 'shortage');

  update public.quotations
  set bom_status = 'locked', updated_at = now()
  where quotations.id = quotation_record.id;

  return project_record;
end;
$$;

create or replace function public.update_project_status(target_project_id uuid, new_status text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
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

  if new_status = 'cancelled' and project_record.quotation_id is not null then
    perform public.release_inventory_reservations_for_quotation(
      project_record.quotation_id,
      'project_cancelled'
    );
  end if;

  if new_status = 'material_dispatched' then
    if project_record.quotation_id is null then
      raise exception 'A linked quotation is required to dispatch reserved material. Stock out entry is not placed.'
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
      if not exists (
        select 1
        from public.inventory_reservations
        where inventory_reservations.quotation_id = project_record.quotation_id
          and inventory_reservations.organization_id = project_record.organization_id
          and inventory_reservations.status in ('active', 'partial', 'shortage')
      ) then
        perform public.sync_inventory_reservations_for_quotation(project_record.quotation_id);
      end if;

      if not exists (
        select 1
        from public.inventory_reservations
        where inventory_reservations.quotation_id = project_record.quotation_id
          and inventory_reservations.organization_id = project_record.organization_id
          and inventory_reservations.inventory_item_id is not null
          and inventory_reservations.reserved_qty > 0
          and inventory_reservations.status in ('active', 'partial')
      ) then
        raise exception 'No reserved inventory is available to dispatch for this project. Stock out entry is not placed.'
          using errcode = '23514';
      end if;

      with reservation_totals as (
        select
          inventory_reservations.inventory_item_id as item_id,
          sum(inventory_reservations.reserved_qty) as quantity
        from public.inventory_reservations
        where inventory_reservations.quotation_id = project_record.quotation_id
          and inventory_reservations.organization_id = project_record.organization_id
          and inventory_reservations.inventory_item_id is not null
          and inventory_reservations.reserved_qty > 0
          and inventory_reservations.status in ('active', 'partial')
        group by inventory_reservations.inventory_item_id
      )
      select string_agg(
        format(
          '%s has %s%s reserved but only %s%s is physically available',
          coalesce(
            nullif(concat_ws(' / ', inventory_items.item_name, inventory_items.brand, inventory_items.model), ''),
            inventory_items.item_code,
            'Inventory item'
          ),
          reservation_totals.quantity,
          coalesce(' ' || nullif(inventory_items.unit, ''), ''),
          coalesce(inventory_items.current_stock, 0),
          coalesce(' ' || nullif(inventory_items.unit, ''), '')
        ),
        E'\n'
      )
      into out_of_stock_warning
      from reservation_totals
      join public.inventory_items
        on inventory_items.id = reservation_totals.item_id
       and inventory_items.organization_id = project_record.organization_id
      where coalesce(inventory_items.current_stock, 0) < reservation_totals.quantity;

      if out_of_stock_warning is not null then
        raise exception 'Out of stock warning:% % Reserved stock out entry is not placed.',
          E'\n' || out_of_stock_warning,
          E'\n'
          using errcode = '23514';
      end if;

      select users_profile.id
      into current_profile_id
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
      limit 1;

      with reservation_totals as (
        select
          inventory_reservations.inventory_item_id as item_id,
          sum(inventory_reservations.reserved_qty) as quantity
        from public.inventory_reservations
        where inventory_reservations.quotation_id = project_record.quotation_id
          and inventory_reservations.organization_id = project_record.organization_id
          and inventory_reservations.inventory_item_id is not null
          and inventory_reservations.reserved_qty > 0
          and inventory_reservations.status in ('active', 'partial')
        group by inventory_reservations.inventory_item_id
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
        reservation_totals.quantity,
        current_date,
        'material_dispatched',
        project_record.id,
        'Auto stock out from accepted quotation reservations',
        current_profile_id
      from reservation_totals
      join public.inventory_items
        on inventory_items.id = reservation_totals.item_id
       and inventory_items.organization_id = project_record.organization_id;

      get diagnostics inserted_count = row_count;

      if inserted_count = 0 then
        raise exception 'No reserved inventory was dispatched. Stock out entry is not placed.'
          using errcode = '23514';
      end if;

      update public.quotation_bom_items
      set
        issued_qty = coalesce(quotation_bom_items.issued_qty, 0) + dispatched_rows.reserved_qty,
        reserved_qty = greatest(coalesce(quotation_bom_items.reserved_qty, 0) - dispatched_rows.reserved_qty, 0),
        updated_at = now()
      from (
        select
          inventory_reservations.quotation_bom_item_id,
          sum(inventory_reservations.reserved_qty) as reserved_qty
        from public.inventory_reservations
        where inventory_reservations.quotation_id = project_record.quotation_id
          and inventory_reservations.organization_id = project_record.organization_id
          and inventory_reservations.quotation_bom_item_id is not null
          and inventory_reservations.reserved_qty > 0
          and inventory_reservations.status in ('active', 'partial')
        group by inventory_reservations.quotation_bom_item_id
      ) as dispatched_rows
      where quotation_bom_items.id = dispatched_rows.quotation_bom_item_id;

      update public.inventory_reservations
      set
        status = case when shortage_qty > 0 then 'shortage' else 'converted' end,
        reserved_qty = 0,
        project_id = project_record.id,
        source_event = 'material_dispatched',
        updated_at = now()
      where inventory_reservations.quotation_id = project_record.quotation_id
        and inventory_reservations.organization_id = project_record.organization_id
        and inventory_reservations.reserved_qty > 0
        and inventory_reservations.status in ('active', 'partial');
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

create or replace function public.handle_project_reservation_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.project_status is distinct from 'cancelled'
    and new.project_status = 'cancelled'
    and new.quotation_id is not null then
    perform public.release_inventory_reservations_for_quotation(
      new.quotation_id,
      'project_cancelled'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists release_inventory_reservations_on_project_cancel on public.projects;

create trigger release_inventory_reservations_on_project_cancel
after update of project_status on public.projects
for each row
when (old.project_status is distinct from new.project_status)
execute function public.handle_project_reservation_status_change();

grant select, insert, update, delete on public.inventory_reservations to authenticated;
grant execute on function public.inventory_item_reserved_quantity(uuid, uuid) to authenticated;
grant execute on function public.inventory_item_available_quantity(uuid, uuid) to authenticated;
grant execute on function public.sync_inventory_reservations_for_quotation(uuid) to authenticated;
grant execute on function public.release_inventory_reservations_for_quotation(uuid, text) to authenticated;
grant execute on function public.accept_quotation(uuid) to authenticated;
grant execute on function public.reject_quotation(uuid) to authenticated;
grant execute on function public.create_project_from_quotation(uuid) to authenticated;
grant execute on function public.update_project_status(uuid, text) to authenticated;

revoke execute on function public.reservation_company_id_for_quotation(public.quotations) from public, authenticated;
revoke execute on function public.find_inventory_item_for_reservation(uuid, uuid, uuid) from public, authenticated;
revoke execute on function public.handle_quotation_reservation_status_change() from public, authenticated;
revoke execute on function public.handle_project_reservation_status_change() from public, authenticated;

alter table public.inventory_reservations enable row level security;

drop policy if exists "Super admins can manage inventory reservations" on public.inventory_reservations;
drop policy if exists "Organization users can view inventory reservations" on public.inventory_reservations;
drop policy if exists "Organization users can create inventory reservations" on public.inventory_reservations;
drop policy if exists "Organization users can update inventory reservations" on public.inventory_reservations;
drop policy if exists "Organization users can delete inventory reservations" on public.inventory_reservations;

create policy "Super admins can manage inventory reservations"
on public.inventory_reservations
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view inventory reservations"
on public.inventory_reservations
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('inventory', 'view')
    or public.user_has_permission('quotations', 'view')
  )
);

create policy "Organization users can create inventory reservations"
on public.inventory_reservations
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can update inventory reservations"
on public.inventory_reservations
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'update')
);

create policy "Organization users can delete inventory reservations"
on public.inventory_reservations
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('inventory', 'delete')
);

notify pgrst, 'reload schema';
