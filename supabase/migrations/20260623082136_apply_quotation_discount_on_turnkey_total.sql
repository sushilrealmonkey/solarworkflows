-- Apply quotation discounts to the total turnkey cost before extracting GST.
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
  pre_discount_base_amount numeric;
  pre_discount_gst_amount numeric;
  discount_amount numeric;
  discount_factor numeric;
  total_after_discount numeric;
  turnkey_amount numeric;
  solar_inclusive_amount numeric;
  service_inclusive_amount numeric;
begin
  select * into quotation_record
  from public.quotations
  where quotations.id = target_quotation_id
  for update;

  if not found then
    raise exception 'Quotation not found' using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if quotation_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot recalculate a quotation from another organization'
        using errcode = '42501';
    end if;
    if not public.user_has_permission('quotations', 'update') then
      raise exception 'Missing quotations update permission' using errcode = '42501';
    end if;
  end if;

  discount_amount := greatest(coalesce(quotation_record.discount_amount, 0), 0);
  turnkey_amount := coalesce(
    nullif(quotation_record.summary_total_turnkey_cost, 0),
    nullif(quotation_record.pricing_total_rate, 0)
  );

  if turnkey_amount is not null and turnkey_amount > 0 then
    total_after_discount := round(
      greatest(turnkey_amount - least(discount_amount, turnkey_amount), 0),
      2
    );
    solar_inclusive_amount := round(total_after_discount * 0.70, 2);
    service_inclusive_amount := round(total_after_discount * 0.30, 2);
    calculated_gst_amount := round(
      round(solar_inclusive_amount * 5 / 105, 2)
        + round(service_inclusive_amount * 18 / 118, 2),
      2
    );
    calculated_base_amount := round(total_after_discount - calculated_gst_amount, 2);
  else
    select
      coalesce(sum(quotation_items.line_total), 0),
      coalesce(sum(quotation_items.line_total * coalesce(quotation_items.gst_percent, 0) / 100), 0)
    into pre_discount_base_amount, pre_discount_gst_amount
    from public.quotation_items
    where quotation_items.quotation_id = target_quotation_id
      and quotation_items.organization_id = quotation_record.organization_id;

    calculated_base_amount := greatest(
      pre_discount_base_amount - least(discount_amount, pre_discount_base_amount),
      0
    );
    discount_factor := case
      when pre_discount_base_amount > 0
        then calculated_base_amount / pre_discount_base_amount
      else 0
    end;
    calculated_gst_amount := round(pre_discount_gst_amount * discount_factor, 2);
    total_after_discount := round(calculated_base_amount + calculated_gst_amount, 2);
  end if;

  update public.quotations
  set
    base_amount = calculated_base_amount,
    gst_amount = calculated_gst_amount,
    total_amount = total_after_discount,
    net_payable_amount = greatest(
      total_after_discount - coalesce(subsidy_amount, 0),
      0
    ),
    updated_at = now()
  where quotations.id = target_quotation_id
  returning * into quotation_record;

  return quotation_record;
end;
$$;

grant execute on function public.recalculate_quotation_totals(uuid) to authenticated;

with item_totals as (
  select
    quotation_items.quotation_id,
    coalesce(sum(quotation_items.line_total), 0) as base_amount,
    coalesce(
      sum(quotation_items.line_total * coalesce(quotation_items.gst_percent, 0) / 100),
      0
    ) as gst_amount
  from public.quotation_items
  group by quotation_items.quotation_id
), source_totals as (
  select
    quotations.id,
    greatest(coalesce(quotations.discount_amount, 0), 0) as discount_amount,
    coalesce(quotations.subsidy_amount, 0) as subsidy_amount,
    coalesce(
      nullif(quotations.summary_total_turnkey_cost, 0),
      nullif(quotations.pricing_total_rate, 0)
    ) as turnkey_amount,
    coalesce(item_totals.base_amount, 0) as item_base_amount,
    coalesce(item_totals.gst_amount, 0) as item_gst_amount
  from public.quotations
  left join item_totals on item_totals.quotation_id = quotations.id
), discounted_sources as (
  select
    source_totals.*,
    case
      when source_totals.turnkey_amount > 0 then round(
        greatest(
          source_totals.turnkey_amount
            - least(source_totals.discount_amount, source_totals.turnkey_amount),
          0
        ),
        2
      )
      else null
    end as discounted_turnkey_amount,
    greatest(
      source_totals.item_base_amount
        - least(source_totals.discount_amount, source_totals.item_base_amount),
      0
    ) as discounted_item_base_amount
  from source_totals
), calculated_totals as (
  select
    discounted_sources.id,
    discounted_sources.subsidy_amount,
    case
      when discounted_sources.discounted_turnkey_amount is not null then round(
        discounted_sources.discounted_turnkey_amount
          - (
            round(round(discounted_sources.discounted_turnkey_amount * 0.70, 2) * 5 / 105, 2)
              + round(round(discounted_sources.discounted_turnkey_amount * 0.30, 2) * 18 / 118, 2)
          ),
        2
      )
      else discounted_sources.discounted_item_base_amount
    end as base_amount,
    case
      when discounted_sources.discounted_turnkey_amount is not null then round(
        round(discounted_sources.discounted_turnkey_amount * 0.70, 2) * 5 / 105,
        2
      ) + round(
        round(discounted_sources.discounted_turnkey_amount * 0.30, 2) * 18 / 118,
        2
      )
      else round(
        discounted_sources.item_gst_amount * case
          when discounted_sources.item_base_amount > 0
            then discounted_sources.discounted_item_base_amount
              / discounted_sources.item_base_amount
          else 0
        end,
        2
      )
    end as gst_amount,
    case
      when discounted_sources.discounted_turnkey_amount is not null
        then discounted_sources.discounted_turnkey_amount
      else null
    end as discounted_turnkey_amount
  from discounted_sources
)
update public.quotations
set
  base_amount = calculated_totals.base_amount,
  gst_amount = calculated_totals.gst_amount,
  total_amount = coalesce(
    calculated_totals.discounted_turnkey_amount,
    round(calculated_totals.base_amount + calculated_totals.gst_amount, 2)
  ),
  net_payable_amount = greatest(
    coalesce(
      calculated_totals.discounted_turnkey_amount,
      round(calculated_totals.base_amount + calculated_totals.gst_amount, 2)
    ) - calculated_totals.subsidy_amount,
    0
  ),
  updated_at = now()
from calculated_totals
where quotations.id = calculated_totals.id;
