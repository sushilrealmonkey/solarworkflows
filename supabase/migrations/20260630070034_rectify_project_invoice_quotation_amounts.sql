-- Project invoices should use the linked quotation's final calculated amount.
-- Quotation discounts are already baked into quotation.base_amount/gst_amount/total_amount,
-- so they must not be carried as a separate invoice discount.
create or replace function public.recalculate_invoice_totals(target_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_record public.invoices%rowtype;
  quotation_record public.quotations%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  calculated_total_amount numeric;
  calculated_amount_paid numeric;
  calculated_balance_due numeric;
  next_status text;
begin
  select *
  into invoice_record
  from public.invoices
  where invoices.id = target_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if invoice_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate an invoice from another organization'
        using errcode = '42501';
    end if;

    if not (
      public.user_has_permission('invoices', 'update')
      or public.user_has_permission('invoices', 'create')
      or (
        invoice_record.project_id is null
        and (
          public.user_has_permission('payments', 'create')
          or public.user_has_permission('payments', 'update')
          or public.user_has_permission('payments', 'delete')
        )
      )
    ) then
      raise exception 'Missing invoices update permission'
        using errcode = '42501';
    end if;
  end if;

  if invoice_record.project_id is not null and invoice_record.quotation_id is not null then
    select *
    into quotation_record
    from public.quotations
    where quotations.id = invoice_record.quotation_id
      and quotations.organization_id = invoice_record.organization_id;

    if found then
      calculated_base_amount := coalesce(quotation_record.base_amount, 0);
      calculated_gst_amount := coalesce(quotation_record.gst_amount, 0);
      calculated_total_amount := coalesce(
        quotation_record.total_amount,
        calculated_base_amount + calculated_gst_amount
      );
    end if;
  end if;

  if calculated_total_amount is null then
    select
      coalesce(sum(invoice_items.line_total), 0),
      coalesce(sum(invoice_items.line_total * coalesce(invoice_items.gst_percent, 0) / 100), 0)
    into calculated_base_amount, calculated_gst_amount
    from public.invoice_items
    where invoice_items.invoice_id = target_invoice_id
      and invoice_items.organization_id = invoice_record.organization_id;

    calculated_total_amount := greatest(
      calculated_base_amount
        + calculated_gst_amount
        - coalesce(invoice_record.discount_amount, 0),
      0
    );
  end if;

  if invoice_record.project_id is not null then
    select coalesce(sum(payments.amount), 0)
    into calculated_amount_paid
    from public.payments
    where payments.project_id = invoice_record.project_id
      and payments.organization_id = invoice_record.organization_id
      and payments.status = 'received';
  else
    select coalesce(sum(payments.amount), 0)
    into calculated_amount_paid
    from public.payments
    where payments.invoice_id = invoice_record.id
      and payments.organization_id = invoice_record.organization_id
      and payments.status = 'received';
  end if;

  calculated_balance_due := greatest(calculated_total_amount - calculated_amount_paid, 0);

  next_status := case
    when invoice_record.status = 'cancelled' then 'cancelled'
    when calculated_total_amount > 0 and calculated_balance_due <= 0 then 'paid'
    when calculated_amount_paid > 0 and calculated_balance_due > 0 then 'partially_paid'
    when invoice_record.status = 'draft' then 'draft'
    when invoice_record.due_date is not null
      and invoice_record.due_date < current_date
      and calculated_balance_due > 0 then 'overdue'
    else 'sent'
  end;

  update public.invoices
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    discount_amount = case
      when public.invoices.project_id is not null and public.invoices.quotation_id is not null then 0
      else public.invoices.discount_amount
    end,
    total_amount = calculated_total_amount,
    amount_paid = calculated_amount_paid,
    balance_due = calculated_balance_due,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(public.invoices.paid_at, now())
      when next_status in ('partially_paid', 'sent', 'overdue', 'draft') then null
      else public.invoices.paid_at
    end,
    updated_at = now()
  where invoices.id = target_invoice_id
  returning * into invoice_record;

  return invoice_record;
end;
$$;

update public.invoices
set discount_amount = 0,
    updated_at = now()
where project_id is not null
  and quotation_id is not null
  and coalesce(discount_amount, 0) <> 0;
