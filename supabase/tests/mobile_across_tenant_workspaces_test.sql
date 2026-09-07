-- Transactional regression: no test accounts or workspaces are retained.
begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  first_result jsonb;
  second_result jsonb;
  shared_phone text := '+19995550123';
  synced public.users_profile;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (first_user, 'authenticated', 'authenticated', first_user || '@example.invalid', now(), now(), now()),
    (second_user, 'authenticated', 'authenticated', second_user || '@example.invalid', now(), now(), now());

  perform set_config('request.jwt.claim.sub', first_user::text, true);
  first_result := public.self_create_epc_workspace('Shared mobile first', 'First Admin', shared_phone);
  perform set_config('request.jwt.claim.sub', second_user::text, true);
  second_result := public.self_create_epc_workspace('Shared mobile second', 'Second Admin', shared_phone);

  if first_result->>'company_id' = second_result->>'company_id' then
    raise exception 'Workspaces must remain separate';
  end if;
  if (select count(*) from public.users_profile where auth_user_id in (first_user, second_user) and phone = shared_phone) <> 2
    or (select count(*) from public.profiles where id in (first_user, second_user) and phone = shared_phone) <> 2 then
    raise exception 'Both tenants must retain their shared contact number';
  end if;
  synced := public.sync_auth_user_profile();
  if synced.company_id <> (second_result->>'company_id')::uuid or synced.phone_verified then
    raise exception 'Login must retain tenant identity without verifying a contact number';
  end if;
  begin
    insert into public.users_profile (company_id, organization_id, full_name, phone)
    values ((second_result->>'company_id')::uuid, (second_result->>'organization_id')::uuid, 'Duplicate', shared_phone);
    raise exception 'Duplicate phone within a tenant was accepted';
  exception when unique_violation then null;
  end;

  update public.users_profile set is_super_admin = true where auth_user_id = second_user;
  update public.profiles set is_super_admin = true where id = second_user;
  perform public.create_organization_with_admin(
    'Invited shared mobile', 'mobile-test-' || gen_random_uuid(), 'Invited Admin',
    shared_phone, gen_random_uuid() || '@example.invalid', null
  );
  if (select count(*) from public.users_profile where phone = shared_phone) <> 3 then
    raise exception 'Admin invitation must create a separate profile with the same phone';
  end if;

  -- An authenticated phone owner cannot claim either email-addressed invitation.
  update public.users_profile set auth_user_id = null where auth_user_id in (first_user, second_user);
  update auth.users set phone = shared_phone, phone_confirmed_at = now() where id = second_user;
  update public.users_profile set email = id || '@other.example.invalid'
    where id in ((first_result->>'admin_profile_id')::uuid, (second_result->>'admin_profile_id')::uuid);
  begin
    perform public.sync_auth_user_profile();
    raise exception 'Shared phone incorrectly claimed an unrelated invitation';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
