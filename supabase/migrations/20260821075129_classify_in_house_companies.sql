-- Keep internal test workspaces out of the client-facing platform directory.
-- The classification lives on the company record so the UI does not need to
-- identify internal accounts by company name.
alter table public.companies
  add column if not exists is_in_house boolean not null default false;

comment on column public.companies.is_in_house is
  'Marks an internal or test workspace for the platform in-house directory.';

update public.companies
set is_in_house = true,
    updated_at = now()
where lower(trim(company_name)) in (
  'bizlee demo account',
  'rm',
  'bizlee demo',
  'helionexa solar epc private limited',
  'razorpay test',
  'aaa',
  'greenvolt solar solutions pvt. ltd.',
  'realmonkey'
);
