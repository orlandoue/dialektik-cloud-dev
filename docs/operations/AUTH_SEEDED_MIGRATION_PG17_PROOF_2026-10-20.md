# DiaIektik — verified PG17 synthetic 82-version migration duplicate and conditional replay, 20 October 2026

## Status

**SYNTHETIC_DUPLICATE_AND_RECOVERY=PASS. AUTHENTIC_ENCRYPTED_ARCHIVE_RESTORE=NOT_VERIFIED. RESTORE-GATE #4=NO_GO.**

Evidence: [GitHub Actions 39532575005 — PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39532575005), a disposable PostgreSQL **17.11** container launched without a network, with no production database credentials or genuine Auth rows.

### What the CI actually proved

1. Created an entirely synthetic `auth` schema with the **same 27 table names** as the source backup inventory. All user/identity/session tables were intentionally empty, with simplified fake schemas. `auth.schema_migrations` contained 82 invented, non-sensitive versions.
2. Exported this disposable database using the **actual `pg_dump -Fc --data-only`** command and captured its `pg_restore --list` (TOC).
3. Restoring only the already-seeded Auth migrations back into the same database with a single-transaction pg_restore produced the expected **duplicate unique-key failure**. No table data was changed because the restore transaction rolled back.
4. `filter_auth_migration_toc.py`, gated by the justified equality of source/target versions (the dump came from **the identical disposable database**), commented out **exactly one** `auth.schema_migrations` TABLE DATA entry and preserved the other **26**.
5. Replaying this derived TOC succeeded with `pg_restore --single-transaction --exit-on-error`. Final ledger: 82 entries; synthetic users/identities: zero. The original custom-format source dump was never modified; any logs were deleted with the disposable container.
6. No live Supabase DEV calls, no actual backup decryption, no Core/Flutter deployments, and no remote migrations/writer actions.

### What this does NOT prove

- The real encrypted archive's 82 Auth migration versions have **not** been verified to match the local seeded target. Live database and local development instance were already proven to match with [run 39525820724](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39525820724), but that is not a substitute for inspecting ciphertext contents in a protected runner.
- The real `RESTORE_MANAGED_AUTH_DATA=FAIL_REDACTED` from [run 39524164491](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39524164491) has **not** been categorized as an actual duplicate-key violation. This is a **mechanism demonstrated on synthetic data**, not an authenticated root-cause report.
- Schema simplification in this unit rehearsal does not prove complete restoration of real Auth rows, foreign keys, user sessions, migrations application ledger 50, RLS/ACL, or Core API login.

### Correct next stage

1. A strictly authorized protected runner must decrypt the original artifact **only after** validating network isolation and checksum identity. Restore **only the original Auth migration ledger** into a separate scratch target, compare all 82 versions by deterministic digest and count against the isolated target; expose hashes/counts only.
2. If those match exactly, use the same one-entry TOC exclusion for the other 26 authentic Auth table-data entries. Otherwise fail closed and reconcile the target Auth schema/version using Supabase-supported paths.
3. Classify any new pg_restore errors without printing raw SQL/rows; do not skip independent constraints or replay partial data.
4. Restore the application ledger of 50 versions and app data, verify roles/ACL/RLS+Auth/Core login, and prove backup point-in-time consistency and rollback.
5. Obtain owner approval for actual database release only after a verified independent RESTORE-GATE PASS. Until then: no 043/044 or dedicated metadata writer activation.

The separate, longer full-Supabase seeded-replay [run 39532119388](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39532119388) failed for an unspecified pg_restore invocation reason and is **not used as pass evidence**. The fast pure-PostgreSQL test above is the only proven TOC skip demonstration.

Original encrypted backup [artifact 12295491516](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488529000/artifacts/12295491516) expires **2026-10-27**. Secure an offsite ciphertext copy with separate passphrase custody.
