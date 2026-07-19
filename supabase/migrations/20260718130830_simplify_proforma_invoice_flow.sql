-- Proforma status represents payment collection only. Invoice conversion is
-- represented by final_invoice_id / converted_at, and cancellation uses the
-- shared record lifecycle instead of a second status system.

alter table public.proforma_invoices
drop constraint if exists proforma_invoices_status_check;

update public.proforma_invoices
set
  status = case
    when coalesce(total_amount, 0) > 0 and coalesce(balance_due, 0) <= 0 then 'paid'
    when coalesce(amount_paid, 0) > 0 and coalesce(balance_due, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end,
  sent_at = null,
  updated_at = now();

alter table public.proforma_invoices
alter column status set default 'unpaid';

alter table public.proforma_invoices
add constraint proforma_invoices_status_check
check (status in ('unpaid', 'partially_paid', 'paid'));

-- Repair legacy B2B proformas that were linked only from b2b_sales.
update public.proforma_invoices
set b2b_sale_id = (
  select b2b_sales.id
  from public.b2b_sales
  where b2b_sales.proforma_invoice_id = proforma_invoices.id
    and b2b_sales.company_id = proforma_invoices.company_id
    and b2b_sales.organization_id = proforma_invoices.organization_id
    and b2b_sales.customer_id = proforma_invoices.customer_id
  order by b2b_sales.created_at asc, b2b_sales.id asc
  limit 1
)
where proforma_invoices.b2b_sale_id is null
  and exists (
    select 1
    from public.b2b_sales
    where b2b_sales.proforma_invoice_id = proforma_invoices.id
      and b2b_sales.company_id = proforma_invoices.company_id
      and b2b_sales.organization_id = proforma_invoices.organization_id
      and b2b_sales.customer_id = proforma_invoices.customer_id
  );

create or replace function public.normalize_proforma_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.status := case
    when coalesce(new.total_amount, 0) > 0 and coalesce(new.balance_due, 0) <= 0 then 'paid'
    when coalesce(new.amount_paid, 0) > 0 and coalesce(new.balance_due, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end;
  new.sent_at := null;
  return new;
end;
$$;

drop trigger if exists normalize_proforma_payment_status on public.proforma_invoices;
create trigger normalize_proforma_payment_status
before insert or update of status, total_amount, amount_paid, balance_due
on public.proforma_invoices
for each row
execute function public.normalize_proforma_payment_status();

revoke execute on function public.normalize_proforma_payment_status() from public, anon, authenticated;

create or replace function public.recalculate_proforma_invoice_totals(target_proforma_invoice_id uuid)
returns public.proforma_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  calculated_total_amount numeric;
  calculated_amount_paid numeric;
  calculated_balance_due numeric;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to recalculate a proforma invoice'
      using errcode = '42501';
  end if;

  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not (
        public.user_has_permission('invoices', 'update')
        or public.user_has_permission('invoices', 'create')
        or public.user_has_permission('payments', 'create')
        or public.user_has_permission('payments', 'update')
        or public.user_has_permission('payments', 'delete')
      )
    ) then
    raise exception 'Missing permission to recalculate proforma invoice totals'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(proforma_invoice_items.line_total), 0),
    coalesce(sum(proforma_invoice_items.line_total * coalesce(proforma_invoice_items.gst_percent, 0) / 100), 0)
  into calculated_base_amount, calculated_gst_amount
  from public.proforma_invoice_items
  where proforma_invoice_items.proforma_invoice_id = target_proforma_invoice_id
    and proforma_invoice_items.organization_id = proforma_record.organization_id;

  calculated_total_amount := greatest(
    calculated_base_amount + calculated_gst_amount - coalesce(proforma_record.discount_amount, 0),
    0
  );

  select coalesce(sum(payments.amount), 0)
  into calculated_amount_paid
  from public.payments
  where payments.proforma_invoice_id = proforma_record.id
    and payments.organization_id = proforma_record.organization_id
    and payments.status = 'received';

  calculated_balance_due := greatest(calculated_total_amount - calculated_amount_paid, 0);
  next_status := case
    when calculated_total_amount > 0 and calculated_balance_due <= 0 then 'paid'
    when calculated_amount_paid > 0 and calculated_balance_due > 0 then 'partially_paid'
    else 'unpaid'
  end;

  update public.proforma_invoices
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = calculated_total_amount,
    amount_paid = calculated_amount_paid,
    balance_due = calculated_balance_due,
    status = next_status,
    paid_at = case when next_status = 'paid' then coalesce(paid_at, now()) else null end,
    sent_at = null,
    updated_at = now()
  where proforma_invoices.id = target_proforma_invoice_id
  returning * into proforma_record;

  return proforma_record;
end;
$$;

revoke execute on function public.recalculate_proforma_invoice_totals(uuid) from public, anon;
grant execute on function public.recalculate_proforma_invoice_totals(uuid) to authenticated;

create or replace function public.create_invoice_from_proforma_invoice(target_proforma_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  proforma_record public.proforma_invoices%rowtype;
  invoice_record public.invoices%rowtype;
  current_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create a tax invoice'
      using errcode = '42501';
  end if;

  perform public.recalculate_proforma_invoice_totals(target_proforma_invoice_id);

  select *
  into proforma_record
  from public.proforma_invoices
  where proforma_invoices.id = target_proforma_invoice_id
  for update;

  if not found then
    raise exception 'Proforma invoice not found'
      using errcode = 'P0002';
  end if;

  if proforma_record.final_invoice_id is not null then
    select *
    into invoice_record
    from public.invoices
    where invoices.id = proforma_record.final_invoice_id;

    if found then
      return invoice_record;
    end if;

    raise exception 'This proforma invoice already references a tax invoice that could not be loaded'
      using errcode = '23514';
  end if;

  if proforma_record.archived_at is not null then
    raise exception 'Archived proforma invoices cannot create tax invoices'
      using errcode = '23514';
  end if;

  if not public.is_super_admin()
    and (
      proforma_record.company_id <> public.get_current_user_company_id()
      or proforma_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('invoices', 'create')
    ) then
    raise exception 'Missing permission to create invoice from proforma invoice'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.proforma_invoice_items
    where proforma_invoice_items.proforma_invoice_id = proforma_record.id
  ) then
    raise exception 'Add at least one item before creating a tax invoice'
      using errcode = '23514';
  end if;

  select public.current_user_profile_id()
  into current_profile_id;

  insert into public.invoices (
    organization_id,
    customer_id,
    project_id,
    quotation_id,
    b2b_sale_id,
    proforma_invoice_id,
    invoice_date,
    due_date,
    discount_amount,
    status,
    notes,
    created_by
  )
  values (
    proforma_record.organization_id,
    proforma_record.customer_id,
    proforma_record.project_id,
    proforma_record.quotation_id,
    proforma_record.b2b_sale_id,
    proforma_record.id,
    current_date,
    proforma_record.due_date,
    proforma_record.discount_amount,
    'draft',
    'Invoice generated from proforma invoice ' || coalesce(proforma_record.proforma_code, proforma_record.id::text),
    current_profile_id
  )
  returning * into invoice_record;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    inventory_item_id,
    item_name,
    description,
    quantity,
    unit,
    unit_price,
    gst_percent,
    sort_order
  )
  select
    proforma_record.organization_id,
    invoice_record.id,
    proforma_invoice_items.inventory_item_id,
    proforma_invoice_items.item_name,
    proforma_invoice_items.description,
    proforma_invoice_items.quantity,
    proforma_invoice_items.unit,
    proforma_invoice_items.unit_price,
    proforma_invoice_items.gst_percent,
    proforma_invoice_items.sort_order
  from public.proforma_invoice_items
  where proforma_invoice_items.proforma_invoice_id = proforma_record.id
  order by proforma_invoice_items.sort_order, proforma_invoice_items.created_at;

  update public.payments
  set invoice_id = invoice_record.id, updated_at = now()
  where payments.proforma_invoice_id = proforma_record.id
    and payments.organization_id = proforma_record.organization_id
    and payments.invoice_id is null;

  update public.proforma_invoices
  set
    final_invoice_id = invoice_record.id,
    converted_at = coalesce(converted_at, now()),
    updated_at = now()
  where proforma_invoices.id = proforma_record.id;

  if proforma_record.b2b_sale_id is not null then
    update public.b2b_sales
    set invoice_id = invoice_record.id, updated_at = now()
    where b2b_sales.id = proforma_record.b2b_sale_id;
  end if;

  update public.invoices
  set proforma_invoice_id = proforma_record.id, updated_at = now()
  where invoices.id = invoice_record.id;

  return public.recalculate_invoice_totals(invoice_record.id);
end;
$$;

revoke execute on function public.create_invoice_from_proforma_invoice(uuid) from public, anon;
grant execute on function public.create_invoice_from_proforma_invoice(uuid) to authenticated;

revoke execute on function public.mark_proforma_invoice_sent(uuid) from public, anon, authenticated;
revoke execute on function public.mark_proforma_invoice_cancelled(uuid) from public, anon, authenticated;
