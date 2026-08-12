-- A free trial is a tenant-wide Bizlee Pro trial. Keep the stored plan aligned
-- with the full module and capability access already granted to live trials.

update public.company_subscriptions
set plan_key = 'premium', updated_at = now()
where status = 'trialing'
  and plan_key is distinct from 'premium';

create or replace function public.assign_pro_plan_to_trial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'trialing' then
    new.plan_key := 'premium';
  end if;

  return new;
end;
$$;

drop trigger if exists assign_pro_plan_to_trial on public.company_subscriptions;
create trigger assign_pro_plan_to_trial
before insert or update of plan_key, status on public.company_subscriptions
for each row execute function public.assign_pro_plan_to_trial();

revoke execute on function public.assign_pro_plan_to_trial()
from public, anon, authenticated;

notify pgrst, 'reload schema';
