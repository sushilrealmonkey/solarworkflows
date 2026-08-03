-- Tenant-safe in-app operational notifications.

create table public.in_app_notification_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null,
  recipient_user_profile_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint in_app_notification_receipts_event_company_fk
    foreign key (event_id, company_id)
    references public.notification_events(id, company_id)
    on delete cascade,
  constraint in_app_notification_receipts_profile_company_fk
    foreign key (company_id, recipient_user_profile_id)
    references public.users_profile(company_id, id)
    on delete cascade,
  constraint in_app_notification_receipts_event_recipient_key
    unique (company_id, event_id, recipient_user_profile_id)
);

create index in_app_notification_receipts_recipient_feed_idx
on public.in_app_notification_receipts
  (recipient_user_profile_id, created_at desc, id desc);

create index in_app_notification_receipts_recipient_unread_idx
on public.in_app_notification_receipts
  (recipient_user_profile_id, created_at desc, id desc)
where read_at is null;

create trigger set_in_app_notification_receipts_updated_at
before update on public.in_app_notification_receipts
for each row execute function public.set_updated_at();

alter table public.in_app_notification_receipts enable row level security;

create policy "Staff view own in-app notification receipts"
on public.in_app_notification_receipts for select to authenticated
using (
  recipient_user_profile_id = (
    select users_profile.id
    from public.users_profile
    where users_profile.auth_user_id = (select auth.uid())
      and users_profile.company_id = in_app_notification_receipts.company_id
      and users_profile.status = 'active'
    limit 1
  )
);

create policy "Staff update own in-app notification receipts"
on public.in_app_notification_receipts for update to authenticated
using (
  recipient_user_profile_id = (
    select users_profile.id
    from public.users_profile
    where users_profile.auth_user_id = (select auth.uid())
      and users_profile.company_id = in_app_notification_receipts.company_id
      and users_profile.status = 'active'
    limit 1
  )
)
with check (
  recipient_user_profile_id = (
    select users_profile.id
    from public.users_profile
    where users_profile.auth_user_id = (select auth.uid())
      and users_profile.company_id = in_app_notification_receipts.company_id
      and users_profile.status = 'active'
    limit 1
  )
);

create policy "Staff view events for own in-app receipts"
on public.notification_events for select to authenticated
using (
  exists (
    select 1
    from public.in_app_notification_receipts receipts
    join public.users_profile profiles
      on profiles.id = receipts.recipient_user_profile_id
     and profiles.company_id = receipts.company_id
    where receipts.event_id = notification_events.id
      and receipts.company_id = notification_events.company_id
      and profiles.auth_user_id = (select auth.uid())
      and profiles.status = 'active'
  )
);

grant select on public.in_app_notification_receipts to authenticated;

create or replace function public.publish_in_app_notification(
  p_company_id uuid,
  p_event_type text,
  p_source_type text,
  p_source_record_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_event_id uuid;
begin
  if p_company_id is null
    or nullif(btrim(p_event_type), '') is null
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid in-app notification event' using errcode = '22023';
  end if;

  insert into public.notification_events (
    company_id, event_type, source_type, source_record_id,
    idempotency_key, payload, occurred_at
  ) values (
    p_company_id, btrim(p_event_type), nullif(btrim(p_source_type), ''),
    nullif(btrim(p_source_record_id), ''),
    'in_app:' || gen_random_uuid()::text,
    coalesce(p_payload, '{}'::jsonb), now()
  ) returning id into inserted_event_id;

  insert into public.in_app_notification_receipts (
    company_id, event_id, recipient_user_profile_id
  )
  select p_company_id, inserted_event_id, profiles.id
  from public.users_profile profiles
  where profiles.company_id = p_company_id
    and profiles.status = 'active'
    and profiles.auth_user_id is not null
  on conflict do nothing;

  return inserted_event_id;
end;
$$;

revoke all on function public.publish_in_app_notification(uuid, text, text, text, jsonb)
from public, anon, authenticated;

create or replace function public.handle_workflow_in_app_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  organization_id uuid;
  target_company_id uuid;
  actor_name text := 'System';
  event_type text;
  title text;
  message text;
  module_name text;
  record_label text;
  destination_route text;
  old_value text;
  new_value text;
  should_notify boolean := false;
begin
  organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  select organizations.company_id into target_company_id
  from public.organizations
  where organizations.id = organization_id;

  if target_company_id is null then return coalesce(new, old); end if;

  select coalesce(nullif(profiles.full_name, ''), 'Workspace user') into actor_name
  from public.users_profile profiles
  where profiles.auth_user_id = auth.uid()
    and profiles.company_id = target_company_id
  limit 1;
  actor_name := coalesce(actor_name, 'System');

  if tg_table_name = 'leads' then
    module_name := 'leads';
    record_label := coalesce(row_data ->> 'lead_code', row_data ->> 'full_name', 'Lead');
    destination_route := '/leads/' || (row_data ->> 'id');
    if tg_op = 'INSERT' then
      event_type := 'lead_created'; title := 'New lead created';
      message := actor_name || ' created ' || record_label; should_notify := true;
    elsif old_row ->> 'status' is distinct from new_row ->> 'status' then
      event_type := 'lead_status_changed'; title := 'Lead status updated';
      old_value := old_row ->> 'status'; new_value := new_row ->> 'status'; should_notify := true;
    elsif old_row ->> 'assigned_to' is distinct from new_row ->> 'assigned_to' then
      event_type := 'lead_assignment_changed'; title := 'Lead assignment updated'; should_notify := true;
    end if;
  elsif tg_table_name = 'site_surveys' then
    module_name := 'site_surveys'; record_label := coalesce(row_data ->> 'survey_code', 'Site survey');
    destination_route := '/site-surveys/' || (row_data ->> 'id');
    if tg_op = 'INSERT' then
      event_type := 'site_survey_scheduled'; title := 'Site survey scheduled'; should_notify := true;
    elsif old_row ->> 'survey_status' is distinct from new_row ->> 'survey_status' then
      event_type := 'site_survey_status_changed'; title := 'Site survey status updated';
      old_value := old_row ->> 'survey_status'; new_value := new_row ->> 'survey_status'; should_notify := true;
    elsif old_row ->> 'scheduled_date' is distinct from new_row ->> 'scheduled_date'
       or old_row ->> 'scheduled_time' is distinct from new_row ->> 'scheduled_time' then
      event_type := 'site_survey_rescheduled'; title := 'Site survey rescheduled';
      old_value := concat_ws(' ', old_row ->> 'scheduled_date', old_row ->> 'scheduled_time');
      new_value := concat_ws(' ', new_row ->> 'scheduled_date', new_row ->> 'scheduled_time'); should_notify := true;
    elsif old_row ->> 'assigned_to' is distinct from new_row ->> 'assigned_to' then
      event_type := 'site_survey_assignment_changed'; title := 'Site survey assignment updated'; should_notify := true;
    end if;
  elsif tg_table_name = 'quotations' then
    module_name := 'quotations'; record_label := coalesce(row_data ->> 'quotation_code', 'Quotation');
    destination_route := '/quotations/' || (row_data ->> 'id');
    if tg_op = 'UPDATE' and old_row ->> 'status' is distinct from new_row ->> 'status'
       and new_row ->> 'status' in ('sent', 'accepted', 'rejected', 'expired') then
      event_type := 'quotation_status_changed'; title := 'Quotation status updated';
      old_value := old_row ->> 'status'; new_value := new_row ->> 'status'; should_notify := true;
    end if;
  elsif tg_table_name = 'projects' then
    module_name := 'projects'; record_label := coalesce(row_data ->> 'project_code', row_data ->> 'project_name', 'Project');
    destination_route := '/projects/' || (row_data ->> 'id');
    if tg_op = 'INSERT' then
      event_type := 'project_created'; title := 'New project created'; should_notify := true;
    elsif old_row ->> 'project_status' is distinct from new_row ->> 'project_status' then
      event_type := 'project_status_changed'; title := 'Project status updated';
      old_value := old_row ->> 'project_status'; new_value := new_row ->> 'project_status'; should_notify := true;
    elsif old_row -> 'assigned_installation_team' is distinct from new_row -> 'assigned_installation_team'
       or old_row ->> 'assigned_project_manager' is distinct from new_row ->> 'assigned_project_manager' then
      event_type := 'project_assignment_changed'; title := 'Project assignment updated'; should_notify := true;
    elsif old_row ->> 'start_date' is distinct from new_row ->> 'start_date'
       or old_row ->> 'expected_completion_date' is distinct from new_row ->> 'expected_completion_date' then
      event_type := 'project_schedule_changed'; title := 'Project schedule updated'; should_notify := true;
    end if;
  elsif tg_table_name = 'payments' then
    module_name := 'payments'; record_label := coalesce(row_data ->> 'reference_number', 'Payment');
    destination_route := case when tg_op = 'DELETE' then '/payments' else '/payments/' || (row_data ->> 'id') end;
    if tg_op = 'INSERT' then
      event_type := 'payment_recorded'; title := 'Payment recorded'; should_notify := true;
    elsif tg_op = 'DELETE' then
      event_type := 'payment_deleted'; title := 'Payment removed'; should_notify := true;
    elsif old_row ->> 'status' is distinct from new_row ->> 'status' then
      event_type := 'payment_status_changed'; title := 'Payment status updated';
      old_value := old_row ->> 'status'; new_value := new_row ->> 'status'; should_notify := true;
    end if;
  elsif tg_table_name = 'inventory_transactions' and tg_op = 'INSERT'
        and row_data ->> 'transaction_type' in ('stock_in', 'stock_out', 'project_issue', 'return') then
    module_name := 'inventory'; record_label := 'Inventory transaction'; destination_route := '/inventory';
    event_type := 'inventory_movement_recorded'; title := 'Inventory movement recorded';
    new_value := row_data ->> 'transaction_type'; should_notify := true;
  elsif tg_table_name = 'inventory_items' and tg_op = 'UPDATE'
        and coalesce((new_row ->> 'current_stock')::numeric, 0) <= coalesce((new_row ->> 'minimum_stock')::numeric, 0)
        and coalesce((old_row ->> 'current_stock')::numeric, 0) > coalesce((old_row ->> 'minimum_stock')::numeric, 0) then
    module_name := 'inventory'; record_label := coalesce(row_data ->> 'item_code', row_data ->> 'item_name', 'Inventory item');
    destination_route := '/inventory/' || (row_data ->> 'id'); event_type := 'inventory_low_stock';
    title := 'Stock shortage alert'; new_value := new_row ->> 'current_stock'; should_notify := true;
  elsif tg_table_name = 'purchase_orders' then
    module_name := 'purchases'; record_label := coalesce(row_data ->> 'purchase_code', 'Purchase order');
    destination_route := '/purchases/' || (row_data ->> 'id');
    if tg_op = 'INSERT' then
      event_type := 'purchase_order_created'; title := 'Purchase order created'; should_notify := true;
    elsif old_row ->> 'status' is distinct from new_row ->> 'status' then
      event_type := 'purchase_order_status_changed'; title := 'Purchase order status updated';
      old_value := old_row ->> 'status'; new_value := new_row ->> 'status'; should_notify := true;
    elsif old_row ->> 'vendor_id' is distinct from new_row ->> 'vendor_id' then
      event_type := 'purchase_order_supplier_changed'; title := 'Purchase supplier updated'; should_notify := true;
    end if;
  end if;

  if should_notify then
    message := coalesce(message, actor_name || ' updated ' || record_label ||
      case when new_value is not null then ' to ' || replace(new_value, '_', ' ') else '' end);
    perform public.publish_in_app_notification(
      target_company_id, event_type, tg_table_name, row_data ->> 'id',
      jsonb_build_object(
        'title', title, 'message', message, 'module', module_name,
        'record_label', record_label, 'actor_name', actor_name,
        'destination_route', destination_route,
        'old_value', old_value, 'new_value', new_value
      )
    );
  end if;

  return coalesce(new, old);
exception when others then
  perform public.create_activity_log(
    'notifications', null, 'generation_failed', null,
    jsonb_build_object('table', tg_table_name, 'operation', tg_op, 'error', sqlerrm)
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.handle_workflow_in_app_notification()
from public, anon, authenticated;

create trigger notify_lead_workflow after insert or update on public.leads
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_site_survey_workflow after insert or update on public.site_surveys
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_quotation_workflow after update on public.quotations
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_project_workflow after insert or update on public.projects
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_payment_workflow after insert or update or delete on public.payments
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_inventory_transaction_workflow after insert on public.inventory_transactions
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_inventory_shortage_workflow after update on public.inventory_items
for each row execute function public.handle_workflow_in_app_notification();
create trigger notify_purchase_order_workflow after insert or update on public.purchase_orders
for each row execute function public.handle_workflow_in_app_notification();

create or replace function public.list_my_in_app_notifications(
  p_limit integer default 20,
  p_unread_only boolean default false,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  receipt_id uuid, event_id uuid, event_type text, title text, message text,
  module text, record_label text, actor_name text, destination_route text,
  old_value text, new_value text, created_at timestamptz, read_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select receipts.id, events.id, events.event_type,
    events.payload ->> 'title', events.payload ->> 'message',
    events.payload ->> 'module', events.payload ->> 'record_label',
    events.payload ->> 'actor_name', events.payload ->> 'destination_route',
    events.payload ->> 'old_value', events.payload ->> 'new_value',
    receipts.created_at, receipts.read_at
  from public.in_app_notification_receipts receipts
  join public.notification_events events
    on events.id = receipts.event_id and events.company_id = receipts.company_id
  where (not p_unread_only or receipts.read_at is null)
    and (
      p_before_created_at is null
      or (receipts.created_at, receipts.id) < (p_before_created_at, p_before_id)
    )
  order by receipts.created_at desc, receipts.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.my_in_app_notification_unread_count()
returns bigint language sql security invoker set search_path = public
as $$
  select count(*) from public.in_app_notification_receipts where read_at is null;
$$;

create or replace function public.mark_in_app_notification_read(p_receipt_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.in_app_notification_receipts receipts
  set read_at = coalesce(receipts.read_at, now())
  where receipts.id = p_receipt_id
    and exists (
      select 1 from public.users_profile profiles
      where profiles.id = receipts.recipient_user_profile_id
        and profiles.company_id = receipts.company_id
        and profiles.auth_user_id = auth.uid()
        and profiles.status = 'active'
    );
  return found;
end;
$$;

create or replace function public.mark_all_in_app_notifications_read()
returns integer language plpgsql security definer set search_path = public
as $$
declare changed integer;
begin
  update public.in_app_notification_receipts receipts
  set read_at = now()
  where receipts.read_at is null
    and exists (
      select 1 from public.users_profile profiles
      where profiles.id = receipts.recipient_user_profile_id
        and profiles.company_id = receipts.company_id
        and profiles.auth_user_id = auth.uid()
        and profiles.status = 'active'
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.list_my_in_app_notifications(integer, boolean, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.my_in_app_notification_unread_count() from public, anon, authenticated;
revoke all on function public.mark_in_app_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_in_app_notifications_read() from public, anon, authenticated;
grant execute on function public.list_my_in_app_notifications(integer, boolean, timestamptz, uuid) to authenticated;
grant execute on function public.my_in_app_notification_unread_count() to authenticated;
grant execute on function public.mark_in_app_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_in_app_notifications_read() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'in_app_notification_receipts'
  ) then
    alter publication supabase_realtime add table public.in_app_notification_receipts;
  end if;
end;
$$;
