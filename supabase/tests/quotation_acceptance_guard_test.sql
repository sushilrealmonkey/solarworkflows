begin;

create temporary table quotations
as select * from public.quotations with no data;

create trigger protect_quotation_commercial_history
before update on quotations
for each row execute function public.protect_non_draft_commercial_record();

insert into quotations (
  id,
  status,
  customer_id,
  bom_status,
  base_amount,
  updated_at
)
values (
  gen_random_uuid(),
  'sent',
  null,
  'generated',
  100,
  now()
);

select set_config('app.quotation_transition', 'accept', true);

update quotations
set status = 'accepted',
    customer_id = gen_random_uuid(),
    bom_status = 'locked',
    accepted_at = now(),
    updated_at = now();

select set_config('app.quotation_transition', '', true);

do $$
begin
  begin
    update quotations set base_amount = 200;
    raise exception 'Expected the non-draft commercial edit guard to reject the update';
  exception
    when check_violation then
      if sqlerrm <> 'Commercial terms are locked after draft. Create a revision instead.' then
        raise;
      end if;
  end;
end;
$$;

select
  status = 'accepted'
  and customer_id is not null
  and bom_status = 'locked'
  and base_amount = 100
  as quotation_acceptance_guard_passed
from quotations;

rollback;
