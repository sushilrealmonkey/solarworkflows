# Supabase

This folder contains Supabase configuration, migrations, seed files, and Edge
Functions for SolarWorkflows.

## Edge Functions

- `invite-epc-company-admin` sends Supabase Auth invite/setup emails for EPC
  company admins and handles super-admin workspace/admin status actions from a
  trusted service-role environment.
- `templates/invite.html` and `templates/recovery.html` are the
  source-controlled Supabase Auth emails for initial invitations and resent
  password setup links. Publish them to the hosted Auth configuration whenever
  either template changes.
- Subscription functions create, verify, cancel, and reconcile Razorpay
  subscriptions; the webhook also creates tenant-visible GST invoices.
- `assistant-brief` and `assistant-chat` run the Pro-only, caller-JWT Bizlee AI
  experience.
- Notification functions manage tenant preferences, approved WhatsApp delivery,
  daily summaries, reply alerts, and native Expo push delivery.

Deploy function secrets with server-only values. Do not expose the
`SUPABASE_SERVICE_ROLE_KEY` through frontend `VITE_` variables.

## Hosted invite email delivery

The Edge Function calls Supabase Auth `inviteUserByEmail`; it does not call
Resend directly. Configure the hosted Supabase project under **Authentication >
SMTP Settings** with Resend's SMTP credentials and the verified sender email.
The current production sender is `team@getbizlee.com`.

The invite and recovery templates send `TokenHash` to the app's
`/create-password` route, where the frontend exchanges it with Supabase Auth.
Do not replace this with `ConfirmationURL`: email security scanners can prefetch
that one-time URL and consume the setup token before the recipient clicks it.
Keep link tracking disabled in the external email provider.

Use these Resend SMTP values:

```text
Host: smtp.resend.com
Port: 587
Username: resend
Sender email: team@getbizlee.com
```

Store the Resend API key only in the Supabase SMTP password field. Never add it
to this repository or expose it through a `VITE_` environment variable.

## WhatsApp phone OTP

Supabase Auth generates and verifies the six-digit OTP. The signed `send-sms`
Edge Function delivers that code through an approved Meta WhatsApp
authentication template and does not store it.

Required server-only Function secrets are `SEND_SMS_HOOK_SECRET`,
`META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`,
`META_WHATSAPP_GRAPH_API_VERSION`, `META_WHATSAPP_OTP_TEMPLATE_NAME`, and
`META_WHATSAPP_OTP_TEMPLATE_LANGUAGE`.

Deploy with `npx supabase functions deploy send-sms --no-verify-jwt`, then set
the hosted **Authentication > Hooks > Send SMS** HTTP URL to
`https://<project-ref>.supabase.co/functions/v1/send-sms`. Configure the hook
with the same `SEND_SMS_HOOK_SECRET`. Enable hosted phone signup only after all
Function secrets are present.

The hosted Auth email rate limit is set to 30 messages per hour. Invite,
recovery, signup, and email-change messages share this project-wide quota.

## WhatsApp tenant notifications

Tenant lifecycle, billing, requested daily-summary, security, and optional
marketing notifications use the separate notification queue. Deploy
`notification-settings`, `process-notifications`, and
`process-daily-summaries`. Production sending remains disabled while
`NOTIFICATION_TEST_MODE=true`; only numbers in
`NOTIFICATION_TEST_RECIPIENTS` can be claimed.

See `docs/whatsapp-tenant-notifications.md` for required secrets, Vault
entries, consent behavior, and the rollout checklist.

## Core/Pro subscription access

The plan catalogue, module/capability access levels, Core seat limit, and
server-side write/Storage enforcement are documented in
`docs/subscription-access.md`. Apply migrations in order and run
`supabase/tests/subscription_trial_billing_test.sql` after subscription changes.
Do not change Razorpay plan IDs or catalogue prices in only one layer.

## New trial signup email

Every newly created trial subscription is placed in a tenant-scoped outbox and
the `process-trial-signups` Edge Function delivers the notification through
Resend. It uses the `TRIAL_SIGNUP_WORKER_SECRET`, `RESEND_API_KEY`, and
`TRIAL_REMINDER_FROM_EMAIL` Function secrets. Set the optional
`TRIAL_SIGNUP_NOTIFICATION_EMAIL` secret to one or more comma-separated inboxes;
otherwise all active super-admin profiles with an email receive the message.

The scheduled job uses matching `trial_signup_notification_project_url` and
`trial_signup_notification_worker_secret` Vault values and runs once per minute.
Deploy the worker with JWT verification disabled because it authenticates the
private `x-worker-secret` header:

```powershell
npx supabase functions deploy process-trial-signups --no-verify-jwt
```

Run `supabase/tests/trial_signup_notification_test.sql` after applying the
migration.

## Native mobile support

`mobile_devices` and `mobile_push_deliveries` are tenant-owned support tables for
the Expo client. Deploy `process-mobile-push` with JWT verification disabled,
set `MOBILE_PUSH_WORKER_SECRET`, and configure matching
`mobile_push_worker_project_url` and `mobile_push_worker_secret` Vault entries
before enabling the scheduled job. The public API contract and release boundary
are documented in `docs/mobile-app.md` and `docs/mobile-api.openapi.yaml`.

Setup-link delivery must create exactly one Auth token. Do not generate a
second recovery link after calling `resetPasswordForEmail`, because issuing a
new recovery token can invalidate the token that was just emailed.

## Lifecycle Storage cleanup

Permanent deletion of eligible documents is asynchronous: the lifecycle RPC
marks the document pending deletion and inserts an idempotent queue row. Deploy
`process-storage-cleanup` with JWT verification disabled, set a strong
server-only `STORAGE_CLEANUP_SECRET`, and invoke it from a trusted scheduled
job using the same value in the `x-cleanup-secret` header. The worker deletes
the Storage object first and removes document metadata only after Storage
reports success; failed rows remain retryable.

```powershell
npx supabase functions deploy process-storage-cleanup --no-verify-jwt
```
