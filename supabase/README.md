# Supabase

This folder contains Supabase configuration, migrations, seed files, and Edge
Functions for SolarWorkflows.

## Edge Functions

- `invite-epc-company-admin` sends Supabase Auth invite/setup emails for EPC
  company admins and handles super-admin workspace/admin status actions from a
  trusted service-role environment.
- `templates/invite.html` is the source-controlled Supabase Auth invite email
  template. Copy it into the hosted project's **Authentication > Email
  Templates > Invite user** editor when the template changes.

Deploy function secrets with server-only values. Do not expose the
`SUPABASE_SERVICE_ROLE_KEY` through frontend `VITE_` variables.

## Hosted invite email delivery

The Edge Function calls Supabase Auth `inviteUserByEmail`; it does not call
Resend directly. Configure the hosted Supabase project under **Authentication >
SMTP Settings** with Resend's SMTP credentials and the verified sender email.
The current production sender is `team@getbizlee.com`.

Use these Resend SMTP values:

```text
Host: smtp.resend.com
Port: 587
Username: resend
Sender email: team@getbizlee.com
```

Store the Resend API key only in the Supabase SMTP password field. Never add it
to this repository or expose it through a `VITE_` environment variable.
