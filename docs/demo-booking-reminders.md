# Demo booking WhatsApp reminders

The `process-demo-booking-reminders` Edge Function runs every minute through the existing database cron job. It sends opted-in, eligible bookings a reminder one hour and ten minutes before their demo. Expired reminders are skipped.

Both approved reminder templates currently accept exactly two body parameters: customer first name and the formatted meeting time in the booking timezone. Meeting links are static content in the approved templates. If templates change, update `parameters.ts` and its regression tests together.

Run the payload tests without contacting Meta:

```sh
node --experimental-strip-types --test supabase/functions/process-demo-booking-reminders/parameters.test.ts
```

Deploy only this function, preserving its worker-secret authentication:

```sh
npx supabase functions deploy process-demo-booking-reminders --use-api --no-verify-jwt
```

Operational settings live in `booking_private.demo_booking_reminder_settings`. `feature_enabled` must be true. `test_mode=true` restricts sends to `test_recipient_allowlist`; production delivery requires `test_mode=false`. These settings belong to the deployed environment and are not reset by a code deployment.

On 2026-09-07 the deployed worker was repaired to send two parameters instead of four, and production test mode was disabled. Historical failures (Meta error 132000) and reminders skipped after meeting start were retained as audit records. Future reminders remain scheduled normally.

To verify delivery, inspect `public.demo_booking_reminders` for `sent_at`, `delivered_at`, `failure_code`, and `failure_message`. A successful cron run only means the HTTP request was scheduled; the reminder row records provider acceptance and delivery status.
