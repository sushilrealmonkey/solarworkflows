# AI Agent Guide

This guide is for AI agents working in the SolarWorkflows repository.

## Non-Negotiable Project Rules

- This is a multi-tenant SaaS app.
- Never hardcode company-specific production values.
- Every future business table must include a tenant owner column; the project
  rule prefers `company_id`.
- Use Supabase for backend, authentication, and storage.
- Use TypeScript.
- Keep code modular by module folder.
- Do not add new business logic unless the user explicitly asks for it.
- Keep UI mobile-first.

## Before Editing

- Read `AGENTS.md`.
- Check `docs/README.md` and the relevant docs for the area being changed.
- Inspect the current module, route, API helper, migration, and type patterns.
- Preserve user changes and unrelated work.

## Supabase Safety

- Treat RLS as the security boundary.
- Do not rely on hidden buttons or route guards as authorization.
- Review policies when touching tables, views, RPCs, functions, or storage.
- Do not place privileged secrets in frontend code.
- Treat QA seed data as local/staging-only.

## Tenant Ownership

The project rule prefers `company_id`, but current migrations also contain
`organization_id` and `tenant_id`. Do not create a new ownership pattern without
a migration plan. When editing an existing table, follow the established owner
column for that table unless the task is specifically to normalize ownership.

## Documentation Expectations

If an implementation changes scope, architecture, routes, modules, schema,
server handling, or conventions, update the matching docs in the same work.
Keep docs factual and avoid presenting planned behavior as implemented behavior.

## Safe Output

When completing work, report:

- files changed
- tests or checks run
- checks intentionally skipped
- any remaining risk or follow-up needed
