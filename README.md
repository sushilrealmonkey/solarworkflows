# SolarWorkflows

SolarWorkflows is a multi-tenant SaaS foundation for solar installation business management. Realmonkey will manage multiple client companies with separate users, permissions, domains, documents, inventory, projects, invoices, and reports.

This repository currently contains only the project foundation. Database schema, authentication flows, tenant business logic, and inventory logic are intentionally not implemented yet.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- React Router

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Add Supabase project values to `.env` when backend work begins:

   ```bash
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Build for production:

   ```bash
   npm run build
   ```

## Project Structure

```text
src/
  app/          App wiring, routes, navigation, route guards
  components/   Shared UI components
  layouts/      Page shells and navigation layouts
  modules/      Feature modules and placeholder pages
  services/     External service clients
  hooks/        Shared React hooks
  utils/        Shared utilities
  types/        Shared TypeScript types
  config/       Runtime configuration
supabase/       Supabase project files when backend work starts
docs/           Product and engineering notes
```

## Current Scope

- React + TypeScript + Vite setup
- Tailwind CSS setup
- React Router setup
- Mobile-first dashboard shell
- Mobile bottom navigation
- Desktop sidebar navigation
- Placeholder protected route wrapper
- Placeholder pages for initial platform areas

No database schema, auth logic, inventory logic, or tenant business rules have been added in this foundation task.
