-- The owner-only payment deletion workflow runs outside an Auth session. Let
-- proforma recalculation proceed only while the Postgres owner transaction flag
-- is active; ordinary callers still require a real authenticated user.

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
  owner_payment_delete boolean := session_user = 'postgres'
    and coalesce(current_setting('app.owner_payment_delete', true), '') = 'on';
begin
  if auth.uid() is null and not owner_payment_delete then
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
