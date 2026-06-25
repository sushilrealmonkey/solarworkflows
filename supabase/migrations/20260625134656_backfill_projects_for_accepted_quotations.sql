-- One-time repair for quotations that were accepted before the automatic
-- customer/project workflow was deployed.

do $$
declare
  quotation_record public.quotations%rowtype;
  lead_record public.leads%rowtype;
  customer_record public.customers%rowtype;
  project_record public.projects%rowtype;
begin
  for quotation_record in
    select q.*
    from public.quotations q
    where q.status = 'accepted'
      and not exists (
        select 1
        from public.projects p
        where p.quotation_id = q.id
      )
    order by q.accepted_at nulls last, q.created_at
  loop
    customer_record := null;
    project_record := null;

    if quotation_record.lead_id is not null then
      select *
      into lead_record
      from public.leads
      where leads.id = quotation_record.lead_id
        and leads.organization_id = quotation_record.organization_id
      for update;

      if found then
        if lead_record.converted_customer_id is not null then
          select *
          into customer_record
          from public.customers
          where customers.id = lead_record.converted_customer_id
            and customers.organization_id = lead_record.organization_id;
        elsif lead_record.customer_id is not null then
          select *
          into customer_record
          from public.customers
          where customers.id = lead_record.customer_id
            and customers.organization_id = lead_record.organization_id;
        end if;

        if customer_record.id is null then
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
            lead_record.created_by,
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

        if quotation_record.customer_id is null then
          update public.quotations
          set
            customer_id = customer_record.id,
            updated_at = now()
          where quotations.id = quotation_record.id
          returning * into quotation_record;
        end if;
      end if;
    end if;

    if quotation_record.customer_id is not null then
      select *
      into customer_record
      from public.customers
      where customers.id = quotation_record.customer_id
        and customers.organization_id = quotation_record.organization_id;
    end if;

    if customer_record.id is null then
      raise notice 'Skipped accepted quotation % because no same-organization customer or lead could be resolved.',
        quotation_record.id;
      continue;
    end if;

    insert into public.projects (
      organization_id,
      customer_id,
      lead_id,
      quotation_id,
      site_survey_id,
      project_name,
      system_capacity_kw,
      project_type,
      installation_address,
      city,
      district,
      state,
      pincode,
      project_status,
      priority,
      notes,
      created_by
    )
    values (
      quotation_record.organization_id,
      customer_record.id,
      quotation_record.lead_id,
      quotation_record.id,
      quotation_record.site_survey_id,
      customer_record.full_name || ' Solar Installation - ' || coalesce(quotation_record.quotation_code, 'Quotation'),
      quotation_record.system_capacity_kw,
      coalesce(customer_record.customer_type, 'residential'),
      coalesce(customer_record.address_line_1, ''),
      customer_record.city,
      customer_record.district,
      customer_record.state,
      customer_record.pincode,
      'created',
      'medium',
      quotation_record.notes,
      quotation_record.created_by
    )
    on conflict do nothing
    returning * into project_record;

    if project_record.id is not null then
      update public.inventory_reservations
      set project_id = project_record.id, updated_at = now()
      where inventory_reservations.quotation_id = quotation_record.id
        and inventory_reservations.organization_id = quotation_record.organization_id
        and inventory_reservations.status in ('active', 'partial', 'shortage');
    end if;
  end loop;
end;
$$;
