# Bizlee Mobile

Expo Router application for tenant EPC staff. The current workspace includes
Supabase Auth and enrollment, branded Home/Dashboard screens, searchable module
lists, record details, customer and enquiry creation, in-app notifications,
push registration, app/universal links, and environment-specific mobile builds.

Supabase is used directly only for authentication. All business data goes
through `/api/mobile/v1`, where the caller JWT, active tenant, role permissions,
Core/Pro access, and RLS are enforced.

## Local setup

Copy `.env.example` to `.env.local` and configure the API root, public Supabase
values, and Expo push project ID. From the repository root run:

```bash
npm run mobile:start
npm run mobile:check
npm run test:mobile-api
```

Use a LAN-reachable API host when running on a physical device. Keep the
Supabase service role, worker secrets, Razorpay secrets, Meta credentials, and
OpenAI key out of Expo public variables.

## Distribution

Codemagic is the exclusive Android and iOS build and distribution pipeline. The root
`codemagic.yaml` creates signed Android AAB/APK artifacts and an iOS IPA from a
clean Expo prebuild. Release workflows run manually or for `mobile-v*` tags;
normal branch pushes do not publish an app.

EAS Build and EAS Submit are not part of the release path. Expo remains the app
framework and push client; Codemagic owns native generation, signing, artifacts,
and store upload. `app.config.ts` provides environment-specific bundle/package identifiers,
store build numbers, Bizlee icon and splash assets, notifications, and links
under `https://app.getbizlee.com/mobile`.

See [`../../docs/mobile-app.md`](../../docs/mobile-app.md) for architecture,
security, push delivery, and release details. See
[`../../docs/codemagic-distribution.md`](../../docs/codemagic-distribution.md)
for the Codemagic signing, variables, and store setup. The API contract is
[`../../docs/mobile-api.openapi.yaml`](../../docs/mobile-api.openapi.yaml).
