-- Split customers into project-based and B2B/direct segments while keeping
-- public.customers as the single source of truth.

alter table public.customers
add column if not exists customer_segment text;

update public.customers
set customer_segment = case
  when customer_type = 'b2b_installer' then 'b2b_direct'
  else 'project_based'
end
where customer_segment is null;

alter table public.customers
alter column customer_segment set default 'project_based';

alter table public.customers
alter column customer_segment set not null;

alter table public.customers
drop constraint if exists customers_customer_segment_check;

alter table public.customers
add constraint customers_customer_segment_check
check (customer_segment in ('project_based', 'b2b_direct'));

alter table public.customers
drop constraint if exists customers_customer_type_check;

alter table public.customers
add constraint customers_customer_type_check
check (
  customer_type in (
    'residential',
    'commercial',
    'industrial',
    'government',
    'b2b_installer',
    'retailer',
    'distributor',
    'other'
  )
);

create index if not exists customers_organization_segment_idx
on public.customers (organization_id, customer_segment);

create index if not exists customers_organization_segment_status_idx
on public.customers (organization_id, customer_segment, status);

create or replace function public.convert_lead_to_customer(target_lead_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_record public.leads%rowtype;
  customer_record public.customers%rowtype;
  current_profile_id uuid;
begin
  select *
  into lead_record
  from public.leads
  where leads.id = target_lead_id
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin() then
    if lead_record.organization_id <> public.current_user_organization_id() then
      raise exception 'Cannot convert a lead from another organization'
        using errcode = '42501';
    end if;

    if not public.user_has_permission('leads', 'update') then
      raise exception 'Missing leads update permission'
        using errcode = '42501';
    end if;

    if lead_record.converted_customer_id is null
      and not public.user_has_permission('customers', 'create') then
      raise exception 'Missing customers create permission'
        using errcode = '42501';
    end if;
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if lead_record.converted_customer_id is not null then
    select *
    into customer_record
    from public.customers
    where customers.id = lead_record.converted_customer_id;
  else
    insert into public.customers (
      organization_id,
      customer_segment,
      full_name,
      phone,
      alternate_phone,
      email,
      address_line_1,
      city,
      district,
      state,
      pincode,
      lead_source,
      status,
      notes,
      created_by,
      assigned_to
    )
    values (
      lead_record.organization_id,
      'project_based',
      lead_record.full_name,
      lead_record.phone,
      lead_record.alternate_phone,
      lead_record.email,
      lead_record.address,
      lead_record.city,
      lead_record.district,
      lead_record.state,
      lead_record.pincode,
      lead_record.lead_source,
      'active',
      lead_record.notes,
      coalesce(current_profile_id, lead_record.created_by),
      lead_record.assigned_to
    )
    returning * into customer_record;
  end if;

  update public.leads
  set
    status = 'converted',
    converted_customer_id = customer_record.id,
    converted_at = coalesce(public.leads.converted_at, now()),
    customer_id = coalesce(public.leads.customer_id, customer_record.id),
    updated_at = now()
  where public.leads.id = lead_record.id;

  return customer_record;
end;
$$;

create or replace function public.set_b2b_sale_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.users_profile%rowtype;
begin
  select *
  into current_profile
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  if new.company_id is null then
    new.company_id := current_profile.company_id;
  end if;

  if new.organization_id is null then
    new.organization_id := current_profile.organization_id;
  end if;

  if new.company_id is null then
    raise exception 'company_id is required for B2B sales'
      using errcode = '23502';
  end if;

  if new.organization_id is null then
    raise exception 'organization_id is required for B2B sales'
      using errcode = '23502';
  end if;

  if new.sale_code is null or trim(new.sale_code) = '' then
    new.sale_code := public.generate_b2b_sale_code(new.company_id);
  end if;

  new.sale_date := coalesce(new.sale_date, current_date);
  new.status := coalesce(nullif(trim(new.status), ''), 'draft');
  new.base_amount := coalesce(new.base_amount, 0);
  new.gst_amount := coalesce(new.gst_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, 0);

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
      and customers.customer_segment = 'b2b_direct'
  ) then
    raise exception 'customer_id must be a B2B/Direct customer in the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  if new.invoice_id is not null and not exists (
    select 1
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id
      and invoices.customer_id = new.customer_id
  ) then
    raise exception 'invoice_id must belong to the same organization and customer as the B2B sale'
      using errcode = '23503';
  end if;

  if new.created_by is null then
    new.created_by := current_profile.id;
  end if;

  if new.created_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.created_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'created_by must belong to the same organization as the B2B sale'
      using errcode = '23503';
  end if;

  return new;
end;
$$;
