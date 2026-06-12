-- Development/testing only.
-- The previous QA workflow dataset was retired.
--
-- Required opt-in:
--   psql "$DATABASE_URL" -v qa_seed_confirmed=1 -f supabase/seed.qa.sql
--
-- This file intentionally does not seed customers, leads, quotations,
-- inventory, vendors, purchases, invoices, payments, documents, notifications,
-- or test users. Use the app UI to create tenant data for workflow testing.

\if :{?qa_seed_confirmed}
\else
\echo 'Refusing to run QA seed. Re-run with: -v qa_seed_confirmed=1'
\quit 1
\endif

\set ON_ERROR_STOP on

begin;

do $$
begin
  raise notice 'QA seed is retired. No dummy operational data was inserted.';
end $$;

commit;
