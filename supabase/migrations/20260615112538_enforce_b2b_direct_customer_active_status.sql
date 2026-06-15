-- B2B/Direct customer status is not user-selectable in the app; keep it active
-- at the database boundary as well.

update public.customers
set status = 'active'
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
  new.status := 'active';
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
    and status = 'active'
    and assigned_to is null
    and business_name is not null
    and btrim(business_name) <> ''
    and contact_person_name is not null
    and btrim(contact_person_name) <> ''
  )
);
