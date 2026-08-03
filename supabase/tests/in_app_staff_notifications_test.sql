-- Read-only checks for tenant-safe in-app staff notifications.

do $$
declare
  function_signature regprocedure;
begin
  if to_regclass('public.in_app_notification_receipts') is null then
    raise exception 'Missing in_app_notification_receipts table';
  end if;

  if not exists (
    select 1 from pg_class join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relname = 'in_app_notification_receipts'
      and pg_class.relrowsecurity
  ) then
    raise exception 'RLS is not enabled for in-app notification receipts';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'in_app_notification_receipts'
      and column_name = 'company_id' and is_nullable = 'NO'
  ) then
    raise exception 'Receipt company_id is missing or nullable';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'in_app_notification_receipts_event_company_fk')
    or not exists (select 1 from pg_constraint where conname = 'in_app_notification_receipts_profile_company_fk') then
    raise exception 'Tenant composite foreign keys are missing';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'in_app_notification_receipts_recipient_unread_idx'
  ) then
    raise exception 'Unread feed index is missing';
  end if;

  foreach function_signature in array array[
    'public.list_my_in_app_notifications(integer,boolean,timestamptz,uuid)'::regprocedure,
    'public.my_in_app_notification_unread_count()'::regprocedure,
    'public.mark_in_app_notification_read(uuid)'::regprocedure,
    'public.mark_all_in_app_notifications_read()'::regprocedure
  ] loop
    if not has_function_privilege('authenticated', function_signature, 'execute') then
      raise exception 'Authenticated staff cannot execute %', function_signature;
    end if;
  end loop;

  if has_function_privilege(
    'authenticated',
    'public.publish_in_app_notification(uuid,text,text,text,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'Internal notification publisher is exposed';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'in_app_notification_receipts'
  ) then
    raise exception 'Receipt table is not enabled for Realtime';
  end if;
end;
$$;
