-- Keep backend customer data aligned with the simplified Project Based and
-- B2B/Direct customer forms.

alter table public.customers
add column if not exists business_name text,
add column if not exists gst_number text,
add column if not exists contact_person_name text;

alter table public.customers
add column if not exists customer_segment text default 'project_based';

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

update public.customers
set
  business_name = null,
  gst_number = null,
  contact_person_name = null,
  customer_type = case
    when customer_type in ('residential', 'commercial', 'industrial', 'government', 'other')
      then customer_type
    else 'residential'
  end
where customer_segment = 'project_based';

update public.customers
set
  customer_type = 'b2b_installer',
  assigned_to = null,
  lead_source = null,
  business_name = nullif(btrim(business_name), ''),
  contact_person_name = nullif(btrim(contact_person_name), ''),
  full_name = coalesce(
    nullif(btrim(full_name), ''),
    nullif(btrim(contact_person_name), ''),
    nullif(btrim(business_name), ''),
    'B2B/Direct Customer'
  )
where customer_segment = 'b2b_direct';

create or replace function public.normalize_customer_segment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.customer_segment := coalesce(
    nullif(btrim(new.customer_segment), ''),
    'project_based'
  );

  if new.customer_segment not in ('project_based', 'b2b_direct') then
    raise exception 'customer_segment must be project_based or b2b_direct'
      using errcode = '23514';
  end if;

  if new.customer_segment = 'project_based' then
    if new.customer_type is null
      or btrim(new.customer_type) = ''
      or new.customer_type not in (
        'residential',
        'commercial',
        'industrial',
        'government',
        'other'
      ) then
      new.customer_type := 'residential';
    end if;

    new.business_name := null;
    new.gst_number := null;
    new.contact_person_name := null;
    return new;
  end if;

  new.customer_type := 'b2b_installer';
  new.assigned_to := null;
  new.lead_source := null;
  new.business_name := nullif(btrim(new.business_name), '');
  new.gst_number := nullif(btrim(new.gst_number), '');
  new.contact_person_name := nullif(btrim(new.contact_person_name), '');
  new.full_name := coalesce(
    nullif(btrim(new.full_name), ''),
    new.contact_person_name,
    new.business_name
  );

  if new.business_name is null then
    raise exception 'business_name is required for B2B/Direct customers'
      using errcode = '23502';
  end if;

  if new.contact_person_name is null then
    raise exception 'contact_person_name is required for B2B/Direct customers'
      using errcode = '23502';
  end if;

  if new.full_name is null then
    raise exception 'full_name is required for B2B/Direct customers'
      using errcode = '23502';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_customers_segment_fields on public.customers;

create trigger normalize_customers_segment_fields
before insert or update on public.customers
for each row
execute function public.normalize_customer_segment_fields();

alter table public.customers
drop constraint if exists customers_segment_type_check;

alter table public.customers
add constraint customers_segment_type_check
check (
  (
    customer_segment = 'project_based'
    and customer_type in (
      'residential',
      'commercial',
      'industrial',
      'government',
      'other'
    )
  )
  or (
    customer_segment = 'b2b_direct'
    and customer_type = 'b2b_installer'
    and assigned_to is null
    and business_name is not null
    and btrim(business_name) <> ''
    and contact_person_name is not null
    and btrim(contact_person_name) <> ''
  )
);
