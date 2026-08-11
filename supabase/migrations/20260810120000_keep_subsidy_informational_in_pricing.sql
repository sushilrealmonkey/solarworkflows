-- Keep quotation and project payment pricing aligned. Subsidy is credited to
-- the customer separately, so it is displayed for reference and must not be
-- deducted from the amount payable to the company.

create or replace function public.keep_quotation_payable_equal_to_total()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.net_payable_amount := new.total_amount;
  return new;
end;
$$;

drop trigger if exists keep_quotation_payable_equal_to_total on public.quotations;
create trigger keep_quotation_payable_equal_to_total
before insert or update of total_amount, subsidy_amount, net_payable_amount
on public.quotations
for each row
execute function public.keep_quotation_payable_equal_to_total();

create or replace function public.keep_project_payment_pricing_aligned()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.company_receivable_amount := coalesce(new.total_project_amount, 0);
  new.balance_due := greatest(
    new.company_receivable_amount - coalesce(new.amount_received, 0),
    0
  );
  new.payment_status := case
    when new.balance_due <= 0 then 'paid'
    when coalesce(new.amount_received, 0) > 0 then 'partial'
    else 'pending'
  end;
  return new;
end;
$$;

drop trigger if exists keep_project_payment_pricing_aligned on public.project_payment_summary;
create trigger keep_project_payment_pricing_aligned
before insert or update of total_project_amount, subsidy_amount,
  company_receivable_amount, amount_received, balance_due, payment_status
on public.project_payment_summary
for each row
execute function public.keep_project_payment_pricing_aligned();

-- This is a one-time consistency repair for historical rows, including
-- quotations that are already beyond draft. Temporarily remove the immutable
-- commercial-history trigger inside this migration transaction, then restore
-- it immediately. Normal application writes remain protected after deployment.
drop trigger if exists protect_quotation_commercial_history on public.quotations;

update public.quotations
set net_payable_amount = total_amount
where net_payable_amount is distinct from total_amount;

create trigger protect_quotation_commercial_history
before update on public.quotations
for each row
execute function public.protect_non_draft_commercial_record();

update public.project_payment_summary
set company_receivable_amount = coalesce(total_project_amount, 0),
    balance_due = greatest(
      coalesce(total_project_amount, 0) - coalesce(amount_received, 0),
      0
    ),
    payment_status = case
      when coalesce(total_project_amount, 0) - coalesce(amount_received, 0) <= 0
        then 'paid'
      when coalesce(amount_received, 0) > 0 then 'partial'
      else 'pending'
    end,
    updated_at = now()
where company_receivable_amount is distinct from coalesce(total_project_amount, 0)
   or balance_due is distinct from greatest(
     coalesce(total_project_amount, 0) - coalesce(amount_received, 0),
     0
   );
