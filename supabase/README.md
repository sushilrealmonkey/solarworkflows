# Supabase

This folder contains Supabase configuration, migrations, seed files, and Edge
Functions for SolarWorkflows.

## Edge Functions

- `invite-epc-company-admin` sends Supabase Auth invite emails for EPC company
  admins from a trusted service-role environment.

Deploy function secrets with server-only values. Do not expose the
`SUPABASE_SERVICE_ROLE_KEY` through frontend `VITE_` variables.
