# WhatsApp Tenant Notifications

Status: implemented locally; production rollout is disabled until migrations,
functions, secrets, Vault entries, and test-mode delivery are verified.

## Scope

Bizlee sends tenant notifications from the Bizlee-owned WhatsApp Business
number. This is separate from the super-admin prospect outreach workspace.
Every tenant-owned row includes `company_id`; composite foreign keys prevent
events, recipients, preferences, deliveries, and opt-outs from being linked
across tenants.

Implemented notification types:

- Consented one-time welcome after phone-verified workspace signup
- Trial ending and trial expired
- Subscription action required
- Requested daily AI workspace summary
- New sign-in and account-change notices
- Product tips, plan offers, and product announcements
- Customer reply alerts to eligible tenant administrators
- Signup OTP remains handled by the existing Supabase Auth Send SMS Hook

The approved `account_welcome` English template is catalogued as `active`.
Phone onboarding records consent and an idempotent tenant event, then queues a
delivery for the verified signup number. The activation trigger also backfills
any welcome events that were recorded while the template was pending.

## Delivery Flow

1. A trusted producer calls `queue_notification_event`.
2. The database creates one idempotent event and expands it only to verified
   recipients with an enabled, explicitly granted WhatsApp preference.
3. `process-notifications` atomically claims due deliveries.
4. The worker sends the approved Meta template and records the Meta message ID.
5. The signed Railway webhook applies sent, delivered, read, and failed
   callbacks to `notification_deliveries`.
6. Retryable provider failures use bounded exponential backoff. Permanent
   failures are cancelled after at most five attempts.

Customer replies are persisted by the signed webhook and queued separately from
ordinary tenant lifecycle events. The notification worker claims reply alerts,
sends the approved `bizlee_customer_reply_alert` template with a bounded preview,
and records delivery updates idempotently. Administrators can open the WhatsApp
workspace to review the full tenant-scoped conversation; notification text must
not become a substitute for authorization-scoped message access.

Tenant workflow events also publish user-scoped in-app notification receipts.
Active native device registrations can turn those receipts into optional Expo
push deliveries through `process-mobile-push`.

`NOTIFICATION_TEST_MODE` defaults to enabled. In test mode the database settles
any recipient outside `NOTIFICATION_TEST_RECIPIENTS` as skipped before a Meta
request is made.

## Daily Summaries

`process-daily-summaries` runs at 10:00 AM Asia/Kolkata (04:30 UTC) for every
active EPC Admin with a valid workspace WhatsApp number. Bizlee automatically
keeps the notification destination and daily-summary delivery enabled, so an
admin does not need to configure a recipient, opt in, or select a delivery
time in Settings. A global WhatsApp `STOP` or `UNSUBSCRIBE` remains respected.

The generator reads aggregate counts using an explicit organization ID resolved
from the recipient's company. It does not reuse the logged-in user's personal
brief and does not send customer names, phone numbers, addresses, invoice
amounts, raw notes, or record content to WhatsApp. OpenAI turns only the bounded
aggregate snapshot into a short headline and summary.

When all four daily operational counts are zero, an active 14-day trial receives
one short, positive fallback message selected deterministically per company and
day. This avoids an AI request and varies the onboarding prompt across the
trial. After the trial, an empty snapshot is not sent; data-based summaries are
unaffected.

## Opt-Outs

Daily summaries are platform-managed rather than configurable in Settings. The
fixed delivery still respects a global WhatsApp opt-out.

Inbound case-insensitive `STOP` or `UNSUBSCRIBE`:

- disables all WhatsApp preferences for the matching verified number; and
- creates an `all_whatsapp` opt-out.

Inbound `START` clears the global opt-out. The next scheduled run restores the
fixed daily summary for an eligible EPC Admin; it does not re-enable other
notification types.

## Required Function Secrets

```text
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_GRAPH_API_VERSION=
NOTIFICATION_WORKER_SECRET=
NOTIFICATION_TEST_MODE=true
NOTIFICATION_TEST_RECIPIENTS=
DAILY_SUMMARY_WORKER_SECRET=
MOBILE_PUSH_WORKER_SECRET=
OPENAI_API_KEY=
ASSISTANT_MODEL=
```

## Required Vault Entries

```text
notification_worker_project_url
notification_worker_secret
daily_summary_worker_secret
mobile_push_worker_project_url
mobile_push_worker_secret
```

The daily-summary cron job remains scheduled when its Vault entries are
absent, but makes no request until they are provisioned. This lets it begin
working automatically if secrets are configured after deployment. Vault worker
secrets must exactly match the corresponding Edge Function secrets.

## Rollout Checklist

1. Apply migrations in staging and run both notification SQL test files.
2. Deploy `process-notifications` and `process-daily-summaries`.
3. Configure all required Function secrets and Vault entries.
4. Keep `NOTIFICATION_TEST_MODE=true` and allowlist internal numbers only.
5. Ensure an internal EPC Admin has an active account and verified workspace
   phone number.
6. Queue one trial event and confirm sent, delivered, and read transitions.
7. Reply `STOP`; confirm all preferences are disabled before another send.
8. Verify the daily summary contains aggregate counts only.
9. Review Meta quality, failures, blocks, and costs during the pilot.
10. Set `NOTIFICATION_TEST_MODE=false` only after explicit launch approval.

Never store Meta access tokens, service-role credentials, worker secrets, or
Vault secret values in browser environment variables.
