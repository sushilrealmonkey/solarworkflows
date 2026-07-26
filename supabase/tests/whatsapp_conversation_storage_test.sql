begin;

do $$
declare
  tenant_company_id uuid;
  tenant_phone_number_id uuid;
  first_result record;
  replay_result record;
  unmapped_result record;
begin
  if not has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'select'
  ) then
    raise exception 'authenticated tenant members must be able to read messages';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'insert'
  ) then
    raise exception 'authenticated clients must not insert webhook messages';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.persist_inbound_whatsapp_message(text,text,text,text,text,text,timestamptz,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'authenticated clients must not execute the persistence RPC';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.persist_inbound_whatsapp_message(text,text,text,text,text,text,timestamptz,jsonb)'::regprocedure,
    'execute'
  ) then
    raise exception 'service_role must be able to execute the persistence RPC';
  end if;

  insert into public.companies (
    company_name,
    company_slug
  )
  values (
    'WhatsApp storage test tenant',
    'whatsapp-storage-test-' || gen_random_uuid()::text
  )
  returning id into tenant_company_id;

  insert into public.whatsapp_phone_numbers (
    company_id,
    meta_phone_number_id,
    display_phone_number
  )
  values (
    tenant_company_id,
    'test-phone-' || gen_random_uuid()::text,
    '+10000000000'
  )
  returning id into tenant_phone_number_id;

  select *
  into first_result
  from public.persist_inbound_whatsapp_message(
    (
      select meta_phone_number_id
      from public.whatsapp_phone_numbers
      where id = tenant_phone_number_id
    ),
    'wamid.idempotency-test',
    '919999999999',
    'Test Contact',
    'text',
    'Hello',
    '2026-07-25T08:00:00Z'::timestamptz,
    '{"id":"wamid.idempotency-test","type":"text"}'::jsonb
  );

  select *
  into replay_result
  from public.persist_inbound_whatsapp_message(
    (
      select meta_phone_number_id
      from public.whatsapp_phone_numbers
      where id = tenant_phone_number_id
    ),
    'wamid.idempotency-test',
    '919999999999',
    'Changed Contact Name',
    'text',
    'Hello again',
    '2026-07-25T08:01:00Z'::timestamptz,
    '{"id":"wamid.idempotency-test","type":"text"}'::jsonb
  );

  if first_result.mapped is distinct from true
    or first_result.inserted is distinct from true then
    raise exception 'the first inbound message was not inserted';
  end if;

  if replay_result.mapped is distinct from true
    or replay_result.inserted is distinct from false then
    raise exception 'the replay was not treated as an idempotent duplicate';
  end if;

  if first_result.message_id is distinct from replay_result.message_id then
    raise exception 'the replay did not resolve to the original message';
  end if;

  if (
    select count(*)
    from public.whatsapp_messages
    where company_id = tenant_company_id
      and meta_message_id = 'wamid.idempotency-test'
  ) <> 1 then
    raise exception 'the replay created a duplicate message';
  end if;

  if (
    select count(*)
    from public.whatsapp_conversations
    where company_id = tenant_company_id
      and contact_wa_id = '919999999999'
  ) <> 1 then
    raise exception 'the replay created a duplicate conversation';
  end if;

  select *
  into unmapped_result
  from public.persist_inbound_whatsapp_message(
    'unmapped-phone-number',
    'wamid.unmapped-test',
    '918888888888',
    null,
    'text',
    'Not persisted',
    now(),
    '{"id":"wamid.unmapped-test","type":"text"}'::jsonb
  );

  if unmapped_result.mapped is distinct from false
    or unmapped_result.inserted is distinct from false then
    raise exception 'an unmapped phone number was accepted';
  end if;
end;
$$;

do $$
declare
  company_a uuid;
  company_b uuid;
  phone_a text := 'status-phone-a-' || gen_random_uuid()::text;
  phone_b text := 'status-phone-b-' || gen_random_uuid()::text;
  message_id constant text := 'wamid.shared-status-test';
  result record;
begin
  if has_function_privilege(
    'authenticated',
    'public.process_whatsapp_message_status(text,text,text,timestamptz,text,text,text,text)'::regprocedure,
    'execute'
  ) then
    raise exception 'authenticated clients must not execute the status RPC';
  end if;

  insert into public.companies (company_name, company_slug)
  values (
    'WhatsApp status tenant A',
    'whatsapp-status-a-' || gen_random_uuid()::text
  )
  returning id into company_a;

  insert into public.companies (company_name, company_slug)
  values (
    'WhatsApp status tenant B',
    'whatsapp-status-b-' || gen_random_uuid()::text
  )
  returning id into company_b;

  insert into public.whatsapp_phone_numbers (company_id, meta_phone_number_id)
  values (company_a, phone_a), (company_b, phone_b);

  perform public.persist_inbound_whatsapp_message(
    phone_a, message_id, '911111111111', null, 'text', 'A',
    '2026-07-25T08:00:00Z', '{"id":"wamid.shared-status-test"}'
  );
  perform public.persist_inbound_whatsapp_message(
    phone_b, message_id, '922222222222', null, 'text', 'B',
    '2026-07-25T08:00:00Z', '{"id":"wamid.shared-status-test"}'
  );

  select * into result
  from public.process_whatsapp_message_status(
    phone_a, message_id, 'read', '2026-07-25T08:03:00Z'
  );

  if result.updated is distinct from true or result.status <> 'read' then
    raise exception 'read callback was not applied';
  end if;

  -- Duplicate callback is a no-op.
  select * into result
  from public.process_whatsapp_message_status(
    phone_a, message_id, 'read', '2026-07-25T08:03:00Z'
  );

  if result.updated is distinct from false or result.status <> 'read' then
    raise exception 'duplicate read callback was not idempotent';
  end if;

  -- A delayed callback stores its own timestamp without regressing status.
  select * into result
  from public.process_whatsapp_message_status(
    phone_a, message_id, 'delivered', '2026-07-25T08:02:00Z'
  );

  if result.status <> 'read' then
    raise exception 'out-of-order delivered callback regressed read status';
  end if;

  if (
    select delivered_at
    from public.whatsapp_messages
    where company_id = company_a and meta_message_id = message_id
  ) is distinct from '2026-07-25T08:02:00Z'::timestamptz then
    raise exception 'delivered timestamp was not stored';
  end if;

  -- The same Meta ID on another phone/tenant must remain untouched.
  if (
    select status
    from public.whatsapp_messages
    where company_id = company_b and meta_message_id = message_id
  ) <> 'received' then
    raise exception 'status update crossed tenant/phone boundaries';
  end if;

  select * into result
  from public.process_whatsapp_message_status(
    phone_b, 'wamid.unknown', 'sent', '2026-07-25T08:01:00Z'
  );

  if result.mapped is distinct from true
    or result.message_found is distinct from false
    or (
      select count(*) from public.whatsapp_messages
      where meta_message_id = 'wamid.unknown'
    ) <> 0 then
    raise exception 'unknown status callback created a message';
  end if;

  select * into result
  from public.process_whatsapp_message_status(
    phone_b,
    message_id,
    'failed',
    '2026-07-25T08:04:00Z',
    '131047',
    'Expired',
    'Delivery failed',
    'Window expired'
  );

  if result.status <> 'failed' then
    raise exception 'failed callback was not applied';
  end if;

  if not exists (
    select 1
    from public.whatsapp_messages
    where company_id = company_b
      and meta_message_id = message_id
      and failure_error_code = '131047'
      and failure_error_title = 'Expired'
      and failure_error_message = 'Delivery failed'
      and failure_error_details = 'Window expired'
  ) then
    raise exception 'failure metadata was not stored';
  end if;
end;
$$;

rollback;
