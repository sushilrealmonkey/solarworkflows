create table public.mobile_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_id uuid not null references public.in_app_notification_receipts(id) on delete cascade,
  mobile_device_id uuid not null references public.mobile_devices(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  expo_ticket_id text,
  failure_code text,
  failure_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, receipt_id, mobile_device_id)
);

create index mobile_push_deliveries_claim_idx
on public.mobile_push_deliveries(next_attempt_at, created_at)
where status in ('queued', 'processing');
alter table public.mobile_push_deliveries enable row level security;
revoke all on public.mobile_push_deliveries from public, anon, authenticated;

create or replace function public.enqueue_mobile_push_for_receipt()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.mobile_push_deliveries (company_id, receipt_id, mobile_device_id)
  select new.company_id, new.id, devices.id
  from public.mobile_devices devices
  where devices.company_id = new.company_id
    and devices.user_profile_id = new.recipient_user_profile_id
    and devices.revoked_at is null
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_mobile_push_for_receipt() from public, anon, authenticated;

create trigger enqueue_mobile_push_after_receipt
after insert on public.in_app_notification_receipts
for each row execute function public.enqueue_mobile_push_for_receipt();

create or replace function public.claim_mobile_push_delivery_batch(p_limit integer default 100)
returns table (
  delivery_id uuid, company_id uuid, device_id uuid, expo_push_token text,
  title text, message text, destination_route text, attempt_count integer
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select deliveries.id
    from public.mobile_push_deliveries deliveries
    where (
      deliveries.status = 'queued'
      or (deliveries.status = 'processing' and deliveries.locked_at < now() - interval '10 minutes')
    )
      and deliveries.next_attempt_at <= now()
      and deliveries.attempt_count < 5
    order by deliveries.next_attempt_at, deliveries.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ), updated as (
    update public.mobile_push_deliveries deliveries
    set status = 'processing', locked_at = now(), attempt_count = deliveries.attempt_count + 1, updated_at = now()
    from claimed where deliveries.id = claimed.id
    returning deliveries.*
  )
  select updated.id, updated.company_id, devices.id, devices.expo_push_token,
    coalesce(events.payload ->> 'title', 'Bizlee update'),
    coalesce(events.payload ->> 'message', 'Your workspace has a new update.'),
    coalesce(events.payload ->> 'destination_route', '/notifications'),
    updated.attempt_count
  from updated
  join public.in_app_notification_receipts receipts on receipts.id = updated.receipt_id and receipts.company_id = updated.company_id
  join public.notification_events events on events.id = receipts.event_id and events.company_id = receipts.company_id
  join public.mobile_devices devices on devices.id = updated.mobile_device_id and devices.company_id = updated.company_id
  where devices.revoked_at is null;
end;
$$;
revoke all on function public.claim_mobile_push_delivery_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_mobile_push_delivery_batch(integer) to service_role;

comment on table public.mobile_push_deliveries is 'Idempotent Expo push delivery queue derived from durable in-app notification receipts.';
