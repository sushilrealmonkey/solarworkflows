# Server Handling

SolarWorkflows currently uses Supabase as the backend server layer. The frontend
is a Vite React app that talks to Supabase through the configured public client.
In production, a small Node server serves the built app and backend-only HTTP
routes that must live on the app's custom domain.

## Public HTTP Endpoints

The production server exposes the Meta WhatsApp callback at:

```text
https://app.getbizlee.com/api/webhooks/whatsapp
```

The route accepts Meta's `GET` verification request and returns
`hub.challenge` only when `hub.mode=subscribe` and `hub.verify_token` matches
the server-only `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

Every `POST` must include a valid `X-Hub-Signature-256` generated with the Meta
app secret. The server verifies the HMAC-SHA256 signature against the exact raw
request bytes before parsing JSON. Invalid or missing signatures are rejected.
Never use the verification token as the app secret.

Configure these values in the Railway service environment:

```text
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Use the webhook verification token in Meta's webhook configuration. Obtain the
app secret from the matching Meta app. The Supabase service-role key is used
only by the backend to call the restricted persistence RPC. Never prefix any of
these secrets with `VITE_` or expose them to browser code.

Inbound messages are routed to a tenant through
`whatsapp_phone_numbers.meta_phone_number_id`. Before enabling delivery for a
Meta phone number, insert one active mapping to its owning `company_id` from a
trusted database/admin context. A Meta phone number can belong to only one
company:

```sql
insert into public.whatsapp_phone_numbers (
  company_id,
  meta_phone_number_id,
  meta_business_account_id,
  display_phone_number
)
values (
  '<COMPANY_UUID>',
  '<META_PHONE_NUMBER_ID>',
  '<META_BUSINESS_ACCOUNT_ID>',
  '<DISPLAY_PHONE_NUMBER>'
);
```

Do not expose this insert to browser clients. Authenticated tenant users have
read-only, company-scoped access to their WhatsApp phone number, conversation,
and message rows. Only the service role can call
`persist_inbound_whatsapp_message`.

Inbound messages are stored idempotently by Meta message ID. A retry returns
the existing message rather than creating a duplicate. Delivery/read status
events continue to receive a successful acknowledgement but are not persisted
yet. Messages for an unmapped or inactive Meta phone number are acknowledged
and logged without being stored, so the mapping must be configured before
subscribing production traffic.

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
- Confirm `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` is configured for the service.
- Confirm `META_WHATSAPP_APP_SECRET`, `SUPABASE_URL`, and
  `SUPABASE_SERVICE_ROLE_KEY` are configured for the service.
- Confirm every subscribed Meta phone number has an active, correct
  `whatsapp_phone_numbers` tenant mapping.
- Confirm the WhatsApp webhook `GET` verification and signed JSON `POST`
  acknowledgement work at `/api/webhooks/whatsapp`.
- Replay the same signed test message and confirm only one `whatsapp_messages`
  row exists.
- Confirm the Supabase Edge Function secret `APP_BASE_URL` matches the deployed
  frontend origin.
- Confirm Supabase Auth URL Configuration has the production Site URL and
  exact create-password redirect URL above.

## Migrations

- Add schema changes as Supabase migrations.
- Review RLS whenever a table, view, RPC, or storage bucket changes.
- Do not manually patch production data without a documented plan.
- Keep seed data separate from production behavior.
- Recent migration examples include B2B sale customer snapshot fields and
  B2B/proforma item discount support. When changing financial totals, update
  trigger/RPC behavior and UI calculations together.

## Storage

Storage is used for organization documents and generated PDF-related workflows,
including quotation, proforma invoice, invoice, and purchase order PDFs. Stored
quotation PDFs use `quotation_pdf` document metadata and should be reused for
preview/download when present. Storage access must be protected with Supabase
policies. Upload, replace, read, and delete behavior should be tested with
tenant-scoped users, not only admin credentials.

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
