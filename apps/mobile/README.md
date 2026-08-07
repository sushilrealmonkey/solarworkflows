# Bizlee Mobile

Expo Router application for tenant EPC staff. Copy `.env.example` to `.env.local`, configure the public API and Supabase publishable values, then run `npm run mobile:start` from the repository root.

The app uses Supabase only for authentication. All business data goes through `/api/mobile/v1`, where the caller JWT, active tenant, permissions, subscription, and RLS are enforced.

Build profiles are defined in `eas.json`. Configure the EAS project ID and signing credentials before producing Android or iOS binaries.
