-- The trial-origin migration reset a subscription even when its trial outreach
-- enrollment still records an active extended trial. Restore each such
-- subscription from the preserved enrollment dates.
do $$
declare
  restored_count integer;
begin
  with restored as (
    update public.company_subscriptions as subscriptions
    set
      plan_key = 'premium',
      status = 'trialing',
      trial_started_at = enrollment.trial_started_at,
      trial_ends_at = enrollment.trial_ends_at,
      trial_access_source = 'super_admin_invite',
      updated_at = statement_timestamp()
    from public.trial_outreach_enrollments as enrollment
    where enrollment.company_id = subscriptions.company_id
      and subscriptions.status = 'expired'
      and subscriptions.plan_key is null
      and subscriptions.trial_started_at is null
      and subscriptions.trial_ends_at is null
      and subscriptions.trial_access_source = 'self_signup'
      and enrollment.status = 'active'
      and enrollment.trial_started_at is not null
      and enrollment.trial_ends_at > statement_timestamp()
    returning subscriptions.company_id
  )
  select count(*) into restored_count from restored;

  if restored_count <> 1 then
    raise exception
      'Expected to restore one active outreach trial extension, restored % instead',
      restored_count;
  end if;
end;
$$;

notify pgrst, 'reload schema';
