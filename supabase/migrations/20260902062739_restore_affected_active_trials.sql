-- Restore only trials that were active when the 2026-09-01 trial-origin
-- migration incorrectly converted legacy trial subscriptions to self-signup
-- expirations. The previous 14-day expiry is reconstructed from the
-- subscription creation timestamp, which was written in the same transaction
-- as the original trial start.
do $$
declare
  restored_count integer;
begin
  with restored as (
    update public.company_subscriptions as subscriptions
    set
      plan_key = 'premium',
      status = 'trialing',
      trial_started_at = subscriptions.created_at,
      trial_ends_at = subscriptions.created_at + interval '14 days',
      trial_access_source = 'super_admin_invite',
      updated_at = statement_timestamp()
    where subscriptions.status = 'expired'
      and subscriptions.plan_key is null
      and subscriptions.trial_started_at is null
      and subscriptions.trial_ends_at is null
      and subscriptions.trial_access_source = 'self_signup'
      -- The faulty migration updated this exact batch at one timestamp.
      and subscriptions.updated_at = timestamptz '2026-09-01 13:13:10.450419+00'
      -- Restore only trials that had not naturally reached their 14-day end.
      and subscriptions.created_at + interval '14 days' > subscriptions.updated_at
    returning subscriptions.company_id
  )
  select count(*) into restored_count from restored;

  if restored_count <> 17 then
    raise exception
      'Expected to restore 17 wrongly ended active trials, restored % instead',
      restored_count;
  end if;
end;
$$;

notify pgrst, 'reload schema';
