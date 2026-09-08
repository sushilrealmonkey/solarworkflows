-- The return columns of a PL/pgSQL RETURNS TABLE function are variables in
-- its body.  `company_id` consequently conflicted with the unqualified
-- columns in the two INSERT conflict targets below, causing the 10:00 IST
-- worker invocation to fail before it could queue any delivery.
create or replace function public.list_due_daily_summary_recipients(
  p_limit integer default 5000
)
returns table (
  company_id uuid,
  organization_id uuid,
  local_date date
)
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
begin
  if p_limit < 1 or p_limit > 5000 then
    raise exception 'Daily summary limit must be between 1 and 5000'
      using errcode = '22023';
  end if;

  with active_admins as (
    select distinct on (profiles.company_id, profiles.id)
      profiles.company_id,
      profiles.id as user_profile_id,
      '+' || regexp_replace(profiles.phone, '[^0-9]', '', 'g') as phone_e164
    from public.users_profile as profiles
    where profiles.status = 'active'
      and nullif(btrim(profiles.phone), '') is not null
      and regexp_replace(profiles.phone, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{7,14}$'
      and exists (
        select 1
        from public.user_roles as user_roles
        join public.roles as roles on roles.id = user_roles.role_id
        where (
          user_roles.user_profile_id = profiles.id
          or user_roles.user_id = profiles.auth_user_id
        )
          and roles.company_id = profiles.company_id
          and roles.role_key = 'admin'
      )
    order by profiles.company_id, profiles.id
  )
  insert into public.notification_recipients (
    company_id,
    user_profile_id,
    phone_e164,
    verification_status,
    verified_at,
    timezone
  )
  select
    active_admins.company_id,
    active_admins.user_profile_id,
    active_admins.phone_e164,
    'verified',
    now(),
    'Asia/Kolkata'
  from active_admins
  on conflict (company_id, user_profile_id) do update
  set
    phone_e164 = excluded.phone_e164,
    verification_status = 'verified',
    verified_at = coalesce(
      public.notification_recipients.verified_at,
      excluded.verified_at
    ),
    timezone = 'Asia/Kolkata',
    updated_at = now();

  insert into public.notification_preferences (
    company_id,
    recipient_id,
    notification_type,
    channel,
    is_enabled,
    delivery_time,
    timezone,
    consent_status,
    consent_source,
    consented_at
  )
  select
    recipients.company_id,
    recipients.id,
    'requested_daily_summary',
    'whatsapp',
    true,
    time '10:00',
    'Asia/Kolkata',
    'granted',
    'platform_fixed_daily_epc_admin_summary',
    now()
  from public.notification_recipients as recipients
  join public.users_profile as profiles
    on profiles.id = recipients.user_profile_id
    and profiles.company_id = recipients.company_id
  where profiles.status = 'active'
    and exists (
      select 1
      from public.user_roles as user_roles
      join public.roles as roles on roles.id = user_roles.role_id
      where (
        user_roles.user_profile_id = profiles.id
        or user_roles.user_id = profiles.auth_user_id
      )
        and roles.company_id = profiles.company_id
        and roles.role_key = 'admin'
    )
  on conflict (company_id, recipient_id, notification_type, channel) do update
  set
    is_enabled = true,
    delivery_time = time '10:00',
    timezone = 'Asia/Kolkata',
    consent_status = 'granted',
    consent_source = 'platform_fixed_daily_epc_admin_summary',
    consented_at = coalesce(
      public.notification_preferences.consented_at,
      excluded.consented_at
    ),
    updated_at = now();

  delete from public.notification_unsubscribes as unsubscribes
  using public.notification_recipients as recipients,
    public.users_profile as profiles
  where unsubscribes.company_id = recipients.company_id
    and unsubscribes.recipient_id = recipients.id
    and recipients.user_profile_id = profiles.id
    and profiles.company_id = recipients.company_id
    and unsubscribes.scope = 'requested_daily_summary'
    and profiles.status = 'active'
    and exists (
      select 1
      from public.user_roles as user_roles
      join public.roles as roles on roles.id = user_roles.role_id
      where (
        user_roles.user_profile_id = profiles.id
        or user_roles.user_id = profiles.auth_user_id
      )
        and roles.company_id = profiles.company_id
        and roles.role_key = 'admin'
    );

  update public.notification_preferences as preferences
  set
    is_enabled = false,
    consent_status = 'revoked',
    consented_at = null,
    updated_at = now()
  from public.notification_recipients as recipients
  where preferences.company_id = recipients.company_id
    and preferences.recipient_id = recipients.id
    and preferences.notification_type = 'requested_daily_summary'
    and preferences.channel = 'whatsapp'
    and not exists (
      select 1
      from public.users_profile as profiles
      where profiles.id = recipients.user_profile_id
        and profiles.company_id = recipients.company_id
        and profiles.status = 'active'
        and exists (
          select 1
          from public.user_roles as user_roles
          join public.roles as roles on roles.id = user_roles.role_id
          where (
            user_roles.user_profile_id = profiles.id
            or user_roles.user_id = profiles.auth_user_id
          )
            and roles.company_id = profiles.company_id
            and roles.role_key = 'admin'
        )
    );

  return query
  select distinct
    recipients.company_id,
    profiles.organization_id,
    (now() at time zone 'Asia/Kolkata')::date
  from public.notification_recipients as recipients
  join public.notification_preferences as preferences
    on preferences.company_id = recipients.company_id
    and preferences.recipient_id = recipients.id
    and preferences.notification_type = 'requested_daily_summary'
    and preferences.channel = 'whatsapp'
    and preferences.is_enabled
    and preferences.consent_status = 'granted'
  join public.users_profile as profiles
    on profiles.id = recipients.user_profile_id
    and profiles.company_id = recipients.company_id
  where profiles.status = 'active'
    and exists (
      select 1
      from public.user_roles as user_roles
      join public.roles as roles on roles.id = user_roles.role_id
      where (
        user_roles.user_profile_id = profiles.id
        or user_roles.user_id = profiles.auth_user_id
      )
        and roles.company_id = profiles.company_id
        and roles.role_key = 'admin'
    )
    and not exists (
      select 1
      from public.notification_unsubscribes as unsubscribes
      where unsubscribes.company_id = recipients.company_id
        and unsubscribes.recipient_id = recipients.id
        and unsubscribes.resubscribed_at is null
        and unsubscribes.scope in ('all_optional', 'all_whatsapp')
    )
  order by recipients.company_id, profiles.organization_id
  limit p_limit;
end;
$$;

revoke all on function public.list_due_daily_summary_recipients(integer)
from public, anon, authenticated;
grant execute on function public.list_due_daily_summary_recipients(integer)
to service_role;
