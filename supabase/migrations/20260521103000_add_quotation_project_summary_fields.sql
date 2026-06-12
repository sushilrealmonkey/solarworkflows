-- Adds nullable project summary fields for technical and commercial quotation proposals.
-- These fields do not affect quotation totals, status transitions, or tenant/RLS policy shape.

alter table public.quotations add column if not exists installation_location text;
alter table public.quotations add column if not exists site_type text;
alter table public.quotations add column if not exists expected_annual_generation_kwh numeric;
alter table public.quotations add column if not exists generation_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_site_type_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_site_type_check
    check (
      site_type is null
      or site_type in ('RCC Roof', 'Tin Shed', 'Ground Mount', 'Other')
    );
  end if;
end;
$$;
