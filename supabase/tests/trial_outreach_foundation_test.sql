-- Read-only smoke checks for the trial outreach foundation.
do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'trial_outreach_enrollments',
    'trial_outreach_touchpoints',
    'trial_outreach_interactions',
    'portal_activity_events'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing trial outreach table: %', required_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.trial_outreach_enrollments'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on trial_outreach_enrollments';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.trial_outreach_touchpoints'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on trial_outreach_touchpoints';
  end if;

  if (
    select count(*)
    from pg_proc
    where proname in (
      'get_trial_outreach_snapshots',
      'schedule_trial_outreach_touchpoints',
      'claim_trial_outreach_touchpoints',
      'trial_outreach_dashboard_summary',
      'record_portal_activity',
      'get_trial_outreach_behavior_snapshots',
      'trial_outreach_behavior_dashboard_summary'
    )
  ) < 7 then
    raise exception 'Trial outreach RPC foundation is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trial_outreach_touchpoints'
      and column_name = 'trigger_key'
  ) then
    raise exception 'Behavior trigger metadata is missing from trial outreach touchpoints';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.portal_activity_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on portal_activity_events';
  end if;

  if not exists (
    select 1
    from public.notification_templates
    where notification_key = 'trial_activation_quick_start'
      and approval_status = 'draft'
  ) then
    raise exception 'Trial activation WhatsApp template catalogue is missing';
  end if;
end;
$$;
