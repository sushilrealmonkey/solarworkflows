-- Read-only tenant notification pipeline checks.

do $$
declare
  function_signature regprocedure;
begin
  foreach function_signature in array array[
    'public.queue_notification_event(uuid,text,text,text,text,jsonb,text,timestamptz,uuid)'::regprocedure,
    'public.claim_notification_delivery_batch(integer,text[])'::regprocedure,
    'public.complete_notification_delivery(uuid,text,jsonb)'::regprocedure,
    'public.fail_notification_delivery(uuid,text,text,boolean)'::regprocedure,
    'public.process_notification_delivery_status(text,text,timestamptz,text,text)'::regprocedure,
    'public.list_due_daily_summary_recipients(integer)'::regprocedure,
    'public.process_notification_opt_out(text,text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', function_signature, 'execute')
      or has_function_privilege('authenticated', function_signature, 'execute') then
      raise exception 'Internal notification function is exposed: %',
        function_signature;
    end if;

    if not has_function_privilege('service_role', function_signature, 'execute') then
      raise exception 'Service role cannot execute notification function: %',
        function_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_deliveries_claim_idx'
  ) then
    raise exception 'Notification delivery partial claim index is missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_recipients'
      and cmd in ('INSERT', 'UPDATE')
      and policyname <> 'Super admins manage notification recipients'
  ) then
    raise exception 'Tenant clients must not mutate recipient verification state';
  end if;
end;
$$;
