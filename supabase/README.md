# Supabase

This folder contains Supabase configuration, migrations, seed files, and Edge
Functions for SolarWorkflows.

## Edge Functions

- `invite-epc-company-admin` sends Supabase Auth invite/setup emails for EPC
  company admins and handles super-admin workspace/admin status actions from a
  trusted service-role environment.

Deploy function secrets with server-only values. Do not expose the
`SUPABASE_SERVICE_ROLE_KEY` through frontend `VITE_` variables.
