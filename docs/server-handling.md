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

The current Supabase project files live under `supabase/`.

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
