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

- Trial ending and trial expired
- Subscription action required
- Requested daily AI workspace summary
- New sign-in and account-change notices
- Product tips, plan offers, and product announcements
- Signup OTP remains handled by the existing Supabase Auth Send SMS Hook

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

`NOTIFICATION_TEST_MODE` defaults to enabled. In test mode the database settles
any recipient outside `NOTIFICATION_TEST_RECIPIENTS` as skipped before a Meta
request is made.

## Daily Summaries

`process-daily-summaries` runs only for active tenant administrators who:

- have a verified notification recipient;
- explicitly enabled `requested_daily_summary`;
- selected a delivery time; and
- have no active opt-out.

The generator reads aggregate counts using an explicit organization ID resolved
from the recipient's company. It does not reuse the logged-in user's personal
brief and does not send customer names, phone numbers, addresses, invoice
amounts, raw notes, or record content to WhatsApp. OpenAI turns only the bounded
aggregate snapshot into a short headline and summary.

## Consent and Opt-Outs

The Settings screen records consent independently for every notification type.
Disabling a type creates an active `notification_unsubscribes` row.

Inbound case-insensitive `STOP` or `UNSUBSCRIBE`:

- disables all WhatsApp preferences for the matching verified number; and
- creates an `all_whatsapp` opt-out.

Inbound `START` clears the global opt-out but does not silently re-enable
individual preferences. The tenant administrator must select the desired types
again in Bizlee.

## Required Function Secrets

```text
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_GRAPH_API_VERSION=
NOTIFICATION_WORKER_SECRET=
NOTIFICATION_TEST_MODE=true
NOTIFICATION_TEST_RECIPIENTS=
DAILY_SUMMARY_WORKER_SECRET=
OPENAI_API_KEY=
ASSISTANT_MODEL=
```

## Required Vault Entries

```text
notification_worker_project_url
notification_worker_secret
daily_summary_worker_secret
```

The migration schedules no jobs when these entries are absent. The Vault
worker secrets must exactly match the corresponding Edge Function secrets.

## Rollout Checklist

1. Apply migrations in staging and run both notification SQL test files.
2. Deploy `notification-settings`, `process-notifications`, and
   `process-daily-summaries`.
3. Configure Function secrets and the three Vault entries.
4. Keep `NOTIFICATION_TEST_MODE=true` and allowlist internal numbers only.
5. Enable preferences for an internal tenant admin.
6. Queue one trial event and confirm sent, delivered, and read transitions.
7. Reply `STOP`; confirm all preferences are disabled before another send.
8. Verify the daily summary contains aggregate counts only.
9. Review Meta quality, failures, blocks, and costs during the pilot.
10. Set `NOTIFICATION_TEST_MODE=false` only after explicit launch approval.

Never store Meta access tokens, service-role credentials, worker secrets, or
Vault secret values in browser environment variables.
