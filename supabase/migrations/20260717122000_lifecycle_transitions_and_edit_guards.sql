-- Financial cancellation, append-only stock reversal, and status-aware edit guards.

create or replace function public.cancel_payment(payment_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_record public.payments%rowtype;
  clean_reason text := nullif(btrim(reason), '');
  result jsonb;
begin
  if clean_reason is null then raise exception 'Cancellation reason is required' using errcode = '23514'; end if;
  if not (public.is_super_admin() or public.user_has_permission('payments', 'update')) then raise exception 'Payment update permission is required' using errcode = '42501'; end if;

  select * into payment_record from public.payments where id = payment_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if not public.is_super_admin() and payment_record.organization_id <> public.current_user_organization_id() then raise exception 'Payment belongs to another tenant' using errcode = '42501'; end if;
  if payment_record.status <> 'received' then raise exception 'Only a received payment can be cancelled' using errcode = '23514'; end if;

  perform set_config('app.payment_transition', 'on', true);
  update public.payments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = public.current_user_profile_id(), cancellation_reason = clean_reason
  where id = payment_id
  returning to_jsonb(payments.*) into result;

  perform public.create_activity_log('payments', payment_id, 'cancel', to_jsonb(payment_record), jsonb_build_object('reason', clean_reason, 'record', result));
  return result;
end;
$$;

create or replace function public.reverse_inventory_transaction(transaction_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  original public.inventory_transactions%rowtype;
  item_record public.inventory_items%rowtype;
  clean_reason text := nullif(btrim(reason), '');
  reversal_quantity numeric;
  reversal_record public.inventory_transactions%rowtype;
begin
  if clean_reason is null then raise exception 'Reversal reason is required' using errcode = '23514'; end if;
  if not (public.is_super_admin() or (
    public.user_has_permission('inventory', 'create') and public.user_has_permission('inventory', 'update')
  )) then raise exception 'Inventory create and update permissions are required' using errcode = '42501'; end if;

  select * into original from public.inventory_transactions where id = transaction_id for update;
  if not found then raise exception 'Inventory transaction not found' using errcode = 'P0002'; end if;
  if not public.is_super_admin() and original.organization_id <> public.current_user_organization_id() then raise exception 'Transaction belongs to another tenant' using errcode = '42501'; end if;
  if original.reversal_of_transaction_id is not null then raise exception 'A reversal transaction cannot itself be reversed; correct it with a new authorized adjustment.' using errcode = '23514'; end if;
  if exists (select 1 from public.inventory_transactions where reversal_of_transaction_id = transaction_id) then raise exception 'This transaction has already been reversed' using errcode = '23514'; end if;

  select * into item_record from public.inventory_items where id = original.item_id for update;
  reversal_quantity := case original.transaction_type
    when 'stock_in' then -original.quantity
    when 'return' then -original.quantity
    when 'stock_out' then original.quantity
    when 'project_issue' then original.quantity
    when 'adjustment' then -original.quantity
  end;
  if reversal_quantity is null then raise exception 'Unsupported transaction type for reversal' using errcode = '23514'; end if;
  if coalesce(item_record.current_stock, 0) + reversal_quantity < 0 then raise exception 'Reversal would make stock negative. Resolve later stock usage first.' using errcode = '23514'; end if;

  insert into public.inventory_transactions (
    organization_id, item_id, project_id, transaction_type, quantity,
    transaction_date, reference_type, reference_id, notes, created_by,
    reversal_of_transaction_id, reversal_reason
  ) values (
    original.organization_id, original.item_id, original.project_id, 'adjustment', reversal_quantity,
    current_date, 'transaction_reversal', original.id,
    'Reversal of ' || original.id::text || ': ' || clean_reason,
    public.current_user_profile_id(), original.id, clean_reason
  ) returning * into reversal_record;

  perform public.create_activity_log('inventory_transactions', reversal_record.id, 'reverse', to_jsonb(original), jsonb_build_object('reason', clean_reason, 'reversal', to_jsonb(reversal_record)));
  return to_jsonb(reversal_record);
end;
$$;

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

drop trigger if exists protect_quotation_commercial_history on public.quotations;
create trigger protect_quotation_commercial_history before update on public.quotations for each row execute function public.protect_non_draft_commercial_record();
drop trigger if exists protect_invoice_commercial_history on public.invoices;
create trigger protect_invoice_commercial_history before update on public.invoices for each row execute function public.protect_non_draft_commercial_record();
drop trigger if exists protect_proforma_commercial_history on public.proforma_invoices;
create trigger protect_proforma_commercial_history before update on public.proforma_invoices for each row execute function public.protect_non_draft_commercial_record();

create or replace function public.protect_draft_owned_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_status text;
  parent_id uuid;
begin
  if tg_table_name = 'quotation_items' then
    parent_id := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
    select status into parent_status from public.quotations where id = parent_id;
  elsif tg_table_name = 'quotation_warranties' then
    parent_id := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
    select status into parent_status from public.quotations where id = parent_id;
  elsif tg_table_name = 'quotation_payment_terms' then
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
  if parent_status is distinct from 'draft' then raise exception 'Line items and terms are editable only while the parent is draft.' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_quotation_item_draft_state on public.quotation_items;
create trigger protect_quotation_item_draft_state before insert or update or delete on public.quotation_items for each row execute function public.protect_draft_owned_line();
drop trigger if exists protect_quotation_warranty_draft_state on public.quotation_warranties;
create trigger protect_quotation_warranty_draft_state before insert or update or delete on public.quotation_warranties for each row execute function public.protect_draft_owned_line();
drop trigger if exists protect_quotation_payment_term_draft_state on public.quotation_payment_terms;
create trigger protect_quotation_payment_term_draft_state before insert or update or delete on public.quotation_payment_terms for each row execute function public.protect_draft_owned_line();
drop trigger if exists protect_invoice_item_draft_state on public.invoice_items;
create trigger protect_invoice_item_draft_state before insert or update or delete on public.invoice_items for each row execute function public.protect_draft_owned_line();
drop trigger if exists protect_proforma_item_draft_state on public.proforma_invoice_items;
create trigger protect_proforma_item_draft_state before insert or update or delete on public.proforma_invoice_items for each row execute function public.protect_draft_owned_line();

create or replace function public.protect_document_evidence()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and old.document_type not in ('quotation_pdf', 'invoice_pdf', 'purchase_order_pdf') then return new; end if;
  if (to_jsonb(new) - array['archived_at','archived_by','archive_reason','pending_delete_at','updated_at']) is distinct from
     (to_jsonb(old) - array['archived_at','archived_by','archive_reason','pending_delete_at','updated_at']) then
    raise exception 'Verified and generated documents are immutable evidence. Archive them instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_verified_document_evidence on public.documents;
create trigger protect_verified_document_evidence before update on public.documents for each row execute function public.protect_document_evidence();

-- Inventory ledger rows are readable and insertable only. Reversal is a
-- security-definer insert; no authenticated user receives UPDATE/DELETE access.
drop policy if exists "Super admins can manage inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can update inventory transactions" on public.inventory_transactions;
drop policy if exists "Organization users can delete inventory transactions" on public.inventory_transactions;
drop policy if exists "Super admins can view inventory transactions" on public.inventory_transactions;
drop policy if exists "Super admins can create inventory transactions" on public.inventory_transactions;
create policy "Super admins can view inventory transactions" on public.inventory_transactions for select to authenticated using (public.is_super_admin());
create policy "Super admins can create inventory transactions" on public.inventory_transactions for insert to authenticated with check (public.is_super_admin());

drop policy if exists "Organization users can delete organization payments" on public.payments;

-- Parent deletion is available only through the lifecycle RPC. Removing the
-- policies as well as the table grant prevents a future grant change from
-- accidentally re-enabling the legacy path.
drop policy if exists "Organization users can delete organization customers" on public.customers;
drop policy if exists "Organization users can delete organization leads" on public.leads;
drop policy if exists "Organization users can delete organization site surveys" on public.site_surveys;
drop policy if exists "Organization users can delete organization quotations" on public.quotations;
drop policy if exists "Organization users can delete organization projects" on public.projects;
drop policy if exists "Organization users can delete B2B sales" on public.b2b_sales;
drop policy if exists "Organization users can delete proforma invoices" on public.proforma_invoices;
drop policy if exists "Organization users can delete invoices" on public.invoices;
drop policy if exists "Organization users can delete purchase orders" on public.purchase_orders;
drop policy if exists "Organization users can delete vendors" on public.vendors;
drop policy if exists "Organization users can delete inventory items" on public.inventory_items;
drop policy if exists "Organization users can delete documents" on public.documents;
drop policy if exists "Tenant users can delete products" on public.products;
drop policy if exists "Tenant users can delete product categories" on public.product_categories;
drop policy if exists "Tenant users can delete BOM templates" on public.bom_templates;

-- Reservations and roles are workflow-managed. Evidence files are removed by
-- the service cleanup worker only after their queue entry is claimed.
drop policy if exists "Organization users can delete inventory reservations" on public.inventory_reservations;
drop policy if exists "Company users can delete own company roles with permission" on public.roles;
drop policy if exists "Organization admins can delete assigned organization roles" on public.roles;
drop policy if exists "Organization users can delete organization document files" on storage.objects;
drop policy if exists "Organization users can update organization document files" on storage.objects;

revoke delete on table public.customers, public.leads, public.site_surveys, public.quotations,
  public.projects, public.payments, public.b2b_sales, public.proforma_invoices,
  public.invoices, public.purchase_orders, public.vendors, public.inventory_items,
  public.documents, public.products, public.product_categories, public.bom_templates
from authenticated;
revoke update, delete on table public.inventory_transactions from authenticated;
revoke delete on table public.inventory_reservations, public.roles from authenticated;
revoke update, delete on table public.activity_logs from authenticated;

revoke execute on function public.protect_non_draft_commercial_record() from public, authenticated;
revoke execute on function public.protect_draft_owned_line() from public, authenticated;
revoke execute on function public.protect_document_evidence() from public, authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
grant execute on function public.reverse_inventory_transaction(uuid, text) to authenticated;

notify pgrst, 'reload schema';
