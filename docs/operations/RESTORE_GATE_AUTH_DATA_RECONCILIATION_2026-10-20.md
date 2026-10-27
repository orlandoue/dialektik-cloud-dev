# DIALEKTIK — Controlled Auth restore reconciliation: data-stage diagnosis, 2026-10-20

## Verdict

**ENGINEERING_PASS_FOR_ROLE_AND_SCHEMA / AUTH_DATA_REPLAY_FAIL / RESTORE-GATE #4 OPEN.**

This is a read-only source-catalog and disposable-target investigation. It does NOT claim actual Auth user restoration, application migration recovery, or successful Core login.

## Actual source-backed evidence

- [Protected ciphertext replay 39524164491](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39524164491): exact source GPG decrypt, SHA-256, 27 Auth archive table-name compatibility, all offline isolation checks PASS. **RESTORE_APPLICATION_ROLES=PASS**, **RESTORE_PRIVILEGED_PARAMETER_GRANT=PASS**, **RESTORE_APPLICATION_SCHEMA=PASS**. **RESTORE_MANAGED_AUTH_DATA=FAIL_REDACTED**. Migration-50 data and application-data replay were NOT reached. Ephemeral plaintext/container cleanup PASS, live DEV DB changes = 0.
- Independent read-only source query (no row data exported) identified **27 Auth tables**; 82 rows of Auth's own `auth.schema_migrations`, 1 Auth user, 1 identity and 5 sessions. The **application** ledger `supabase_migrations.schema_migrations` has 50 entries, separate from Auth's ledger.
- [Synthetic/local catalog CI 39525384549](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39525384549): 27/27 Auth tables match **all ordered column names, types, nullability and defaults** by structural metadata fingerprints; no missing tables and zero column-count/fingerprint mismatches. Local Auth starts with **82** internal migration rows and no users, identities or sessions.
- [Source/local version-set CI 39525820724](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39525820724): source *live* Auth's 82 sorted version strings and local Auth's 82 version strings have the same deterministic MD5 fingerprint. This proves exact equality of those two sets **at audit time**, not of the encrypted backup's Auth migration content.
- The actual data restore still fails before any Auth rows become usable. **Duplicate seeded Auth migration versions are a strong, but NOT YET PROVEN, explanation**: the protected run has only `FAIL_REDACTED` for the data stage, without a categorized data error. Never claim the archival cause as verified until the protected diagnostics confirm it.

## Implemented protective contract (not applied to real source)

- `scripts/operations/filter_auth_migration_toc.py` makes an explicit, bounded pg_restore list derived from a synthetic 27-TABLE-DATA Auth TOC: it can comment out **exactly one `auth.schema_migrations` TABLE DATA** line while preserving all 26 others, with source bytes unchanged.
- It requires a separate caller assertion `--version-sets-confirmed-identical`; **that boolean alone is not proof** and must only be supplied after independent archive/source-versus-target equality checks.
- Synthetic fail-closed tests ensure wrong schema, missing/duplicate entries and changed unrelated TOC lines cannot be treated as pass. [Static security tests CI 39526444924](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39526444924) **PASS**.
- The production/protected real-replay script has **NOT** been changed to omit any Auth TABLE DATA or bypass any pg_restore error.

## Exact next acceptance test requiring protected operator

1. In an approved **networkless, fully initialized disposable local Supabase** create a separate throwaway scratch database with a structurally matching Auth migration table. Restore **only** `auth.schema_migrations` from the authentic custom-format source archive there (no need to export usernames or session bodies).
2. Compare the actual **backup-archived 82 version values** against the target Auth local version values (count AND ordered cryptographic fingerprint) while all data remains in the isolated runner. Fail immediately if not identical; no silently trusted live-source query as a substitute.
3. If, and only if, identical, use the derived `pg_restore --use-list` TOC excluding exactly that seeded table to restore the **other 26 Auth data tables** in an isolated transaction, retaining full constraints and rejecting any new schema/foreign-key/unique-key or version errors.
4. Separately restore and check the application's **50 migration ledger rows** and application data; validate role attributes, parameter privileges, RLS, grants/ACL, 1 Auth user, 1 identity, 5 sessions and expected data counts. Run a distinct Core/Auth API login compatibility test without exposing secrets.
5. The earlier backup consisted of multiple `pg_dump` operations: **cross-dump transactional snapshot consistency remains unproven**. Restore-gate signoff also requires a consistent-backup/maintenance-window strategy and an owner-approved tested rollback.
6. Only then does RESTORE-GATE #4 become eligible for an independent PASS and a **separate** explicit 043/044/writer activation release decision.

## Current execution restriction

An attempted new protected real-backup replay was **blocked by the platform's security controls before creating a GitHub commit/run**. That safeguard was not bypassed. All post-block work here involved read-only Supabase SQL, synthetic/test GitHub Actions, and versioned code/documentation. A newly authorized, separately controlled protected operation would be required to handle real Auth backup bytes again.

Do **not** publish decrypted Auth data or SQL secrets, alter the live DEV role permissions, empty/delete Auth's 82 seeded migration entries, bypass `pg_restore` errors, or characterize the existing APK curated previews as autonomous database ingestion.

## Backup retention

Original ciphertext [artifact 12295491516](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488529000/artifacts/12295491516), expires **2026-10-27T20:20:08Z**. Owner must retain a secure ciphertext copy outside GitHub; keep GPG passphrase separately and private.

**NO LIVE DEV MUTATIONS; NO 043/044; NO WRITER LOGIN; NO RENDER OR FLUTTER DEPLOYMENT.**
