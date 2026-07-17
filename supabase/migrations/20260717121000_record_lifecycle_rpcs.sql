-- Transactional lifecycle API. Every table reference is explicitly whitelisted;
-- callers cannot provide a table name or SQL fragment.

create or replace function public.lifecycle_record_snapshot(module_key text, record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  normalized_module text := lower(btrim(module_key));
begin
  case normalized_module
    when 'customers' then select to_jsonb(t) into result from public.customers t where t.id = record_id;
    when 'leads' then select to_jsonb(t) into result from public.leads t where t.id = record_id;
    when 'site_surveys' then select to_jsonb(t) into result from public.site_surveys t where t.id = record_id;
    when 'quotations' then select to_jsonb(t) into result from public.quotations t where t.id = record_id;
    when 'projects' then select to_jsonb(t) into result from public.projects t where t.id = record_id;
    when 'payments' then select to_jsonb(t) into result from public.payments t where t.id = record_id;
    when 'b2b_sales' then select to_jsonb(t) into result from public.b2b_sales t where t.id = record_id;
    when 'proforma_invoices' then select to_jsonb(t) into result from public.proforma_invoices t where t.id = record_id;
    when 'invoices' then select to_jsonb(t) into result from public.invoices t where t.id = record_id;
    when 'purchase_orders' then select to_jsonb(t) into result from public.purchase_orders t where t.id = record_id;
    when 'vendors' then select to_jsonb(t) into result from public.vendors t where t.id = record_id;
    when 'inventory_items' then select to_jsonb(t) into result from public.inventory_items t where t.id = record_id;
    when 'documents' then select to_jsonb(t) into result from public.documents t where t.id = record_id;
    when 'products' then
      select to_jsonb(t) || jsonb_build_object('organization_id', t.tenant_id)
      into result from public.products t where t.id = record_id;
    when 'product_categories' then
      select to_jsonb(t) || jsonb_build_object('organization_id', t.tenant_id)
      into result from public.product_categories t where t.id = record_id;
    when 'bom_templates' then
      select to_jsonb(t) || jsonb_build_object('organization_id', t.tenant_id)
      into result from public.bom_templates t where t.id = record_id;
    else
      raise exception 'Unsupported lifecycle module: %', module_key using errcode = '22023';
  end case;

  if result is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and nullif(result ->> 'organization_id', '')::uuid is distinct from public.current_user_organization_id() then
    raise exception 'Record belongs to another tenant' using errcode = '42501';
  end if;

  return result;
end;
$$;

create or replace function public.lifecycle_dependency(
  dependency_kind text,
  dependency_module text,
  dependency_count integer,
  dependency_route text,
  dependency_guidance text,
  dependency_record_id uuid default null,
  dependency_label text default null
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'kind', dependency_kind,
    'module_key', dependency_module,
    'count', dependency_count,
    'route', dependency_route,
    'guidance', dependency_guidance,
    'record_id', dependency_record_id,
    'label', dependency_label
  );
$$;

create or replace function public.preview_record_lifecycle(module_key text, record_id uuid, action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_module text := lower(btrim(module_key));
  normalized_action text := lower(btrim(action));
  snapshot jsonb;
  permission_module text;
  status_value text;
  label_value text;
  dependencies jsonb := '[]'::jsonb;
  owned_count integer := 0;
  blocker_count integer := 0;
  historical_count integer := 0;
  count_value integer;
  delete_state_allowed boolean := false;
  archive_state_allowed boolean := false;
  permission_allowed boolean := false;
  allowed_value boolean := false;
  recommended_action text := 'archive';
  guidance text;
begin
  if normalized_action not in ('archive', 'restore', 'delete') then
    raise exception 'Lifecycle action must be archive, restore, or delete' using errcode = '22023';
  end if;

  snapshot := public.lifecycle_record_snapshot(normalized_module, record_id);
  permission_module := public.lifecycle_permission_module(normalized_module);
  status_value := coalesce(
    snapshot ->> 'status', snapshot ->> 'project_status', snapshot ->> 'survey_status',
    case when snapshot ? 'is_active' then case when (snapshot ->> 'is_active')::boolean then 'active' else 'inactive' end end,
    'active'
  );
  label_value := coalesce(
    snapshot ->> 'customer_code', snapshot ->> 'lead_code', snapshot ->> 'survey_code',
    snapshot ->> 'quotation_code', snapshot ->> 'project_code', snapshot ->> 'payment_code',
    snapshot ->> 'sale_code', snapshot ->> 'proforma_code', snapshot ->> 'invoice_code',
    snapshot ->> 'purchase_code', snapshot ->> 'vendor_code', snapshot ->> 'item_code',
    snapshot ->> 'document_name', snapshot ->> 'product_code', snapshot ->> 'name', record_id::text
  );

  permission_allowed := public.is_super_admin() or public.user_has_permission(
    permission_module,
    case when normalized_action = 'delete' then 'delete' else 'update' end
  );

  case normalized_module
    when 'customers' then
      select count(*) into count_value from public.leads where customer_id = record_id or converted_customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'leads', count_value, '/leads', 'Retain the customer and archive it; lead conversion history is permanent.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.site_surveys where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'site_surveys', count_value, '/site-surveys', 'Complete or cancel open surveys; retain historical surveys.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.quotations where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'quotations', count_value, '/quotations', 'Resolve open quotations. Historical quotations make this customer archive-only.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.projects where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'projects', count_value, '/projects', 'Complete or cancel open projects. Project history must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.payments where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'payments', count_value, '/payments', 'Financial history cannot be deleted.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.invoices where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'invoices', count_value, '/invoices', 'Cancel eligible unpaid invoices or retain completed billing history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.proforma_invoices where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'proforma_invoices', count_value, '/proforma-invoices', 'Resolve proformas; retained billing history makes deletion unsafe.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.b2b_sales where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'b2b_sales', count_value, '/b2b-sales', 'Resolve active sales and retain completed sales history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where customer_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/customers/' || record_id::text, 'Archive evidence; do not remove verified customer documents.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.quotations where customer_id = record_id and status not in ('rejected', 'expired', 'cancelled');
      blocker_count := blocker_count + count_value;
      select count(*) into count_value from public.projects where customer_id = record_id and project_status not in ('commissioned', 'cancelled');
      blocker_count := blocker_count + count_value;
      select count(*) into count_value from public.invoices where customer_id = record_id and status not in ('paid', 'cancelled');
      blocker_count := blocker_count + count_value;
      select count(*) into count_value from public.b2b_sales where customer_id = record_id and status not in ('dispatched', 'cancelled');
      blocker_count := blocker_count + count_value;
      delete_state_allowed := true;
      archive_state_allowed := blocker_count = 0;

    when 'leads' then
      select count(*) into count_value from public.lead_followups where lead_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'lead_followups', count_value, '/leads/' || record_id::text, 'Owned follow-ups are removed atomically only when the unused lead qualifies.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.site_surveys where lead_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'site_surveys', count_value, '/site-surveys', 'Resolve and retain survey history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.quotations where lead_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'quotations', count_value, '/quotations', 'Resolve and retain quotation history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.projects where lead_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'projects', count_value, '/projects', 'Project conversion history must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where lead_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/leads/' || record_id::text, 'Archive retained evidence.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value <> 'converted' and coalesce(snapshot ->> 'converted_customer_id', '') = '';
      archive_state_allowed := status_value in ('converted', 'lost') and not exists (select 1 from public.lead_followups where lead_id = record_id and status = 'pending');

    when 'site_surveys' then
      select count(*) into count_value from public.quotations where site_survey_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'quotations', count_value, '/quotations', 'Existing quotation links must remain readable.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.projects where site_survey_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'projects', count_value, '/projects', 'Existing project links must remain readable.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where (to_jsonb(documents) ->> 'site_survey_id')::uuid = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/site-surveys/' || record_id::text, 'Archive retained survey documents.')); historical_count := historical_count + count_value; end if;
      if coalesce(snapshot ->> 'electricity_bill_url', '') <> '' or jsonb_array_length(coalesce(snapshot -> 'site_photos', '[]'::jsonb)) > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'storage_objects', 1, '/site-surveys/' || record_id::text, 'Survey-owned files are queued for idempotent Storage cleanup.')); owned_count := owned_count + 1; end if;
      delete_state_allowed := true;
      archive_state_allowed := status_value in ('completed', 'cancelled');

    when 'quotations' then
      select count(*) into count_value from public.quotation_items where quotation_id = record_id;
      select count(*) + count_value into count_value from public.quotation_warranties where quotation_id = record_id;
      select count(*) + count_value into count_value from public.quotation_payment_terms where quotation_id = record_id;
      select count(*) + count_value into count_value from public.quotation_bom_items where quotation_id = record_id;
      select count(*) + count_value into count_value from public.inventory_reservations where quotation_id = record_id and status in ('active', 'partial', 'shortage');
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'quotation_components', count_value, '/quotations/' || record_id::text, 'Draft lines, terms, warranties, BOM rows, and unused reservations are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.projects where quotation_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'projects', count_value, '/projects', 'Accepted quotation project history must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.payments where quotation_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'payments', count_value, '/payments', 'Payment history cannot be deleted.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.invoices where quotation_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'invoices', count_value, '/invoices', 'Invoice history cannot be deleted.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.proforma_invoices where quotation_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'proforma_invoices', count_value, '/proforma-invoices', 'Proforma history cannot be deleted.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where quotation_id = record_id and document_type <> 'quotation_pdf';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/quotations/' || record_id::text, 'Verified or uploaded evidence must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where quotation_id = record_id and document_type = 'quotation_pdf';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'documents', count_value, '/quotations/' || record_id::text, 'Draft-generated PDFs are queued for Storage cleanup.')); owned_count := owned_count + count_value; end if;
      delete_state_allowed := status_value = 'draft';
      archive_state_allowed := status_value in ('accepted', 'rejected', 'expired', 'cancelled');

    when 'projects' then
      select count(*) into count_value from public.payments where project_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'payments', count_value, '/payments', 'Cancel incorrect payments; never delete financial history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.invoices where project_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'invoices', count_value, '/invoices', 'Invoice history must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.proforma_invoices where project_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'proforma_invoices', count_value, '/proforma-invoices', 'Proforma history must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.inventory_transactions where project_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'inventory_transactions', count_value, '/inventory', 'Stock history is append-only; reverse mistakes with a compensating transaction.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where project_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/projects/' || record_id::text, 'Archive retained project evidence.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value = 'created' and coalesce(snapshot ->> 'quotation_id', '') = '';
      archive_state_allowed := status_value in ('commissioned', 'cancelled');

    when 'payments' then
      dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'financial_history', 1, '/payments/' || record_id::text, 'Payments are immutable financial history. Cancel an incorrect received payment.'));
      historical_count := historical_count + 1;
      delete_state_allowed := false;
      archive_state_allowed := status_value in ('failed', 'cancelled');
      guidance := 'Payments can never be permanently deleted.';

    when 'b2b_sales' then
      select count(*) into count_value from public.b2b_sale_items where b2b_sale_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'b2b_sale_items', count_value, '/b2b-sales/' || record_id::text, 'Draft sale lines are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.invoices where b2b_sale_id = record_id;
      select count(*) + count_value into count_value from public.proforma_invoices where b2b_sale_id = record_id;
      select count(*) + count_value into count_value from public.payments where b2b_sale_id = record_id;
      select count(*) + count_value into count_value from public.inventory_transactions where reference_id = record_id and reference_type = 'b2b_sale';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'sale_workflow', count_value, '/b2b-sales/' || record_id::text, 'Resolve billing, payment, dispatch, reservations, and stock history before archiving.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value = 'draft';
      archive_state_allowed := status_value in ('dispatched', 'cancelled');

    when 'proforma_invoices' then
      select count(*) into count_value from public.proforma_invoice_items where proforma_invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'proforma_invoice_items', count_value, '/proforma-invoices/' || record_id::text, 'Draft lines are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.payments where proforma_invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'payments', count_value, '/payments', 'Cancel received payments before cancelling the proforma.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.invoices where proforma_invoice_id = record_id or id = nullif(snapshot ->> 'final_invoice_id', '')::uuid;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'invoices', count_value, '/invoices', 'Converted final invoices are immutable history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where proforma_invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/proforma-invoices/' || record_id::text, 'Retain generated or verified billing evidence.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value = 'draft';
      archive_state_allowed := status_value in ('converted', 'cancelled');

    when 'invoices' then
      select count(*) into count_value from public.invoice_items where invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'invoice_items', count_value, '/invoices/' || record_id::text, 'Draft lines are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.payments where invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'payments', count_value, '/payments', 'Cancel linked payments before cancelling; never delete payment history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where invoice_id = record_id and document_type <> 'invoice_pdf';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'documents', count_value, '/invoices/' || record_id::text, 'Verified evidence must be retained.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.documents where invoice_id = record_id and document_type = 'invoice_pdf';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'documents', count_value, '/invoices/' || record_id::text, 'Draft-generated PDFs are queued for Storage cleanup.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.b2b_sales where invoice_id = record_id;
      select count(*) + count_value into count_value from public.proforma_invoices where final_invoice_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'billing_links', count_value, '/invoices/' || record_id::text, 'B2B and proforma conversion links must be retained.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value = 'draft';
      archive_state_allowed := status_value in ('paid', 'cancelled');

    when 'purchase_orders' then
      select count(*) into count_value from public.purchase_order_items where purchase_order_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'purchase_order_items', count_value, '/purchases/' || record_id::text, 'Completely unreceived lines are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.documents where purchase_order_id = record_id and document_type = 'purchase_order_pdf';
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'documents', count_value, '/purchases/' || record_id::text, 'Generated PO files are queued for Storage cleanup.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value from public.purchase_order_items where purchase_order_id = record_id and coalesce(received_quantity, 0) > 0;
      select count(*) + count_value into count_value from public.inventory_batches where purchase_order_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'receiving_history', count_value, '/purchases/' || record_id::text, 'Received material permanently blocks deletion. Cancel only remaining quantities and retain stock history.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := status_value in ('draft', 'ordered');
      archive_state_allowed := status_value in ('received', 'cancelled');

    when 'vendors' then
      select count(*) into count_value from public.purchase_orders where vendor_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'purchase_orders', count_value, '/purchases', 'Resolve open orders and preserve supplier history.')); historical_count := historical_count + count_value; end if;
      select count(*) into count_value from public.inventory_items where vendor_id = record_id;
      select count(*) + count_value into count_value from public.inventory_batches where vendor_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'inventory', count_value, '/inventory', 'Inventory and batch supplier history must be retained.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := true;
      archive_state_allowed := status_value in ('inactive', 'blacklisted');
      select count(*) into count_value from public.purchase_orders where vendor_id = record_id and status not in ('received', 'cancelled');
      blocker_count := blocker_count + count_value;

    when 'inventory_items' then
      select count(*) into count_value from public.inventory_transactions where item_id = record_id;
      select count(*) + count_value into count_value from public.inventory_batches where inventory_item_id = record_id;
      select count(*) + count_value into count_value from public.inventory_reservations where inventory_item_id = record_id;
      select count(*) + count_value into count_value from public.purchase_order_items where item_id = record_id;
      select count(*) + count_value into count_value from public.b2b_sale_items where inventory_item_id = record_id;
      select count(*) + count_value into count_value from public.invoice_items where inventory_item_id = record_id;
      select count(*) + count_value into count_value from public.proforma_invoice_items where inventory_item_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'inventory_usage', count_value, '/inventory/' || record_id::text, 'Used inventory records and stock history must be retained.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := coalesce((snapshot ->> 'current_stock')::numeric, 0) = 0;
      archive_state_allowed := status_value in ('inactive', 'discontinued') and coalesce((snapshot ->> 'current_stock')::numeric, 0) = 0
        and not exists (select 1 from public.inventory_reservations where inventory_item_id = record_id and status in ('active', 'partial', 'shortage'));

    when 'documents' then
      dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'storage_objects', 1, null, 'Metadata is removed only after idempotent Storage cleanup succeeds.'));
      owned_count := owned_count + 1;
      delete_state_allowed := status_value = 'pending' and coalesce(snapshot ->> 'verified_at', '') = '';
      archive_state_allowed := status_value in ('verified', 'rejected', 'expired');

    when 'products' then
      select count(*) into count_value from public.inventory_items where catalog_product_id = record_id;
      select count(*) + count_value into count_value from public.inventory_batches where product_id = record_id;
      select count(*) + count_value into count_value from public.quotation_bom_items where product_id = record_id;
      select count(*) + count_value into count_value from public.product_price_history where product_id = record_id;
      select count(*) + count_value into count_value from public.product_prices where product_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'product_usage', count_value, '/products-materials/products/' || record_id::text, 'Used products and pricing history must be retained.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := true;
      archive_state_allowed := status_value in ('inactive', 'discontinued');

    when 'product_categories' then
      select count(*) into count_value from public.products where category_id = record_id;
      select count(*) + count_value into count_value from public.bom_templates where category_id = record_id;
      select count(*) + count_value into count_value from public.bom_template_lines where product_category_id = record_id;
      select count(*) + count_value into count_value from public.quotation_bom_items where product_category_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'category_usage', count_value, '/products-materials/categories', 'Reassign future catalog use or archive the category; historical BOM references remain.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := true;
      archive_state_allowed := status_value = 'inactive';

    when 'bom_templates' then
      select count(*) into count_value from public.bom_template_lines where bom_template_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('owned', 'bom_template_lines', count_value, '/products-materials', 'Unused template rules are owned components.')); owned_count := owned_count + count_value; end if;
      select count(*) into count_value
      from public.quotation_bom_items
      join public.bom_template_lines on bom_template_lines.id = quotation_bom_items.bom_template_rule_id
      where bom_template_lines.bom_template_id = record_id;
      if count_value > 0 then dependencies := dependencies || jsonb_build_array(public.lifecycle_dependency('historical', 'quotation_bom_items', count_value, '/quotations', 'Generated quotation BOMs are immutable snapshots.')); historical_count := historical_count + count_value; end if;
      delete_state_allowed := not exists (select 1 from public.bom_template_lines where bom_template_id = record_id);
      archive_state_allowed := status_value = 'inactive';
  end case;

  blocker_count := blocker_count + historical_count;

  if normalized_action = 'archive' then
    allowed_value := permission_allowed
      and coalesce(snapshot ->> 'archived_at', '') = ''
      and archive_state_allowed
      and (normalized_module not in ('customers', 'vendors') or blocker_count = historical_count);
    recommended_action := case when allowed_value then 'archive' else 'resolve_dependencies' end;
  elsif normalized_action = 'restore' then
    allowed_value := permission_allowed and coalesce(snapshot ->> 'archived_at', '') <> '';
    recommended_action := case when allowed_value then 'restore' else 'none' end;
  else
    allowed_value := permission_allowed
      and public.current_user_is_tenant_admin()
      and coalesce(snapshot ->> 'archived_at', '') = ''
      and delete_state_allowed
      and historical_count = 0;
    recommended_action := case when allowed_value then 'delete' else 'archive' end;
  end if;

  if guidance is null then
    guidance := case
      when not permission_allowed then 'You do not have the required module permission.'
      when normalized_action = 'delete' and not public.current_user_is_tenant_admin() then 'Permanent deletion is restricted to tenant Admins and platform super admins.'
      when normalized_action = 'delete' and historical_count > 0 then 'Historical dependencies make this record archive-only.'
      when normalized_action = 'delete' and not delete_state_allowed then 'The record status or processing state prevents permanent deletion.'
      when normalized_action = 'archive' and not archive_state_allowed then 'Resolve open work or move the record to a terminal business status before archiving.'
      else 'The server will recheck authorization, status, and dependencies inside the final transaction.'
    end;
  end if;

  return jsonb_build_object(
    'allowed', allowed_value,
    'module_key', normalized_module,
    'record_id', record_id,
    'label', label_value,
    'action', normalized_action,
    'business_status', status_value,
    'archived_at', snapshot ->> 'archived_at',
    'recommended_action', recommended_action,
    'owned_child_count', owned_count,
    'blocking_dependency_count', historical_count,
    'dependencies', dependencies,
    'guidance', guidance,
    'confirmation', label_value
  );
end;
$$;

create or replace function public.archive_record(module_key text, record_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  preview jsonb;
  normalized_module text := lower(btrim(module_key));
  clean_reason text := nullif(btrim(reason), '');
  result jsonb;
begin
  if clean_reason is null then raise exception 'Archive reason is required' using errcode = '23514'; end if;
  preview := public.preview_record_lifecycle(normalized_module, record_id, 'archive');
  if not (preview ->> 'allowed')::boolean then raise exception '%', preview ->> 'guidance' using errcode = '23514'; end if;

  perform set_config('app.lifecycle_transition', 'on', true);
  case normalized_module
    when 'customers' then update public.customers set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(customers.*) into result;
    when 'leads' then update public.leads set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(leads.*) into result;
    when 'site_surveys' then update public.site_surveys set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(site_surveys.*) into result;
    when 'quotations' then update public.quotations set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(quotations.*) into result;
    when 'projects' then update public.projects set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(projects.*) into result;
    when 'payments' then update public.payments set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(payments.*) into result;
    when 'b2b_sales' then update public.b2b_sales set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(b2b_sales.*) into result;
    when 'proforma_invoices' then update public.proforma_invoices set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(proforma_invoices.*) into result;
    when 'invoices' then update public.invoices set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(invoices.*) into result;
    when 'purchase_orders' then update public.purchase_orders set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(purchase_orders.*) into result;
    when 'vendors' then update public.vendors set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(vendors.*) into result;
    when 'inventory_items' then update public.inventory_items set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(inventory_items.*) into result;
    when 'documents' then update public.documents set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(documents.*) into result;
    when 'products' then update public.products set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(products.*) into result;
    when 'product_categories' then update public.product_categories set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(product_categories.*) into result;
    when 'bom_templates' then update public.bom_templates set archived_at = now(), archived_by = public.current_user_profile_id(), archive_reason = clean_reason where id = record_id returning to_jsonb(bom_templates.*) into result;
  end case;
  perform public.create_activity_log(normalized_module, record_id, 'archive', null, jsonb_build_object('reason', clean_reason, 'record', result, 'dependency_summary', preview));
  return result;
end;
$$;

create or replace function public.restore_record(module_key text, record_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  preview jsonb;
  normalized_module text := lower(btrim(module_key));
  clean_reason text := nullif(btrim(reason), '');
  old_snapshot jsonb;
  result jsonb;
begin
  if clean_reason is null then raise exception 'Restore reason is required' using errcode = '23514'; end if;
  preview := public.preview_record_lifecycle(normalized_module, record_id, 'restore');
  if not (preview ->> 'allowed')::boolean then raise exception '%', preview ->> 'guidance' using errcode = '23514'; end if;
  old_snapshot := public.lifecycle_record_snapshot(normalized_module, record_id);
  perform set_config('app.lifecycle_transition', 'on', true);
  case normalized_module
    when 'customers' then update public.customers set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(customers.*) into result;
    when 'leads' then update public.leads set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(leads.*) into result;
    when 'site_surveys' then update public.site_surveys set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(site_surveys.*) into result;
    when 'quotations' then update public.quotations set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(quotations.*) into result;
    when 'projects' then update public.projects set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(projects.*) into result;
    when 'payments' then update public.payments set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(payments.*) into result;
    when 'b2b_sales' then update public.b2b_sales set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(b2b_sales.*) into result;
    when 'proforma_invoices' then update public.proforma_invoices set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(proforma_invoices.*) into result;
    when 'invoices' then update public.invoices set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(invoices.*) into result;
    when 'purchase_orders' then update public.purchase_orders set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(purchase_orders.*) into result;
    when 'vendors' then update public.vendors set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(vendors.*) into result;
    when 'inventory_items' then update public.inventory_items set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(inventory_items.*) into result;
    when 'documents' then update public.documents set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(documents.*) into result;
    when 'products' then update public.products set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(products.*) into result;
    when 'product_categories' then update public.product_categories set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(product_categories.*) into result;
    when 'bom_templates' then update public.bom_templates set archived_at = null, archived_by = null, archive_reason = null where id = record_id returning to_jsonb(bom_templates.*) into result;
  end case;
  perform public.create_activity_log(normalized_module, record_id, 'restore', old_snapshot, jsonb_build_object('reason', clean_reason, 'record', result, 'dependency_summary', preview));
  return result;
end;
$$;

create or replace function public.queue_document_storage_cleanup(target_document_id uuid, delete_metadata boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_document public.documents%rowtype;
  target_company_id uuid;
  queue_id uuid;
begin
  select * into target_document from public.documents where id = target_document_id for update;
  if not found then return null; end if;
  select organizations.company_id into target_company_id from public.organizations where id = target_document.organization_id;
  update public.documents set pending_delete_at = coalesce(pending_delete_at, now()) where id = target_document_id;
  insert into public.storage_cleanup_queue(company_id, organization_id, bucket_name, object_path, document_id, resource_table, resource_id, delete_document_metadata)
  values (target_company_id, target_document.organization_id, 'organization-documents', target_document.file_path, target_document.id, 'documents', target_document.id, delete_metadata)
  on conflict (bucket_name, object_path) do update
  set status = case when public.storage_cleanup_queue.status = 'completed' then 'completed' else 'pending' end,
      last_error = null
  returning id into queue_id;
  return queue_id;
end;
$$;

create or replace function public.permanently_delete_record(module_key text, record_id uuid, reason text, confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_module text := lower(btrim(module_key));
  clean_reason text := nullif(btrim(reason), '');
  preview jsonb;
  snapshot jsonb;
  document_row record;
  queued_count integer := 0;
begin
  if clean_reason is null then raise exception 'Deletion reason is required' using errcode = '23514'; end if;
  -- Locks the parent before the final preview so concurrent dependency creation
  -- either waits or is observed by the deleting transaction.
  snapshot := public.lifecycle_record_snapshot(normalized_module, record_id);
  case normalized_module
    when 'customers' then perform 1 from public.customers where id = record_id for update;
    when 'leads' then perform 1 from public.leads where id = record_id for update;
    when 'site_surveys' then perform 1 from public.site_surveys where id = record_id for update;
    when 'quotations' then perform 1 from public.quotations where id = record_id for update;
    when 'projects' then perform 1 from public.projects where id = record_id for update;
    when 'payments' then perform 1 from public.payments where id = record_id for update;
    when 'b2b_sales' then perform 1 from public.b2b_sales where id = record_id for update;
    when 'proforma_invoices' then perform 1 from public.proforma_invoices where id = record_id for update;
    when 'invoices' then perform 1 from public.invoices where id = record_id for update;
    when 'purchase_orders' then perform 1 from public.purchase_orders where id = record_id for update;
    when 'vendors' then perform 1 from public.vendors where id = record_id for update;
    when 'inventory_items' then perform 1 from public.inventory_items where id = record_id for update;
    when 'documents' then perform 1 from public.documents where id = record_id for update;
    when 'products' then perform 1 from public.products where id = record_id for update;
    when 'product_categories' then perform 1 from public.product_categories where id = record_id for update;
    when 'bom_templates' then perform 1 from public.bom_templates where id = record_id for update;
  end case;
  preview := public.preview_record_lifecycle(normalized_module, record_id, 'delete');
  if not (preview ->> 'allowed')::boolean then raise exception '%', preview ->> 'guidance' using errcode = '23514'; end if;
  if btrim(coalesce(confirmation, '')) <> preview ->> 'confirmation' then raise exception 'Typed confirmation does not match the record code or name' using errcode = '23514'; end if;

  perform public.create_activity_log(normalized_module, record_id, 'permanent_delete', snapshot, jsonb_build_object('reason', clean_reason, 'dependency_summary', preview));
  perform set_config('app.lifecycle_delete', 'on', true);
  perform set_config('app.lifecycle_transition', 'on', true);

  if normalized_module = 'documents' then
    perform public.queue_document_storage_cleanup(record_id, true);
    return jsonb_build_object('deleted', false, 'cleanup_queued', true, 'record_id', record_id);
  end if;

  if normalized_module = 'quotations' then
    for document_row in select id from public.documents where quotation_id = record_id and document_type = 'quotation_pdf' loop perform public.queue_document_storage_cleanup(document_row.id, true); queued_count := queued_count + 1; end loop;
  elsif normalized_module = 'invoices' then
    for document_row in select id from public.documents where invoice_id = record_id and document_type = 'invoice_pdf' loop perform public.queue_document_storage_cleanup(document_row.id, true); queued_count := queued_count + 1; end loop;
  elsif normalized_module = 'purchase_orders' then
    for document_row in select id from public.documents where purchase_order_id = record_id and document_type = 'purchase_order_pdf' loop perform public.queue_document_storage_cleanup(document_row.id, true); queued_count := queued_count + 1; end loop;
  end if;

  case normalized_module
    when 'customers' then delete from public.customers where id = record_id;
    when 'leads' then delete from public.leads where id = record_id;
    when 'site_surveys' then delete from public.site_surveys where id = record_id;
    when 'quotations' then delete from public.quotations where id = record_id;
    when 'projects' then delete from public.projects where id = record_id;
    when 'b2b_sales' then delete from public.b2b_sales where id = record_id;
    when 'proforma_invoices' then delete from public.proforma_invoices where id = record_id;
    when 'invoices' then delete from public.invoices where id = record_id;
    when 'purchase_orders' then delete from public.purchase_orders where id = record_id;
    when 'vendors' then delete from public.vendors where id = record_id;
    when 'inventory_items' then delete from public.inventory_items where id = record_id;
    when 'products' then delete from public.products where id = record_id;
    when 'product_categories' then delete from public.product_categories where id = record_id;
    when 'bom_templates' then delete from public.bom_templates where id = record_id;
    else raise exception 'This module does not support permanent deletion' using errcode = '23514';
  end case;
  return jsonb_build_object('deleted', true, 'cleanup_queued_count', queued_count, 'record_id', record_id);
end;
$$;

revoke execute on function public.lifecycle_record_snapshot(text, uuid) from public, authenticated;
revoke execute on function public.lifecycle_dependency(text, text, integer, text, text, uuid, text) from public, authenticated;
revoke execute on function public.queue_document_storage_cleanup(uuid, boolean) from public, authenticated;
grant execute on function public.preview_record_lifecycle(text, uuid, text) to authenticated;
grant execute on function public.archive_record(text, uuid, text) to authenticated;
grant execute on function public.restore_record(text, uuid, text) to authenticated;
grant execute on function public.permanently_delete_record(text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
