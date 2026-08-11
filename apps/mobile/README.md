# Bizlee Mobile

Expo Router application for tenant EPC staff. The current workspace includes
Supabase Auth and enrollment, branded Home/Dashboard screens, searchable module
lists, record details, customer and enquiry creation, in-app notifications,
push registration, app/universal links, and environment-specific EAS builds.

Supabase is used directly only for authentication. All business data goes
through `/api/mobile/v1`, where the caller JWT, active tenant, role permissions,
Core/Pro access, and RLS are enforced.

## Local setup

Copy `.env.example` to `.env.local` and configure the API root, public Supabase
values, and EAS project ID. From the repository root run:

```bash
npm run mobile:start
npm run mobile:check
npm run test:mobile-api
```

Use a LAN-reachable API host when running on a physical device. Keep the
Supabase service role, worker secrets, Razorpay secrets, Meta credentials, and
OpenAI key out of Expo public variables.

## Build profiles

`eas.json` defines development, staging, and production profiles.
`app.config.ts` provides environment-specific bundle/package identifiers,
Bizlee icon and splash assets, notifications, and links under
`https://app.getbizlee.com/mobile`. Configure EAS signing, store credentials,
association files, production environment values, and Supabase redirect URLs
before release.

See [`../../docs/mobile-app.md`](../../docs/mobile-app.md) for architecture,
security, push delivery, and release details. The API contract is
[`../../docs/mobile-api.openapi.yaml`](../../docs/mobile-api.openapi.yaml).
