# Deployment Log

## 2026-08-15 — Phase 1 pre-deployment database backup gate

- Gate status: **PASS**
- Production project: `solarworkflows`
- Backup timestamp: `2026-08-15T06:09:19Z`
- External backup directory: `C:\Users\sushi\SolarWorkflows-Production-Backups\20260815T060919Z`
- Repository separation: verified; the backup directory resolves outside this repository.
- Deployment status: not performed as part of this backup-verification task.

The backup was created with Supabase CLI `2.104.0` using the documented
separate roles, schema, and data logical-dump procedure. All three dump
commands returned exit status `0`. Each file exists, is non-zero, and retained
the same SHA-256 checksum after the restore test.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `roles.sql` | 297 | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `schema.sql` | 1,024,085 | `cca6f53783bc00e0aa150177e25b566b0556b487e1af099c82c99f5b55ee51c2` |
| `data.sql` | 15,265,066 | `b4204b6969974aa4cdc2ae9e8a650add73520e1492c28cca2985776394302096` |

Content verification found 86 application tables in the `public` schema and
115 data-copy sections across `auth`, `public`, and `storage`. Expected tables
confirmed in both schema and data were `companies`, `profiles`,
`company_subscriptions`, and `trial_signup_notification_outbox`.

Restore verification: **PASS**. The exact checksummed files were restored with
`ON_ERROR_STOP` in a single transaction to a disposable local Supabase
Postgres 17 environment after initializing compatible Auth and Storage system
schemas. The restore command returned exit status `0`; the disposable
container was removed after verification.

Basic restored-data checks:

- 34 Auth users, 17 companies, 25 profiles, and 17 company subscriptions.
- All 6 trial outbox rows restored, all 6 with `sent` status.
- Zero missing-company references in profiles, company subscriptions, or the
  trial outbox.
- All 6 expected application/system relations were present.
- The one intentionally `NOT VALID` application check constraint successfully
  validated inside a rolled-back probe transaction.

The external directory also contains `SHA256SUMS.txt` and
`restore-verification.json`. The logical database backup contains Storage
metadata but not the underlying Storage API object files.

Procedure references:

- [Supabase: Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups)

## 2026-08-15 - Phase 1 production deployment execution

- Execution status: **PASS**
- Completed at: `2026-08-15T08:48:19Z`
- Production project: `solarworkflows` (`fwfybfabwfhleetfgjjy`)
- Restore point: `20260815T060919Z`
- Backup restore verification: **PASS**
- Backup checksums:
  - `roles.sql`: `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd`
  - `schema.sql`: `cca6f53783bc00e0aa150177e25b566b0556b487e1af099c82c99f5b55ee51c2`
  - `data.sql`: `b4204b6969974aa4cdc2ae9e8a650add73520e1492c28cca2985776394302096`

Fresh Phase 1 preflight was captured at `2026-08-15T08:09:10Z`, after the
backup timestamp. The linked project matched production; the two approved
commits were present in order; unrelated working-tree files remained unstaged;
and the clean-snapshot migration dry-run returned exit status `0` with exactly:

1. `20260813170828_add_phone_signup_whatsapp_welcome.sql`
2. `20260813171743_wake_existing_whatsapp_campaign_after_limit_increase.sql`
3. `20260813174400_add_trial_welcome_email_delivery.sql`
4. `20260814103140_add_company_onboarding_progress.sql`

Preflight production state was clean: 17 companies; zero WhatsApp wake
candidate companies/campaigns; zero tenant-notification backlog; zero trial
outbox backlog with all 6 trial rows `sent`; zero active
`self_create_epc_workspace` calls; four expected active one-minute crons; and
authenticated `public` schema usage enabled.

Deployment sequence:

1. Deployed `process-trial-signups` from the clean commit snapshot; production
   Edge Function version is `5` (`ACTIVE`).
2. Entered effective maintenance mode by removing `public` schema usage from
   `PUBLIC`, `anon`, and `authenticated`, while retaining service access.
3. Unscheduling used `cron.unschedule`; the mobile-push cron remained active.
4. Applied the four migrations above in the dry-run order. A subsequent dry
   run reported the remote database up to date, and the final migration list
   matched local history through `20260814103140`.
5. Reconfirmed required function secrets and Vault worker values were present.
6. Ran post-migration database/RLS/RPC validation while maintenance remained
   active. Security and performance advisors returned zero error-severity
   findings; existing warning-severity findings were not introduced by this
   release.
7. Restored `public` schema usage for application roles and verified `anon`,
   `authenticated`, and `service_role` access.
8. Restored the three captured one-minute cron definitions with
   `cron.schedule` and verified all four production worker crons active.
9. Published approved commits `f09986e` then `267a9c4` to `origin/master`.
   Production advanced to `267a9c40e02d1290cd879ea567c71ad309a6cce5`.
10. Railway replaced the live frontend asset with `index-DBdda_0L.js`; the
    asset returned HTTP 200 and contains the approved onboarding welcome and
    onboarding RPC code. The production login page loaded without browser
    console errors.

Post-deployment validation captured at `2026-08-15T08:40:26Z`:

- All expected migrations are applied and local/remote histories match.
- Company count remains 17. All 17 companies have onboarding progress at
  `completed` / `ready`; zero companies are missing progress.
- Tenant notification backlog: 0 (`read`: 2).
- WhatsApp reply-alert backlog: 0 (`cancelled`: 1, `read`: 4).
- Trial outbox backlog: 0; all 6 `platform_alert` rows remain `sent`.
- Active `self_create_epc_workspace` calls: 0. Both signatures exist; the
  four-argument function is executable by `authenticated` and not by `anon`.
- All 7 expected onboarding/self-service RPC signatures exist; onboarding RLS
  is enabled.
- All four worker crons are active on `* * * * *`; each latest run at
  `2026-08-15T08:40:00Z` succeeded.
- Authenticated production smoke test passed: QA sign-in, active profile read,
  exactly one RLS-visible assigned tenant organization, matching company
  ownership, and `get_current_company_onboarding_progress` returned
  `completed` / `ready`.
- Unrelated working-tree changes remained unstaged throughout deployment.
