-- Record lifecycle foundation: reversible archive metadata, immutable financial/
-- inventory history, received-purchase guards, and deferred Storage cleanup.

alter table public.customers add column if not exists archived_at timestamptz;
alter table public.customers add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.customers add column if not exists archive_reason text;

alter table public.leads add column if not exists archived_at timestamptz;
alter table public.leads add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.leads add column if not exists archive_reason text;

alter table public.site_surveys add column if not exists archived_at timestamptz;
alter table public.site_surveys add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.site_surveys add column if not exists archive_reason text;

alter table public.quotations add column if not exists archived_at timestamptz;
alter table public.quotations add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.quotations add column if not exists archive_reason text;

alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.projects add column if not exists archive_reason text;

alter table public.payments add column if not exists archived_at timestamptz;
alter table public.payments add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.payments add column if not exists archive_reason text;
alter table public.payments add column if not exists cancelled_at timestamptz;
alter table public.payments add column if not exists cancelled_by uuid references public.users_profile(id) on delete set null;
alter table public.payments add column if not exists cancellation_reason text;

alter table public.b2b_sales add column if not exists archived_at timestamptz;
alter table public.b2b_sales add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.b2b_sales add column if not exists archive_reason text;

alter table public.proforma_invoices add column if not exists archived_at timestamptz;
alter table public.proforma_invoices add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.proforma_invoices add column if not exists archive_reason text;

alter table public.invoices add column if not exists archived_at timestamptz;
alter table public.invoices add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.invoices add column if not exists archive_reason text;

alter table public.purchase_orders add column if not exists archived_at timestamptz;
alter table public.purchase_orders add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.purchase_orders add column if not exists archive_reason text;

alter table public.vendors add column if not exists archived_at timestamptz;
alter table public.vendors add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.vendors add column if not exists archive_reason text;

alter table public.inventory_items add column if not exists archived_at timestamptz;
alter table public.inventory_items add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.inventory_items add column if not exists archive_reason text;

alter table public.documents add column if not exists archived_at timestamptz;
alter table public.documents add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.documents add column if not exists archive_reason text;
alter table public.documents add column if not exists pending_delete_at timestamptz;

alter table public.products add column if not exists archived_at timestamptz;
alter table public.products add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.products add column if not exists archive_reason text;

alter table public.product_categories add column if not exists archived_at timestamptz;
alter table public.product_categories add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.product_categories add column if not exists archive_reason text;

alter table public.bom_templates add column if not exists archived_at timestamptz;
alter table public.bom_templates add column if not exists archived_by uuid references public.users_profile(id) on delete set null;
alter table public.bom_templates add column if not exists archive_reason text;

alter table public.inventory_transactions
add column if not exists reversal_of_transaction_id uuid references public.inventory_transactions(id) on delete restrict;
alter table public.inventory_transactions add column if not exists reversal_reason text;

create unique index if not exists inventory_transactions_single_reversal_idx
on public.inventory_transactions (reversal_of_transaction_id)
where reversal_of_transaction_id is not null;

-- Archive fields are presentation lifecycle only. Codes and natural keys remain
-- unique across active and archived rows.
create index if not exists customers_active_lifecycle_idx on public.customers (organization_id, archived_at);
create index if not exists leads_active_lifecycle_idx on public.leads (organization_id, archived_at);
create index if not exists site_surveys_active_lifecycle_idx on public.site_surveys (organization_id, archived_at);
create index if not exists quotations_active_lifecycle_idx on public.quotations (organization_id, archived_at);
create index if not exists projects_active_lifecycle_idx on public.projects (organization_id, archived_at);
create index if not exists payments_active_lifecycle_idx on public.payments (organization_id, archived_at);
create index if not exists b2b_sales_active_lifecycle_idx on public.b2b_sales (organization_id, archived_at);
create index if not exists proforma_invoices_active_lifecycle_idx on public.proforma_invoices (organization_id, archived_at);
create index if not exists invoices_active_lifecycle_idx on public.invoices (organization_id, archived_at);
create index if not exists purchase_orders_active_lifecycle_idx on public.purchase_orders (organization_id, archived_at);
create index if not exists vendors_active_lifecycle_idx on public.vendors (organization_id, archived_at);
create index if not exists inventory_items_active_lifecycle_idx on public.inventory_items (organization_id, archived_at);
create index if not exists documents_active_lifecycle_idx on public.documents (organization_id, archived_at);
create index if not exists products_active_lifecycle_idx on public.products (tenant_id, archived_at);
create index if not exists product_categories_active_lifecycle_idx on public.product_categories (tenant_id, archived_at);
create index if not exists bom_templates_active_lifecycle_idx on public.bom_templates (tenant_id, archived_at);

-- New operational table follows the SaaS company + organization ownership model.
create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_name text not null,
  object_path text not null,
  document_id uuid references public.documents(id) on delete set null,
  resource_table text,
  resource_id uuid,
  delete_document_metadata boolean not null default false,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (bucket_name, object_path)
);

alter table public.storage_cleanup_queue enable row level security;

drop policy if exists "Super admins can view storage cleanup queue" on public.storage_cleanup_queue;
create policy "Super admins can view storage cleanup queue"
on public.storage_cleanup_queue for select to authenticated
using (public.is_super_admin());

create index if not exists storage_cleanup_queue_pending_idx
on public.storage_cleanup_queue (status, created_at)
where status in ('pending', 'failed');

create or replace function public.current_user_is_tenant_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1
    from public.user_roles
    join public.roles on roles.id = user_roles.role_id
    where (
        user_roles.user_profile_id = public.current_user_profile_id()
        or user_roles.user_id = auth.uid()
      )
      and roles.organization_id = public.current_user_organization_id()
      and coalesce(roles.role_key, lower(btrim(roles.role_name))) = 'admin'
  );
$$;

grant execute on function public.current_user_is_tenant_admin() to authenticated;

create or replace function public.lifecycle_permission_module(target_module text)
returns text
language sql
immutable
as $$
  select case lower(btrim(target_module))
    when 'customers' then 'customers'
    when 'leads' then 'leads'
    when 'site_surveys' then 'site_surveys'
    when 'quotations' then 'quotations'
    when 'projects' then 'projects'
    when 'payments' then 'payments'
    when 'b2b_sales' then 'b2b_sales'
    when 'proforma_invoices' then 'invoices'
    when 'invoices' then 'invoices'
    when 'purchase_orders' then 'inventory'
    when 'vendors' then 'vendors'
    when 'inventory_items' then 'inventory'
    when 'documents' then 'documents'
    when 'products' then 'product_master'
    when 'product_categories' then 'product_master'
    when 'bom_templates' then 'product_master'
    else null
  end;
$$;

create or replace function public.set_archive_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.archived_at is not null
    and coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'Records must be archived through archive_record'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.archived_at is distinct from new.archived_at
    and coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'Archive state must be changed through the lifecycle API'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.archived_at is not null
    and coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'Archived records are read-only. Restore the record before editing it.'
      using errcode = '23514';
  end if;

  if new.archived_at is not null then
    if nullif(btrim(coalesce(new.archive_reason, '')), '') is null then
      raise exception 'An archive reason is required'
        using errcode = '23514';
    end if;
    new.archived_by := coalesce(new.archived_by, public.current_user_profile_id());
  else
    new.archived_by := null;
    new.archive_reason := null;
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'customers', 'leads', 'site_surveys', 'quotations', 'projects', 'payments',
    'b2b_sales', 'proforma_invoices', 'invoices', 'purchase_orders', 'vendors',
    'inventory_items', 'documents', 'products', 'product_categories', 'bom_templates'
  ] loop
    execute format('drop trigger if exists enforce_%I_archive_metadata on public.%I', target_table, target_table);
    execute format(
      'create trigger enforce_%I_archive_metadata before insert or update on public.%I for each row execute function public.set_archive_metadata()',
      target_table,
      target_table
    );
  end loop;
end;
$$;

-- Root records may only be physically deleted from a guarded lifecycle RPC.
create or replace function public.guard_lifecycle_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() <= 1
    and coalesce(current_setting('app.lifecycle_delete', true), '') <> 'on' then
    raise exception 'Permanent deletion must use permanently_delete_record'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'customers', 'leads', 'site_surveys', 'quotations', 'projects', 'payments',
    'b2b_sales', 'proforma_invoices', 'invoices', 'purchase_orders', 'vendors',
    'inventory_items', 'documents', 'products', 'product_categories', 'bom_templates'
  ] loop
    execute format('drop trigger if exists guard_%I_lifecycle_delete on public.%I', target_table, target_table);
    execute format(
      'create trigger guard_%I_lifecycle_delete before delete on public.%I for each row execute function public.guard_lifecycle_delete()',
      target_table,
      target_table
    );
  end loop;
end;
$$;

-- Project deletion must never remove payment history.
alter table public.payments drop constraint if exists payments_project_id_fkey;
alter table public.payments
add constraint payments_project_id_fkey
foreign key (project_id) references public.projects(id) on delete restrict;

-- A queued draft-generated quotation PDF may outlive its parent briefly while
-- the Storage worker completes; non-generated documents remain delete blockers.
alter table public.documents drop constraint if exists documents_quotation_id_fkey;
alter table public.documents
add constraint documents_quotation_id_fkey
foreign key (quotation_id) references public.quotations(id) on delete set null;

create or replace function public.protect_received_purchase_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  has_receipt boolean;
begin
  select exists (
    select 1 from public.purchase_order_items
    where purchase_order_items.purchase_order_id = old.id
      and coalesce(purchase_order_items.received_quantity, 0) > 0
  ) or exists (
    select 1 from public.inventory_batches
    where inventory_batches.purchase_order_id = old.id
  ) into has_receipt;

  if not has_receipt then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Purchase orders cannot be deleted after material is received. Cancel or archive the order instead.'
      using errcode = '23514';
  end if;

  if (to_jsonb(new) - array[
        'notes', 'expected_delivery_date', 'status', 'archived_at',
        'archived_by', 'archive_reason', 'updated_at'
      ]) is distinct from
     (to_jsonb(old) - array[
        'notes', 'expected_delivery_date', 'status', 'archived_at',
        'archived_by', 'archive_reason', 'updated_at'
      ]) then
    raise exception 'Supplier, dates, prices, totals, and line identity are locked after the first material receipt.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_received_purchase_orders on public.purchase_orders;
create trigger protect_received_purchase_orders
before update or delete on public.purchase_orders
for each row execute function public.protect_received_purchase_order();

create or replace function public.protect_received_purchase_order_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_order_id uuid;
  order_has_receipt boolean;
begin
  target_order_id := case
    when tg_op = 'DELETE' then old.purchase_order_id
    else new.purchase_order_id
  end;

  select exists (
    select 1 from public.purchase_order_items
    where purchase_order_items.purchase_order_id = target_order_id
      and coalesce(purchase_order_items.received_quantity, 0) > 0
  ) or exists (
    select 1 from public.inventory_batches
    where inventory_batches.purchase_order_id = target_order_id
  ) into order_has_receipt;

  if not order_has_receipt then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'Purchase-order lines cannot be added or removed after material is received.'
      using errcode = '23514';
  end if;

  if (to_jsonb(new) - array['received_quantity', 'updated_at']) is distinct from
     (to_jsonb(old) - array['received_quantity', 'updated_at']) then
    raise exception 'Purchase-order line identity, quantity, and pricing are locked after material is received.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_received_purchase_order_items on public.purchase_order_items;
create trigger protect_received_purchase_order_items
before insert or update or delete on public.purchase_order_items
for each row execute function public.protect_received_purchase_order_item();

create or replace function public.protect_payment_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'failed' then
    return new;
  end if;

  if old.status = 'received'
    and new.status = 'cancelled'
    and coalesce(current_setting('app.payment_transition', true), '') = 'on'
    and (to_jsonb(new) - array[
          'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason',
          'archived_at', 'archived_by', 'archive_reason', 'updated_at'
        ]) is not distinct from
        (to_jsonb(old) - array[
          'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason',
          'archived_at', 'archived_by', 'archive_reason', 'updated_at'
        ]) then
    return new;
  end if;

  if (to_jsonb(new) - array['archived_at', 'archived_by', 'archive_reason', 'updated_at'])
      is distinct from
     (to_jsonb(old) - array['archived_at', 'archived_by', 'archive_reason', 'updated_at']) then
    raise exception 'Received and cancelled payments are immutable. Cancel a received payment and create a corrected record.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_received_payment_history on public.payments;
create trigger protect_received_payment_history
before update on public.payments
for each row execute function public.protect_payment_history();

create or replace function public.prevent_inventory_transaction_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Inventory transactions are append-only. Create a reversal transaction instead.'
    using errcode = '23514';
end;
$$;

drop trigger if exists prevent_inventory_transaction_updates on public.inventory_transactions;
create trigger prevent_inventory_transaction_updates
before update or delete on public.inventory_transactions
for each row execute function public.prevent_inventory_transaction_mutation();

-- Direct role deletion would bypass the locked standard-role RPC.
create or replace function public.prevent_standard_role_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if coalesce(old.is_system_role, false) or old.role_key in ('admin', 'sales', 'backend', 'accounts') then
    raise exception 'Standard roles cannot be deleted'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_locked_role_delete on public.roles;
create trigger prevent_locked_role_delete
before delete on public.roles
for each row execute function public.prevent_standard_role_delete();

revoke execute on function public.set_archive_metadata() from public, authenticated;
revoke execute on function public.guard_lifecycle_delete() from public, authenticated;
revoke execute on function public.protect_received_purchase_order() from public, authenticated;
revoke execute on function public.protect_received_purchase_order_item() from public, authenticated;
revoke execute on function public.protect_payment_history() from public, authenticated;
revoke execute on function public.prevent_inventory_transaction_mutation() from public, authenticated;
revoke execute on function public.prevent_standard_role_delete() from public, authenticated;

notify pgrst, 'reload schema';
