-- Give Backend staff a purchase-order-specific update permission. Do not grant
-- product_pricing:update: that would also allow changing Product Master prices,
-- which is broader than purchase-order editing.

insert into public.modules (module_key, module_name, description, sort_order, is_active)
values (
  'purchases',
  'Purchases',
  'Purchase order workflow permissions',
  387,
  true
)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.permissions (module_id, action_key, action_name)
select
  modules.id,
  actions.action_key,
  actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('update', 'Update'),
    ('delete', 'Delete')
) as actions(action_key, action_name)
where modules.module_key = 'purchases'
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;

create or replace function public.seed_epc_standard_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_record record;
  target_role_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required'
      using errcode = '23502';
  end if;

  for role_record in
    select *
    from (
      values
        ('admin', 'Admin', 'Full workspace administration with all controls.', 10),
        ('sales_team', 'Sales', 'Leads, customers, sales, projects, and quotation access without product pricing.', 20),
        ('backend_team', 'Backend', 'Operational access across CRM, projects, quotations, products, categories, inventory, purchases, payments, and invoices without delete access.', 30),
        ('accounts', 'Accounts', 'Invoice, quotation, payment, and purchase access for accounts teams.', 40)
    ) as standard_roles(role_key, role_name, description, sort_order)
    order by standard_roles.sort_order
  loop
    insert into public.roles (
      organization_id,
      role_key,
      role_name,
      description,
      is_system_role
    )
    values (
      target_organization_id,
      role_record.role_key,
      role_record.role_name,
      role_record.description,
      true
    )
    on conflict (organization_id, role_key) where role_key is not null do update
    set
      role_name = excluded.role_name,
      description = excluded.description,
      is_system_role = true,
      updated_at = now()
    returning id into target_role_id;

    delete from public.role_permissions
    where role_permissions.role_id = target_role_id;

    if role_record.role_key = 'admin' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'sales_team' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('leads', 'view'), ('leads', 'create'), ('leads', 'update'),
          ('customers', 'view'), ('customers', 'create'), ('customers', 'update'),
          ('b2b_sales', 'view'), ('b2b_sales', 'create'), ('b2b_sales', 'update'),
          ('projects', 'view'), ('projects', 'create'), ('projects', 'update'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'backend_team' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('leads', 'view'), ('leads', 'create'), ('leads', 'update'),
          ('customers', 'view'), ('customers', 'create'), ('customers', 'update'),
          ('projects', 'view'), ('projects', 'create'), ('projects', 'update'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update'),
          ('product_master', 'view'), ('product_master', 'create'), ('product_master', 'update'),
          ('product_pricing', 'view'), ('product_pricing', 'create'),
          ('purchases', 'update'),
          ('inventory', 'view'), ('inventory', 'create'), ('inventory', 'update'),
          ('vendors', 'view'), ('vendors', 'create'), ('vendors', 'update'),
          ('payments', 'view'), ('payments', 'create'), ('payments', 'update'),
          ('invoices', 'view'), ('invoices', 'create'), ('invoices', 'update'),
          ('documents', 'view'), ('documents', 'create'), ('documents', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    elsif role_record.role_key = 'accounts' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, permissions.id
      from public.permissions
      join public.modules on modules.id = permissions.module_id
      join (
        values
          ('dashboard', 'view'),
          ('quotations', 'view'), ('quotations', 'create'), ('quotations', 'update'),
          ('invoices', 'view'), ('invoices', 'create'), ('invoices', 'update'),
          ('payments', 'view'), ('payments', 'create'), ('payments', 'update'),
          ('inventory', 'view'), ('inventory', 'create'), ('inventory', 'update'),
          ('product_pricing', 'view'), ('product_pricing', 'create'), ('product_pricing', 'update')
      ) as allowed(module_key, action_key)
        on allowed.module_key = modules.module_key
       and allowed.action_key = permissions.action_key
      where modules.is_active = true
      on conflict (role_id, permission_id) do nothing;
    end if;
  end loop;
end;
$$;

-- Backfill every existing tenant Backend role immediately without resetting
-- any unrelated permissions that may have been assigned separately.
insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on true
join public.modules on modules.id = permissions.module_id
where roles.role_key = 'backend_team'
  and coalesce(roles.is_system_role, false)
  and modules.module_key = 'purchases'
  and permissions.action_key = 'update'
on conflict (role_id, permission_id) do nothing;

drop policy if exists "Organization pricing users can update purchase orders"
on public.purchase_orders;

create policy "Organization pricing users can update purchase orders"
on public.purchase_orders
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  )
);

drop policy if exists "Organization pricing users can update purchase order items"
on public.purchase_order_items;

create policy "Organization pricing users can update purchase order items"
on public.purchase_order_items
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  )
)
with check (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  )
);

drop policy if exists "Organization pricing users can delete purchase order items"
on public.purchase_order_items;

create policy "Organization pricing users can delete purchase order items"
on public.purchase_order_items
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'delete')
      and public.user_has_permission('product_pricing', 'delete')
    )
  )
);

create or replace function public.update_received_purchase_order(
  target_purchase_order_id uuid,
  bill_invoice_no text default null,
  target_expected_delivery_date date default null,
  target_notes text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.purchase_orders%rowtype;
  clean_bill_invoice_no text := nullif(btrim(coalesce(bill_invoice_no, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not (
    public.is_super_admin()
    or public.user_has_permission('purchases', 'update')
    or (
      public.user_has_permission('inventory', 'update')
      and public.user_has_permission('product_pricing', 'update')
    )
  ) then
    raise exception 'Purchase order update permission is required'
      using errcode = '42501';
  end if;

  select *
  into order_record
  from public.purchase_orders
  where id = target_purchase_order_id
  for update;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and order_record.organization_id <> public.current_user_organization_id() then
    raise exception 'Purchase order belongs to another tenant' using errcode = '42501';
  end if;

  if order_record.archived_at is not null then
    raise exception 'Archived purchase orders are read-only. Restore the order before editing it.'
      using errcode = '23514';
  end if;

  if order_record.status = 'cancelled' then
    raise exception 'Cancelled purchase orders are read-only.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.inventory_batches
    where purchase_order_id = target_purchase_order_id
      and organization_id = order_record.organization_id
  ) then
    raise exception 'Bill / invoice details can be updated here only after material is received.'
      using errcode = '23514';
  end if;

  update public.inventory_batches
  set bill_no = clean_bill_invoice_no
  where purchase_order_id = target_purchase_order_id
    and organization_id = order_record.organization_id;

  update public.inventory_transactions
  set bill_no = clean_bill_invoice_no
  where organization_id = order_record.organization_id
    and transaction_type = 'stock_in'
    and reference_type = 'purchase_order'
    and reference_id = target_purchase_order_id;

  update public.purchase_orders
  set
    expected_delivery_date = target_expected_delivery_date,
    notes = nullif(btrim(coalesce(target_notes, '')), ''),
    updated_at = now()
  where id = target_purchase_order_id
  returning * into order_record;

  return order_record;
end;
$$;

revoke execute on function public.update_received_purchase_order(uuid, text, date, text)
from public, anon;
grant execute on function public.update_received_purchase_order(uuid, text, date, text)
to authenticated;

grant execute on function public.seed_epc_standard_roles(uuid) to authenticated;

notify pgrst, 'reload schema';
