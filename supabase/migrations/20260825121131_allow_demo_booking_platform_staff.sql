-- Allow Super Admins and active backend platform staff to review and update demo bookings.
create or replace function public.can_manage_demo_bookings()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_super_admin()
    or public.has_platform_role('backend_staff');
$$;

revoke all on function public.can_manage_demo_bookings() from public, anon;
grant execute on function public.can_manage_demo_bookings() to authenticated;

alter table public.demo_bookings enable row level security;

drop policy if exists "Bizlee super admins can manage demo bookings" on public.demo_bookings;
drop policy if exists "Platform staff can view demo bookings" on public.demo_bookings;
drop policy if exists "Platform staff can update demo bookings" on public.demo_bookings;

create policy "Platform staff can view demo bookings"
on public.demo_bookings
for select
to authenticated
using ((select public.can_manage_demo_bookings()));

create policy "Platform staff can update demo bookings"
on public.demo_bookings
for update
to authenticated
using ((select public.can_manage_demo_bookings()))
with check ((select public.can_manage_demo_bookings()));
