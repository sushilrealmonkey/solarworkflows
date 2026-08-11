# Mobile Application and API

Status: implemented in the repository as the `@bizlee/mobile` Expo workspace
and the `/api/mobile/v1` Node API. Native signing, EAS environment values, worker
secrets, and deep-link association files remain environment-specific release
work.

## Application

`apps/mobile` is an Expo Router application for tenant EPC staff. The current
navigation provides Home, Dashboard, Projects, and Inventory tabs plus module
screens for enquiries, customers, site surveys, quotations, projects, and
documents. Users can search lists, open record details, create project-based
customers and enquiries when permitted, read notifications, and enroll a first
workspace from the native auth flow.

The app uses Supabase directly only for authentication. Business data is fetched
through the production Node server so request validation, tenant
resolution, role permissions, plan access, and database RLS remain aligned with
the web product.

## API Boundary

The versioned API root is `/api/mobile/v1`. Important endpoints are documented
in [`mobile-api.openapi.yaml`](mobile-api.openapi.yaml):

- session context, tenant branding, roles, permissions, and subscription access
- dashboard summary and permission-scoped Bizlee AI proxy endpoints
- cursor-based lists and record detail reads
- customer and enquiry creation
- in-app notification list/read actions
- mobile-device registration and revocation
- first-workspace enrollment

Every authenticated request carries a Supabase access token. The Node layer
resolves an active `users_profile`, calls Supabase with the caller JWT for
business reads and writes, and returns a stable error envelope with a request ID.
The service role is limited to trusted operations such as device registration;
it is never included in the mobile bundle.

## Push Notifications

`mobile_devices` stores tenant-owned Expo push registrations. New in-app
notification receipts enqueue rows in `mobile_push_deliveries`; the
`process-mobile-push` Edge Function claims, sends, retries, and records results.
Revoked installations are excluded.

Required server-side worker configuration:

```text
MOBILE_PUSH_WORKER_SECRET=
```

Required Vault entries for the scheduled worker:

```text
mobile_push_worker_project_url
mobile_push_worker_secret
```

## Local Setup

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and configure:

```text
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000/api/mobile/v1
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_EAS_PROJECT_ID=
```

Then run `npm run mobile:start`, `npm run mobile:check`, and
`npm run test:mobile-api` from the repository root. Use a reachable host instead
of `127.0.0.1` when testing on a physical device.

## Release Configuration

`apps/mobile/eas.json` defines development, staging, and production profiles.
`app.config.ts` assigns environment-specific bundle/package IDs, universal/app
links under `https://app.getbizlee.com/mobile`, notification configuration, and
the branded icon/splash assets. Configure the EAS project, signing credentials,
platform association files, production API URL, and Supabase redirect URLs
before distributing a build.
# Field Staff access

Tabs, shortcuts, and module tiles are permission-driven. Field Staff receives
assigned Site Surveys and released Projects. The mobile API uses the caller JWT
and exposes `/api/mobile/v1/field/site-surveys` and
`/api/mobile/v1/field/projects` list/detail/status contracts, plus survey
technical and evidence registration endpoints. It does not use service-role
retrieval for field records.
