-- Proforma status now tracks payment collection rather than draft lifecycle.
-- Remove the legacy draft-only guards so unpaid proformas can receive and edit
-- their owned line items.

drop trigger if exists protect_proforma_commercial_history
on public.proforma_invoices;

drop trigger if exists protect_proforma_item_draft_state
on public.proforma_invoice_items;

-- Keep B2B-generated proformas aligned with the payment-only status constraint.
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
    'unpaid',
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

revoke execute on function public.create_proforma_invoice_from_b2b_sale(uuid)
from public, anon;

grant execute on function public.create_proforma_invoice_from_b2b_sale(uuid)
to authenticated;
