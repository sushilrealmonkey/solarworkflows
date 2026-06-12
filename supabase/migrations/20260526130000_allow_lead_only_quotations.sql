-- Allows quotations to be created from lead data before a customer or survey exists.

alter table public.quotations alter column customer_id drop not null;

create or replace function public.set_quotation_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  if new.created_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.created_by := current_profile_id;
  end if;

  if new.customer_id is null and new.lead_id is null and new.site_survey_id is null then
    raise exception 'quotation must be linked to a lead, customer, or site survey'
      using errcode = '23502';
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.site_survey_id is not null and not exists (
    select 1
    from public.site_surveys
    where site_surveys.id = new.site_survey_id
      and site_surveys.organization_id = new.organization_id
  ) then
    raise exception 'site_survey_id must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  if new.approved_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.approved_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'approved_by must belong to the same organization as the quotation'
      using errcode = '23503';
  end if;

  return new;
end;
$$;
