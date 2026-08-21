-- Quotations now begin in Created status. Keep invoice and proforma line
-- items draft-only, while allowing quotation BOM/terms to be saved while the
-- quotation remains Created.

create or replace function public.protect_draft_owned_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_status text;
  parent_id uuid;
  parent_is_quotation boolean := false;
begin
  if tg_table_name = 'quotation_items' then
    parent_is_quotation := true;
    parent_id := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
    select status into parent_status from public.quotations where id = parent_id;
  elsif tg_table_name = 'quotation_warranties' then
    parent_is_quotation := true;
    parent_id := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
    select status into parent_status from public.quotations where id = parent_id;
  elsif tg_table_name = 'quotation_payment_terms' then
    parent_is_quotation := true;
    parent_id := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
    select status into parent_status from public.quotations where id = parent_id;
  elsif tg_table_name = 'invoice_items' then
    parent_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
    select status into parent_status from public.invoices where id = parent_id;
  elsif tg_table_name = 'proforma_invoice_items' then
    parent_id := case when tg_op = 'DELETE' then old.proforma_invoice_id else new.proforma_invoice_id end;
    select status into parent_status from public.proforma_invoices where id = parent_id;
  end if;

  -- Cascading deletes from an already-approved parent lifecycle operation remain atomic.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  if parent_is_quotation then
    if parent_status is distinct from 'created' then
      raise exception 'Line items and terms are editable only while the parent is Created.'
        using errcode = '23514';
    end if;
  elsif parent_status is distinct from 'draft' then
    raise exception 'Line items and terms are editable only while the parent is draft.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
