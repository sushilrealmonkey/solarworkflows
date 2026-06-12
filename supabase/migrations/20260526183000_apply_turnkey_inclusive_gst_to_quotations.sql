-- Calculates quotation GST from the GST-inclusive turnkey amount.
-- 70% of the inclusive amount is treated as 5% GST and 30% as 18% GST.
create or replace function public.recalculate_quotation_totals(target_quotation_id uuid)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  quotation_record public.quotations%rowtype;
  calculated_base_amount numeric;
  calculated_gst_amount numeric;
  turnkey_amount numeric;
  solar_inclusive_amount numeric;
  solar_gst_amount numeric;
  service_inclusive_amount numeric;
  service_gst_amount numeric;
begin
  select *
  into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate a quotation from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('quotations', 'update') then
      raise exception 'Missing quotations update permission'
        using errcode = '42501';
    end if;
  end if;

  turnkey_amount := coalesce(
    nullif(quotation_record.summary_total_turnkey_cost, 0),
    nullif(quotation_record.pricing_total_rate, 0)
  );

  if turnkey_amount is not null and turnkey_amount > 0 then
    solar_inclusive_amount := round(turnkey_amount * 0.70, 2);
    service_inclusive_amount := round(turnkey_amount * 0.30, 2);
    solar_gst_amount := round(solar_inclusive_amount * 5 / 105, 2);
    service_gst_amount := round(service_inclusive_amount * 18 / 118, 2);
    calculated_gst_amount := round(solar_gst_amount + service_gst_amount, 2);
    calculated_base_amount := round(turnkey_amount - calculated_gst_amount, 2);
  else
    select
      coalesce(sum(quotation_items.line_total), 0),
      coalesce(sum(quotation_items.line_total * coalesce(quotation_items.gst_percent, 0) / 100), 0)
    into calculated_base_amount, calculated_gst_amount
    from public.quotation_items
    where quotation_items.quotation_id = target_quotation_id
      and quotation_items.organization_id = quotation_record.organization_id;
  end if;

  update public.quotations
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = greatest(
      calculated_base_amount
        + calculated_gst_amount
        - coalesce(discount_amount, 0),
      0
    ),
    net_payable_amount = greatest(
      calculated_base_amount
        + calculated_gst_amount
        - coalesce(discount_amount, 0)
        - coalesce(subsidy_amount, 0),
      0
    ),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

with turnkey_quotes as (
  select
    id,
    coalesce(nullif(summary_total_turnkey_cost, 0), nullif(pricing_total_rate, 0)) as turnkey_amount,
    coalesce(discount_amount, 0) as discount_amount,
    coalesce(subsidy_amount, 0) as subsidy_amount
  from public.quotations
),
gst_calculation as (
  select
    id,
    turnkey_amount,
    round(round(turnkey_amount * 0.70, 2) * 5 / 105, 2)
      + round(round(turnkey_amount * 0.30, 2) * 18 / 118, 2) as gst_amount,
    discount_amount,
    subsidy_amount
  from turnkey_quotes
  where turnkey_amount is not null
    and turnkey_amount > 0
)
update public.quotations
set
  gst_amount = round(gst_calculation.gst_amount, 2),
  base_amount = round(gst_calculation.turnkey_amount - gst_calculation.gst_amount, 2),
  total_amount = greatest(
    round(gst_calculation.turnkey_amount, 2) - gst_calculation.discount_amount,
    0
  ),
  net_payable_amount = greatest(
    round(gst_calculation.turnkey_amount, 2)
      - gst_calculation.discount_amount
      - gst_calculation.subsidy_amount,
    0
  ),
  updated_at = now()
from gst_calculation
where quotations.id = gst_calculation.id;
