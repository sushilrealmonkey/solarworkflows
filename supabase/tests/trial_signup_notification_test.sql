-- Read-only checks for reliable trial signup email notifications.

do $$
declare
  queue_trigger_exists boolean;
begin
  if to_regclass('public.trial_signup_notification_outbox') is null then
    raise exception 'Trial signup notification outbox is missing';
  end if;

  select exists (
    select 1
    from pg_trigger
    where tgname = 'queue_trial_signup_notification'
      and not tgisinternal
  ) into queue_trigger_exists;
  if not queue_trigger_exists then
    raise exception 'Trial signup queue trigger is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.trial_signup_notification_outbox'::regclass
  ) then
    raise exception 'Trial signup notification outbox must have RLS enabled';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.trial_signup_notification_outbox',
    'select'
  ) then
    raise exception 'Authenticated clients must not read the notification outbox';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.claim_trial_signup_notifications(integer)',
    'execute'
  ) then
    raise exception 'Authenticated clients must not claim platform notifications';
  end if;
end;
$$;
