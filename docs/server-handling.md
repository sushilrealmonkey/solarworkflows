# Server Handling

SolarWorkflows currently uses Supabase as the backend server layer. The frontend
is a Vite React app that talks to Supabase through the configured public client.

## Local Frontend

Common scripts:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

Use `.env.example` as the template for local environment variables. Do not
commit real project secrets.

## Supabase

Supabase owns:

- Authentication
- Postgres database
- Row Level Security policies
- Storage buckets and storage policies
- Local/staging/production migrations
- Seed data for local or disposable environments

Super admin Auth users are created from a trusted environment with
`npm run setup:super-admin`. That command needs the Supabase service-role key
and must not be run from browser code or committed configuration.

Super admins use the platform area at `/companies`. The frontend redirects
super admins away from tenant operational routes, while Supabase RLS and
super-admin checks remain the server-side enforcement layer for platform data.

EPC company admins are invited by super admins from the platform Companies page.
The browser calls the `invite-epc-company-admin` Supabase Edge Function, and the
function uses the service-role key to send the Supabase invite email. The
service-role key must stay inside trusted server or Edge Function environments
and must never be exposed to browser code.

The same Edge Function accepts authenticated super-admin requests to resend
setup links, mark workspaces active/inactive, and mark primary admin profiles
invited/active/inactive.

The invite email redirects admins to `/create-password`. After the admin sets a
password, `sync_auth_user_profile` links the Supabase Auth user to the invited
`users_profile` row and activates the admin profile.

Configure the Edge Function environment with:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_BASE_URL=
```

`APP_BASE_URL` should be the deployed frontend origin, without a trailing slash.
For production it should be:

```text
APP_BASE_URL=https://app.getbizlee.com
```

The Edge Function uses the browser request origin first. `APP_BASE_URL` is the
fallback for trusted server-to-server calls that do not include an origin.
Supabase Auth URL configuration must use the deployed app origin as the Site URL
and include the exact `/create-password` redirect URL. For production:

```text
Site URL: https://app.getbizlee.com
Redirect URL: https://app.getbizlee.com/create-password
```

Keep local development redirect URLs in the allowlist as needed, such as
`http://localhost:3000/create-password` or
`http://127.0.0.1:3000/create-password`.

The current Supabase project files live under `supabase/`.

## Railway URL Setup

The frontend custom domain should be configured in Railway as
`https://app.getbizlee.com`. After adding or changing a domain:

- Confirm the domain responds over HTTPS.
- Confirm `/create-password` serves the frontend app shell.
- Confirm Railway frontend environment variables point to the intended Supabase
  project.
- Confirm the Supabase Edge Function secret `APP_BASE_URL` matches the deployed
  frontend origin.
- Confirm Supabase Auth URL Configuration has the production Site URL and
  exact create-password redirect URL above.

## Migrations

- Add schema changes as Supabase migrations.
- Review RLS whenever a table, view, RPC, or storage bucket changes.
- Do not manually patch production data without a documented plan.
- Keep seed data separate from production behavior.

## Storage

Storage is used for organization documents and generated PDF-related workflows,
including quotation, invoice, and purchase order PDFs. Storage access must be
protected with Supabase policies. Upload, replace, read, and delete behavior
should be tested with tenant-scoped users, not only admin credentials.

## Environments

Use separate Supabase projects or clearly separated databases for local,
staging, and production. QA seed data is for local/staging validation only and
must not be run against production.

## Operational Checks

Before releasing server-affecting changes:

- Confirm migrations apply cleanly.
- Confirm RLS policies allow expected tenant access and block cross-tenant
  access.
- Confirm storage policies match document workflows.
- Confirm frontend environment variables point to the intended Supabase project.
- Update the changelog and relevant docs.
