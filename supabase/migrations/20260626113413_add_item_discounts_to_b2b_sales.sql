alter table public.b2b_sale_items
add column if not exists discount_amount numeric default 0;

alter table public.b2b_sale_items
alter column discount_amount set not null,
alter column discount_amount set default 0;

alter table public.proforma_invoice_items
add column if not exists discount_amount numeric default 0;

alter table public.proforma_invoice_items
alter column discount_amount set not null,
alter column discount_amount set default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'b2b_sale_items_discount_nonnegative_check'
      and conrelid = 'public.b2b_sale_items'::regclass
  ) then
    alter table public.b2b_sale_items
    add constraint b2b_sale_items_discount_nonnegative_check
    check (discount_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'proforma_invoice_items_discount_nonnegative_check'
      and conrelid = 'public.proforma_invoice_items'::regclass
  ) then
    alter table public.proforma_invoice_items
    add constraint proforma_invoice_items_discount_nonnegative_check
    check (discount_amount >= 0);
  end if;
end;
$$;

create or replace function public.set_b2b_sale_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  item_record public.inventory_items%rowtype;
begin
  select *
  into sale_record
  from public.b2b_sales
  where b2b_sales.id = new.b2b_sale_id;

  if not found then
    raise exception 'b2b_sale_id must reference an existing B2B sale'
      using errcode = '23503';
  end if;

  if sale_record.status in ('dispatched', 'cancelled') then
    raise exception 'Items cannot be changed after a B2B sale is dispatched or cancelled'
      using errcode = '23514';
  end if;

  select *
  into item_record
  from public.inventory_items
  where inventory_items.id = new.inventory_item_id;

  if not found then
    raise exception 'inventory_item_id must reference an existing inventory item'
      using errcode = '23503';
  end if;

  if item_record.organization_id <> sale_record.organization_id then
    raise exception 'inventory_item_id must belong to the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  new.company_id := sale_record.company_id;
  new.organization_id := sale_record.organization_id;
  new.item_name := coalesce(nullif(trim(new.item_name), ''), item_record.item_name);
  new.unit := coalesce(nullif(trim(new.unit), ''), item_record.unit);
  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, item_record.gst_percent, 0);
  new.discount_amount := least(
    coalesce(new.discount_amount, 0),
    greatest(new.quantity * new.unit_price, 0)
  );
  new.line_total := greatest((new.quantity * new.unit_price) - new.discount_amount, 0);
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

create or replace function public.recalculate_b2b_sale_totals(target_sale_id uuid)
returns public.b2b_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
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

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not (
        public.user_has_permission('b2b_sales', 'create')
        or public.user_has_permission('b2b_sales', 'update')
        or public.user_has_permission('inventory', 'update')
      )
    ) then
    raise exception 'Missing permission to recalculate B2B sale totals'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(b2b_sale_items.line_total), 0),
    coalesce(sum(b2b_sale_items.line_total * coalesce(b2b_sale_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = target_sale_id
    and b2b_sale_items.organization_id = sale_record.organization_id;

  update public.b2b_sales
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    discount_amount = 0,
    total_amount = calculated_base_amount + calculated_gst_amount,
    updated_at = now()
  where b2b_sales.id = target_sale_id
  returning * into sale_record;

  return sale_record;
end;
$$;

create or replace function public.refresh_b2b_sale_totals_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_sale_id uuid;
begin
  target_sale_id := coalesce(new.b2b_sale_id, old.b2b_sale_id);
  perform public.recalculate_b2b_sale_totals(target_sale_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.set_proforma_invoice_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_record public.proforma_invoices%rowtype;
  item_organization_id uuid;
begin
  select *
  into parent_record
  from public.proforma_invoices
  where proforma_invoices.id = new.proforma_invoice_id;

  if not found then
    raise exception 'proforma_invoice_id must reference an existing proforma invoice'
      using errcode = '23503';
  end if;

  if parent_record.status in ('converted', 'cancelled') then
    raise exception 'Items cannot be changed after a proforma invoice is converted or cancelled'
      using errcode = '23514';
  end if;

  new.company_id := parent_record.company_id;
  new.organization_id := parent_record.organization_id;

  if new.inventory_item_id is not null then
    select inventory_items.organization_id
    into item_organization_id
    from public.inventory_items
    where inventory_items.id = new.inventory_item_id;

    if item_organization_id is null or item_organization_id <> parent_record.organization_id then
      raise exception 'inventory_item_id must belong to the same organization as the proforma invoice'
        using errcode = '23503';
    end if;
  end if;

  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.gst_percent := coalesce(new.gst_percent, 0);
  new.discount_amount := least(
    coalesce(new.discount_amount, 0),
    greatest(new.quantity * new.unit_price, 0)
  );
  new.line_total := greatest((new.quantity * new.unit_price) - new.discount_amount, 0);
  new.sort_order := coalesce(new.sort_order, 0);

  return new;
end;
$$;

create or replace function public.create_proforma_invoice_from_b2b_sale(target_sale_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record public.b2b_sales%rowtype;
  proforma_record public.proforma_invoices%rowtype;
  current_profile_id uuid;
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

  if sale_record.status = 'cancelled' then
    raise exception 'Cancelled B2B sales cannot be billed'
      using errcode = '23514';
  end if;

  if sale_record.proforma_invoice_id is not null then
    select *
    into proforma_record
    from public.proforma_invoices
    where proforma_invoices.id = sale_record.proforma_invoice_id;

    if found then
      return proforma_record;
    end if;
  end if;

  if not public.is_super_admin()
    and (
      sale_record.company_id <> public.get_current_user_company_id()
      or sale_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
      or not public.user_has_permission('b2b_sales', 'view')
    ) then
    raise exception 'Missing permission to create proforma invoice from B2B sale'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.b2b_sale_items
    where b2b_sale_items.b2b_sale_id = sale_record.id
  ) then
    raise exception 'Add at least one item before creating a B2B proforma invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.proforma_invoices (
    company_id,
    organization_id,
    customer_id,
    b2b_sale_id,
    proforma_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    sale_record.company_id,
    sale_record.organization_id,
    sale_record.customer_id,
    sale_record.id,
    current_date,
    0,
    'draft',
    'Proforma invoice generated from B2B sale ' || coalesce(sale_record.sale_code, sale_record.id::text),
    current_profile_id
  )
  returning * into proforma_record;

  insert into public.proforma_invoice_items (
    company_id,
    organization_id,
    proforma_invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    discount_amount,
    sort_order
  )
  select
    sale_record.company_id,
    sale_record.organization_id,
    proforma_record.id,
    b2b_sale_items.inventory_item_id,
    b2b_sale_items.item_name,
    b2b_sale_items.description,
    b2b_sale_items.quantity,
    b2b_sale_items.unit,
    b2b_sale_items.unit_price,
    b2b_sale_items.gst_percent,
    b2b_sale_items.discount_amount,
    b2b_sale_items.sort_order
  from public.b2b_sale_items
  where b2b_sale_items.b2b_sale_id = sale_record.id
  order by b2b_sale_items.sort_order, b2b_sale_items.created_at;

  update public.b2b_sales
  set proforma_invoice_id = proforma_record.id, updated_at = now()
  where b2b_sales.id = sale_record.id;

  return public.recalculate_proforma_invoice_totals(proforma_record.id);
end;
$$;
