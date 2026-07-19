-- Payment history remains immutable for tenant-facing roles. Database owners
-- can permanently remove a specifically identified erroneous payment through
-- this non-exposed workflow; linked financial totals are recalculated by the
-- existing payment triggers in the same transaction.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
      session_user = 'postgres'
      and coalesce(current_setting('app.owner_payment_delete', true), '') = 'on'
    )
    or public.is_platform_admin()
    or exists (
      select 1
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
        and users_profile.is_super_admin = true
        and users_profile.status = 'active'
    );
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.permanently_delete_payment(
  target_company_id uuid,
  target_payment_id uuid,
  reason text,
  confirmation text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  payment_record public.payments%rowtype;
  clean_reason text := nullif(btrim(reason), '');
  expected_confirmation text := target_payment_id::text;
  deleted_count integer;
begin
  if session_user <> 'postgres' then
    raise exception 'Permanent payment deletion is restricted to the database owner'
      using errcode = '42501';
  end if;

  if clean_reason is null then
    raise exception 'Deletion reason is required'
      using errcode = '23514';
  end if;

  if btrim(coalesce(confirmation, '')) <> expected_confirmation then
    raise exception 'Typed confirmation must match the payment id'
      using errcode = '23514';
  end if;

  select payments.*
  into payment_record
  from public.payments
  join public.organizations
    on organizations.id = payments.organization_id
  where payments.id = target_payment_id
    and organizations.company_id = target_company_id
  for update of payments;

  if not found then
    raise exception 'Payment not found in the specified company'
      using errcode = 'P0002';
  end if;

  perform set_config('app.owner_payment_delete', 'on', true);
  perform set_config('app.lifecycle_delete', 'on', true);
  perform set_config('app.lifecycle_transition', 'on', true);

  delete from public.payments
  where payments.id = payment_record.id;

  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then
    raise exception 'Payment delete count mismatch: %', deleted_count;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'record_id', payment_record.id,
    'company_id', target_company_id,
    'reason', clean_reason
  );
end;
$$;

revoke all on function private.permanently_delete_payment(uuid, uuid, text, text)
from public, anon, authenticated, service_role;
