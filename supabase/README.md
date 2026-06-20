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

The hosted Auth email rate limit is set to 30 messages per hour. Invite,
recovery, signup, and email-change messages share this project-wide quota.

Setup-link delivery must create exactly one Auth token. Do not generate a
second recovery link after calling `resetPasswordForEmail`, because issuing a
new recovery token can invalidate the token that was just emailed.
