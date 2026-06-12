# SolarWorkflows Documentation

This folder is the long-term project memory for SolarWorkflows. It should help
developers and AI agents understand the product intent, current implementation,
technical guardrails, and safe change workflow before editing the app.

SolarWorkflows is a multi-tenant SaaS project. Documentation must never define
company-specific production behavior, hardcode one tenant's values, or introduce
business logic that has not been approved for implementation.

## Core Docs

| Doc | Purpose |
| --- | --- |
| [Project Scope](project-scope.md) | Defines current scope, boundaries, and non-goals. |
| [Project Vision](project-vision.md) | Describes the long-term product direction. |
| [Functionalities](functionalities.md) | Summarizes current and intended module capabilities without inventing business logic. |
| [Technical Specification](technical-specification.md) | Captures stack, architecture, data, auth, and integration rules. |
| [Server Handling](server-handling.md) | Explains Supabase, local development, deployment, storage, and operational handling. |
| [Architecture](architecture.md) | Explains module boundaries, routing, services, and frontend/backend responsibilities. |
| [Developer Guide](developer-guide.md) | Gives setup, commands, conventions, and safe development workflow. |
| [AI Agent Guide](ai-agent-guide.md) | Repo-specific instructions for AI agents working on the project. |
| [Data Model Guide](data-model-guide.md) | Summarizes current table families, tenant ownership conventions, and RLS expectations. |
| [RLS Permission System](rls-permission-system.md) | Documents Supabase RLS and permission enforcement. |
| [QA Testing Plan](QA_TESTING_PLAN.md) | Provides local/staging QA data and role-based test scenarios. |
| [Change Log](changelog.md) | Tracks notable project documentation and implementation changes. |

## Maintenance Rules

- Update relevant docs in the same change when architecture, schema, routes,
  modules, environment variables, or operational workflows change.
- Keep docs factual. Mark assumptions clearly and avoid describing unfinished
  business logic as implemented behavior.
- Keep multi-tenant rules visible: future business tables must include a tenant
  owner column, and the project rule prefers `company_id`.
- Treat QA seed examples as local/staging-only data. Do not copy those values
  into production behavior.
- Keep Markdown concise and scan-friendly for both humans and AI agents.
