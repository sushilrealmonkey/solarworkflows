-- Link quotations to BOM templates without generating BOM items or quantities.

alter table public.quotations
add column if not exists bom_template_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_bom_template_id_fkey'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_bom_template_id_fkey
    foreign key (bom_template_id)
    references public.bom_templates(id)
    on delete restrict;
  end if;
end;
$$;

create index if not exists quotations_bom_template_id_idx
on public.quotations (bom_template_id);

create index if not exists quotations_organization_bom_template_id_idx
on public.quotations (organization_id, bom_template_id)
where bom_template_id is not null;

grant select on public.product_categories to authenticated;

create or replace function public.set_quotation_tenant_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  linked_customer_id uuid;
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

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    if new.site_survey_id is not null or new.lead_id is not null then
      linked_customer_id := null;

      if new.site_survey_id is not null then
        select site_surveys.customer_id
        into linked_customer_id
        from public.site_surveys
        where site_surveys.id = new.site_survey_id
          and site_surveys.organization_id = new.organization_id;
      end if;

      if linked_customer_id is null and new.lead_id is not null then
        select coalesce(leads.converted_customer_id, leads.customer_id)
        into linked_customer_id
        from public.leads
        where leads.id = new.lead_id
          and leads.organization_id = new.organization_id;
      end if;

      if linked_customer_id is not null and exists (
        select 1
        from public.customers
        where customers.id = linked_customer_id
          and customers.organization_id = new.organization_id
      ) then
        new.customer_id := linked_customer_id;
      else
        new.customer_id := null;
      end if;
    else
      raise exception 'customer_id must belong to the same organization as the quotation'
        using errcode = '23503';
    end if;
  end if;

  if new.bom_template_id is not null and not exists (
    select 1
    from public.bom_templates
    where bom_templates.id = new.bom_template_id
      and bom_templates.tenant_id = new.organization_id
  ) then
    raise exception 'bom_template_id must belong to the same organization as the quotation'
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

drop policy if exists "Tenant quotation users can view BOM templates" on public.bom_templates;
drop policy if exists "Tenant quotation users can view BOM template lines" on public.bom_template_lines;
drop policy if exists "Tenant quotation users can view product categories" on public.product_categories;

create policy "Tenant quotation users can view product categories"
on public.product_categories
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

create policy "Tenant quotation users can view BOM templates"
on public.bom_templates
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

create policy "Tenant quotation users can view BOM template lines"
on public.bom_template_lines
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

notify pgrst, 'reload schema';
