begin;

do $$
declare
  tenant_company_id uuid;
  tenant_phone_number_id uuid;
  tenant_contact_list_id uuid;
  tenant_campaign_id uuid;
  parked_until timestamptz := now() + interval '1 day';
begin
  insert into public.companies (company_name, company_slug)
  values (
    'WhatsApp campaign limit test tenant',
    'whatsapp-limit-test-' || gen_random_uuid()::text
  )
  returning id into tenant_company_id;

  insert into public.whatsapp_phone_numbers (
    company_id,
    meta_phone_number_id,
    display_phone_number
  )
  values (
    tenant_company_id,
    'limit-test-phone-' || gen_random_uuid()::text,
    '+10000000000'
  )
  returning id into tenant_phone_number_id;

  insert into public.whatsapp_contact_lists (
    company_id,
    name,
    contact_count
  )
  values (
    tenant_company_id,
    'Campaign limit test contacts',
    15
  )
  returning id into tenant_contact_list_id;

  insert into public.whatsapp_outreach_settings (
    company_id,
    daily_message_limit
  )
  values (tenant_company_id, 10);

  insert into public.whatsapp_campaigns (
    company_id,
    whatsapp_phone_number_id,
    contact_list_id,
    name,
    status,
    template_name,
    template_language,
    daily_message_limit,
    daily_send_time,
    send_timezone,
    next_batch_at
  )
  values (
    tenant_company_id,
    tenant_phone_number_id,
    tenant_contact_list_id,
    'Existing running campaign',
    'running',
    'limit_test_template',
    'en_US',
    10,
    time '00:00',
    'UTC',
    parked_until
  )
  returning id into tenant_campaign_id;

  update public.whatsapp_campaigns
  set daily_message_limit = 15
  where id = tenant_campaign_id;

  if (
    select daily_message_limit
    from public.whatsapp_outreach_settings
    where company_id = tenant_company_id
  ) <> 15 then
    raise exception 'raising the campaign limit did not raise the company ceiling';
  end if;

  if (
    select next_batch_at
    from public.whatsapp_campaigns
    where id = tenant_campaign_id
  ) > clock_timestamp() then
    raise exception 'raising the daily limit did not wake the existing campaign';
  end if;

  update public.whatsapp_campaigns
  set next_batch_at = parked_until,
      daily_message_limit = 9
  where id = tenant_campaign_id;

  if (
    select next_batch_at
    from public.whatsapp_campaigns
    where id = tenant_campaign_id
  ) is distinct from parked_until then
    raise exception 'lowering the daily limit unexpectedly woke the campaign';
  end if;

  if (
    select daily_message_limit
    from public.whatsapp_outreach_settings
    where company_id = tenant_company_id
  ) <> 15 then
    raise exception 'lowering the campaign limit unexpectedly lowered the company ceiling';
  end if;
end;
$$;

rollback;
