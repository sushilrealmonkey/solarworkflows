-- Subscription state is managed by trusted billing functions and webhooks.
-- Tenant clients may inspect their RLS-scoped row but must never mutate it
-- directly through the Data API.

revoke all privileges on table public.company_subscriptions
from anon, authenticated;

grant select on table public.company_subscriptions to authenticated;

notify pgrst, 'reload schema';
