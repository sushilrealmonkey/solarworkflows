-- Quotation acceptance legitimately attaches the customer created from a lead
-- and locks the BOM. Keep those workflow-owned changes behind the authorized
-- acceptance RPC while preserving the non-draft commercial edit guard.

create or replace function public.protect_non_draft_commercial_record()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  before_data jsonb := to_jsonb(old);
  after_data jsonb := to_jsonb(new);
begin
  if tg_table_name = 'quotations' and old.status <> 'draft' then
    before_data := before_data - array['status','approved_by','approved_at','sent_at','accepted_at','rejected_at','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','approved_by','approved_at','sent_at','accepted_at','rejected_at','archived_at','archived_by','archive_reason','updated_at'];

    if current_setting('app.quotation_transition', true) = 'accept' then
      before_data := before_data - array['customer_id','bom_status'];
      after_data := after_data - array['customer_id','bom_status'];
    end if;
  elsif tg_table_name = 'invoices' and old.status <> 'draft' then
    before_data := before_data - array['status','amount_paid','balance_due','sent_at','paid_at','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','amount_paid','balance_due','sent_at','paid_at','archived_at','archived_by','archive_reason','updated_at'];
  elsif tg_table_name = 'proforma_invoices' and old.status <> 'draft' then
    before_data := before_data - array['status','amount_paid','balance_due','sent_at','paid_at','converted_at','final_invoice_id','archived_at','archived_by','archive_reason','updated_at'];
    after_data := after_data - array['status','amount_paid','balance_due','sent_at','paid_at','converted_at','final_invoice_id','archived_at','archived_by','archive_reason','updated_at'];
  else
    return new;
  end if;

  if before_data is distinct from after_data then
    raise exception 'Commercial terms are locked after draft. Create a revision instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.accept_quotation(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  customer_record public.customers%rowtype;
begin
  select * into quotation_record
  from public.quotations where id = target_quotation_id for update;
  if not found then raise exception 'Quotation not found' using errcode = 'P0002'; end if;

  if not public.is_super_admin() and (
    quotation_record.organization_id <> public.current_user_organization_id()
    or not public.user_has_permission('quotations', 'update')
  ) then
    raise exception 'Missing permission to accept quotation' using errcode = '42501';
  end if;

  if quotation_record.lead_id is not null then
    select * into customer_record from public.convert_lead_to_customer(quotation_record.lead_id);
  end if;
  if quotation_record.customer_id is null and customer_record.id is null then
    raise exception 'Quotation needs a customer or lead before it can be accepted' using errcode = '23503';
  end if;

  perform set_config('app.quotation_transition', 'accept', true);

  update public.quotations
  set customer_id = coalesce(quotation_record.customer_id, customer_record.id),
      status = 'accepted',
      bom_status = 'locked',
      accepted_at = coalesce(accepted_at, now()),
      updated_at = now()
  where id = target_quotation_id returning * into quotation_record;

  perform set_config('app.quotation_transition', '', true);

  if public.subscription_can_write_capability('quotations.inventory_reservations') then
    perform public.sync_inventory_reservations_for_quotation(quotation_record.id);
  end if;
  perform public.create_project_from_quotation(quotation_record.id);

  select * into quotation_record from public.quotations where id = target_quotation_id;
  return quotation_record;
end;
$$;
