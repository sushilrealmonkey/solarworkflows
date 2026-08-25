-- Allow Super Admins to mark a demo booking as rescheduled after a slot change.
alter table public.demo_bookings
  drop constraint if exists demo_bookings_status_check;

alter table public.demo_bookings
  add constraint demo_bookings_status_check
  check (status in ('scheduled', 'contacted', 'completed', 'rescheduled', 'cancelled', 'no_show'));
