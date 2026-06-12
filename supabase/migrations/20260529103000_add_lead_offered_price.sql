alter table public.leads add column if not exists offered_price numeric;
alter table public.leads add column if not exists offered_price_updated_at timestamptz;

create or replace function public.set_lead_offered_price_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.offered_price is not null then
      new.offered_price_updated_at := coalesce(new.offered_price_updated_at, now());
    end if;

    return new;
  end if;

  if new.offered_price is distinct from old.offered_price then
    new.offered_price_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_leads_offered_price_timestamp on public.leads;

create trigger set_leads_offered_price_timestamp
before insert or update on public.leads
for each row
execute function public.set_lead_offered_price_timestamp();
