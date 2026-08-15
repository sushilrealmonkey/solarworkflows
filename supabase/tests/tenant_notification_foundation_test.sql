-- Read-only tenant notification foundation checks.

do $$
declare
  target_table_name text;
  template_count integer;
begin
  foreach target_table_name in array array[
    'notification_events',
    'notification_recipients',
    'notification_preferences',
    'notification_templates',
    'notification_deliveries',
    'notification_unsubscribes'
  ]
  loop
    if to_regclass('public.' || target_table_name) is null then
      raise exception 'Missing notification table: %', target_table_name;
    end if;

    if not exists (
      select 1
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname = target_table_name
        and pg_class.relrowsecurity
    ) then
      raise exception 'RLS is not enabled for public.%', target_table_name;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and columns.table_name = target_table_name
        and column_name = 'company_id'
    ) then
      raise exception 'public.% is missing company_id', target_table_name;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'notification_events',
        'notification_recipients',
        'notification_preferences',
        'notification_deliveries',
        'notification_unsubscribes'
      )
      and column_name = 'company_id'
      and is_nullable <> 'NO'
  ) then
    raise exception 'A tenant notification table has a nullable company_id';
  end if;

  select count(*)
  into template_count
  from public.notification_templates
  where company_id is null
    and provider = 'meta'
    and approval_status = 'active';

  if template_count <> 12 then
    raise exception 'Expected 12 active platform Meta templates, found %',
      template_count;
  end if;

  if not exists (
    select 1
    from public.notification_templates
    where provider_template_name = 'bizlee_signup'
      and language_code = 'en'
      and category = 'authentication'
  ) then
    raise exception 'The Bizlee signup authentication template is incorrect';
  end if;

  if exists (
    select 1
    from public.notification_templates
    where provider_template_name in (
      'bizlee_trial_ending',
      'bizlee_trial_expired'
    )
      and category <> 'marketing'
  ) then
    raise exception 'Trial conversion templates must remain marketing';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.notification_preferences',
    'select'
  ) then
    raise exception 'Authenticated users must be able to read permitted preferences';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_deliveries_event_company_fk'
      and contype = 'f'
  ) then
    raise exception 'Delivery-to-event tenant composite foreign key is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_deliveries_recipient_company_fk'
      and contype = 'f'
  ) then
    raise exception 'Delivery-to-recipient tenant composite foreign key is missing';
  end if;
end;
$$;
