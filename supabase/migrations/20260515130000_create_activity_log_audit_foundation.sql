-- Step 17 activity log / audit trail foundation.
-- Upgrades the existing activity_logs table into an organization-scoped audit
-- trail and attaches audit triggers to important operational tables. No
-- frontend screens are added here.

alter table public.activity_logs add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.activity_logs add column if not exists user_profile_id uuid references public.users_profile(id) on delete set null;
alter table public.activity_logs add column if not exists module text;
alter table public.activity_logs add column if not exists old_data jsonb;
alter table public.activity_logs add column if not exists new_data jsonb;
alter table public.activity_logs add column if not exists ip_address text;
alter table public.activity_logs add column if not exists user_agent text;

update public.activity_logs
set user_profile_id = users_profile.id
from public.users_profile
where activity_logs.user_profile_id is null
  and activity_logs.user_id = users_profile.auth_user_id;

update public.activity_logs
set organization_id = users_profile.organization_id
from public.users_profile
where activity_logs.organization_id is null
  and activity_logs.user_profile_id = users_profile.id;

update public.activity_logs
set module = coalesce(nullif(module, ''), nullif(table_name, ''), 'system')
where module is null or trim(module) = '';

alter table public.activity_logs alter column module set not null;
alter table public.activity_logs alter column created_at set default now();

create index if not exists activity_logs_organization_id_idx
on public.activity_logs (organization_id);

create index if not exists activity_logs_user_profile_id_idx
on public.activity_logs (user_profile_id);

create index if not exists activity_logs_module_idx
on public.activity_logs (module);

create index if not exists activity_logs_record_id_idx
on public.activity_logs (record_id);

create index if not exists activity_logs_action_idx
on public.activity_logs (action);

create index if not exists activity_logs_created_at_idx
on public.activity_logs (created_at);

-- Inserts an activity log row without blocking the caller if logging fails.
create or replace function public.create_activity_log(
  target_module text,
  target_record_id uuid default null,
  target_action text default null,
  target_old_data jsonb default null,
  target_new_data jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.users_profile%rowtype;
  detected_organization_id uuid;
  inserted_log_id uuid;
begin
  select *
  into current_profile
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  detected_organization_id := current_profile.organization_id;

  if detected_organization_id is null then
    detected_organization_id := coalesce(
      nullif(target_new_data ->> 'organization_id', '')::uuid,
      nullif(target_old_data ->> 'organization_id', '')::uuid
    );
  end if;

  insert into public.activity_logs (
    organization_id,
    user_profile_id,
    module,
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    metadata
  )
  values (
    detected_organization_id,
    current_profile.id,
    coalesce(nullif(trim(target_module), ''), 'system'),
    coalesce(nullif(trim(target_module), ''), 'system'),
    target_record_id,
    coalesce(nullif(trim(target_action), ''), 'unknown'),
    target_old_data,
    target_new_data,
    jsonb_build_object(
      'source', 'database',
      'logged_at', now()
    )
  )
  returning id into inserted_log_id;

  return inserted_log_id;
exception
  when others then
    return null;
end;
$$;

-- Generic row-level audit trigger. It intentionally swallows logging failures
-- so business writes are not blocked by audit-log insertion problems.
create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_module text := tg_argv[0];
  audit_record_id uuid;
  audit_old_data jsonb;
  audit_new_data jsonb;
begin
  if tg_op = 'INSERT' then
    audit_record_id := new.id;
    audit_old_data := null;
    audit_new_data := to_jsonb(new);

    perform public.create_activity_log(audit_module, audit_record_id, 'create', audit_old_data, audit_new_data);
    return new;
  elsif tg_op = 'UPDATE' then
    audit_record_id := new.id;
    audit_old_data := to_jsonb(old);
    audit_new_data := to_jsonb(new);

    perform public.create_activity_log(audit_module, audit_record_id, 'update', audit_old_data, audit_new_data);
    return new;
  elsif tg_op = 'DELETE' then
    audit_record_id := old.id;
    audit_old_data := to_jsonb(old);
    audit_new_data := null;

    perform public.create_activity_log(audit_module, audit_record_id, 'delete', audit_old_data, audit_new_data);
    return old;
  end if;

  return coalesce(new, old);
exception
  when others then
    return coalesce(new, old);
end;
$$;

drop trigger if exists audit_customers_changes on public.customers;
create trigger audit_customers_changes
after insert or update or delete on public.customers
for each row
execute function public.audit_table_change('customers');

drop trigger if exists audit_leads_changes on public.leads;
create trigger audit_leads_changes
after insert or update or delete on public.leads
for each row
execute function public.audit_table_change('leads');

drop trigger if exists audit_site_surveys_changes on public.site_surveys;
create trigger audit_site_surveys_changes
after insert or update or delete on public.site_surveys
for each row
execute function public.audit_table_change('site_surveys');

drop trigger if exists audit_quotations_changes on public.quotations;
create trigger audit_quotations_changes
after insert or update or delete on public.quotations
for each row
execute function public.audit_table_change('quotations');

drop trigger if exists audit_projects_changes on public.projects;
create trigger audit_projects_changes
after insert or update or delete on public.projects
for each row
execute function public.audit_table_change('projects');

drop trigger if exists audit_payments_changes on public.payments;
create trigger audit_payments_changes
after insert or update or delete on public.payments
for each row
execute function public.audit_table_change('payments');

drop trigger if exists audit_inventory_items_changes on public.inventory_items;
create trigger audit_inventory_items_changes
after insert or update or delete on public.inventory_items
for each row
execute function public.audit_table_change('inventory_items');

drop trigger if exists audit_inventory_transactions_changes on public.inventory_transactions;
create trigger audit_inventory_transactions_changes
after insert or update or delete on public.inventory_transactions
for each row
execute function public.audit_table_change('inventory_transactions');

drop trigger if exists audit_invoices_changes on public.invoices;
create trigger audit_invoices_changes
after insert or update or delete on public.invoices
for each row
execute function public.audit_table_change('invoices');

do $$
begin
  if to_regclass('public.documents') is not null then
    execute 'drop trigger if exists audit_documents_changes on public.documents';
    execute 'create trigger audit_documents_changes
      after insert or update or delete on public.documents
      for each row
      execute function public.audit_table_change(''documents'')';
  end if;
end;
$$;

alter table public.activity_logs enable row level security;

drop policy if exists "Platform admins can manage activity logs" on public.activity_logs;
drop policy if exists "Company users can view own company activity logs" on public.activity_logs;
drop policy if exists "Company users can create own company activity logs with permission" on public.activity_logs;
drop policy if exists "Company users can update own company activity logs with permission" on public.activity_logs;
drop policy if exists "Company users can delete own company activity logs with permission" on public.activity_logs;
drop policy if exists "Super admins can view activity logs" on public.activity_logs;
drop policy if exists "Organization admins can view activity logs" on public.activity_logs;
drop policy if exists "Authenticated users can insert activity logs" on public.activity_logs;

-- Super admins can view every log across every organization.
create policy "Super admins can view activity logs"
on public.activity_logs
for select
to authenticated
using (public.is_super_admin());

-- Organization admins and report viewers can view logs inside their organization.
create policy "Organization admins can view activity logs"
on public.activity_logs
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.user_has_permission('settings', 'view')
    or public.user_has_permission('reports', 'view')
  )
);

-- Direct inserts are allowed only inside the caller organization. Trigger and
-- helper based logging run as security definer and use the same tenant fields.
create policy "Authenticated users can insert activity logs"
on public.activity_logs
for insert
to authenticated
with check (
  public.is_super_admin()
  or (
    organization_id = public.current_user_organization_id()
    and (
      user_profile_id is null
      or exists (
        select 1
        from public.users_profile
        where users_profile.id = activity_logs.user_profile_id
          and users_profile.organization_id = public.current_user_organization_id()
      )
    )
  )
);

revoke execute on function public.audit_table_change() from public;
revoke execute on function public.create_activity_log(text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.create_activity_log(text, uuid, text, jsonb, jsonb) to authenticated;
