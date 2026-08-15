-- =============================================================================
-- LOCAL DEVELOPMENT ONLY - NON-PRODUCTION PLACEHOLDERS, NOT CREDENTIALS
-- =============================================================================
-- `supabase db reset --local` loads this file before repository migrations.
-- These deliberately unusable values only let already-applied worker-scheduling
-- migrations replay without changing their historical SQL. The closed loopback
-- URL cannot reach a Supabase worker, and the worker secret is not a real secret.
--
-- NEVER run a linked or production command with `--include-roles`.
-- NEVER copy these placeholder values into a hosted project's Vault.
-- Production database deployment must omit `--include-roles`.

select vault.create_secret(
  'http://127.0.0.1:1/local-reset-placeholder',
  'notification_worker_project_url',
  'LOCAL-ONLY PLACEHOLDER - NOT A PRODUCTION WORKER URL'
)
where not exists (
  select 1
  from vault.decrypted_secrets
  where name = 'notification_worker_project_url'
);

select vault.create_secret(
  'LOCAL_ONLY_PLACEHOLDER_NOT_A_REAL_SECRET',
  'notification_worker_secret',
  'LOCAL-ONLY PLACEHOLDER - NOT A PRODUCTION CREDENTIAL'
)
where not exists (
  select 1
  from vault.decrypted_secrets
  where name = 'notification_worker_secret'
);
