# Dialektik DEV — protected backup and restoration checkpoint (2026-10-19)

**Status: STAGED / REMOTE WRITES = NONE / BACKUP = NOT YET RUN / RESTORE = NOT VERIFIED.**

Target project `vclsswwfhljczxgnsciq`; exact session pooler username `postgres.vclsswwfhljczxgnsciq`, hostname `aws-0-us-east-1.pooler.supabase.com`, database `postgres`, port `5432`.

The owner has a working Android beta. DEV currently contains 50 historical Supabase ledger entries ending with migration 042; do not replay 001–042 or apply 043/044 as part of backup. It has one beta user, so dumps containing auth account data and password verifiers are **sensitive**, even if the Article tables are empty.

## Cloud pipeline prepared

Workflow: `.github/workflows/dev-protected-backup.yml`, branch `codex/dev-backup-restore-20261019` only. A routine push runs **tooling** without secrets or any remote connection. The protected backup job is deliberately skipped unless the exact HEAD commit message is `EXECUTE_PROTECTED_DEV_BACKUP_20261019`. Never merge this workflow into the Render autodeploy branch as a shortcut.

Backup job uses GitHub Environment `dialektik-dev-backup`. The owner must configure it independently, ideally restricting deployment branches to this isolated reviewed branch and requiring an approver if their plan supports approvals.

Add the following **Environment secrets**, NOT repository-wide variables. Never paste any into ChatGPT, Codex prompts, issues, pull requests, logs, README or client source:

1. `DIALEKTIK_DEV_BACKUP_DATABASE_URL`: an administrator-authorized **DEV session-pooler** PostgreSQL connection string, including the password, with `?sslmode=verify-full`. No URLs for a different project or localhost.
2. `DIALEKTIK_DEV_BACKUP_PASSPHRASE`: a freshly generated, cryptographically random passphrase of >=32 characters. Keep the identical passphrase in an independent owner-managed password vault. Losing it makes the encrypted backup unusable.
3. `DIALEKTIK_DEV_DATABASE_CA_PEM`: the official **DEV** PostgreSQL CA certificate from Supabase Database Settings → SSL Configuration. Its SHA-256 must be `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7` (previously reviewed). If the dashboard supplies a different genuine CA, stop and reconcile securely rather than disabling TLS verification.

The backup uses pinned Supabase CLI 2.120.0 and Docker on the hosted GitHub runner, exporting separate `roles.sql`, `schema.sql`, `data.sql` with Supabase-aware filtering. A GPG AES-256 encrypted `tar.gpg` file containing these and `SHA256SUMS` is the **only** uploaded artifact (7-day retention). The owner must download it and archive it in durable protected storage outside GitHub Actions. Plaintext files remain only on a short-lived runner and are deleted afterwards. The project has no managed daily backups on its Supabase Free plan.

**Caution**: Supabase CLI runs `pg_dump` inside a Docker container. The host-provided CA file may require explicit forwarding to that container; if hostname verification cannot be proven, the job must fail. Never change `verify-full` to `require` or `disable` to bypass an error.

## What remains AFTER the backup

An encrypted artifact or a successful `pg_dump` does **not** prove recoverability. Restore the **actual archived content** on a strictly isolated, disposable cloud Supabase-compatible PostgreSQL 17 environment, with roles, schema and data, including auth and migration ledger. Compare schema, counts, extension dependencies, and effective access policies (RLS/ACL); do not restore into DEV. Supabase Vault keys, Storage API objects, SMTP settings, auth providers, API keys, functions, and other platform-managed configuration may require independent recovery. Classify deviations and fail closed. Successful synthetic tests are not substitutes for this real restoration.

After full restoration PASS, coordinate a protected Core-credential transition in Supabase and Render, then re-check authenticated read operations in Core and the physical Flutter Android app. Require a separate exact-scope, owner-approved 043/044 deployment and one-shot GOV.UK persistence operation. Revoke any temporary DB backup credentials and clear CI secrets after the run.

## Human action required

The owner must provision the three Environment secrets via GitHub Settings → Environments → `dialektik-dev-backup`, with branch restrictions. Once ready, report **"backup cloud configurado"** without disclosing any credential. The authorized agent may then create the one explicitly named trigger commit, review the resulting job, and arrange the real restore rehearsal before any 043/044 apply.

## Execution checkpoint

2026-10-19 — Owner confirmed all three protected GitHub Environment secrets configured. Authorized read-only encrypted backup attempt. Never print secrets or move unencrypted data out of the ephemeral runner. The real restore remains separately gated.

2026-10-19 diagnostic retry: previous protected backup exited at secret validation before any database connection. Retry reports presence and passphrase-length categories only; all credential values remain withheld.

2026-10-19 — Owner updated the encrypted-backup passphrase in protected GitHub Environment and explicitly requested a retry. Protected execution remains restricted to this branch; no SQL migration, rotation, import or Render deployment is authorized by this checkpoint.

2026-10-19 — Read-only backup URL diagnostics retry: password-encryption secret and CA were present; DEV connection URI failed strict shape validation. This run emits only categorical mismatch codes, never the URI or credentials. On another failure, stop and obtain owner-side correction.

2026-10-19 — Owner corrected the database URL placeholder and encoded the dollar sign, and explicitly requested a repeat of the protected backup validation. Only a read-only encrypted backup is authorized; no migration, remote write, Render change or data import.

2026-10-19 — Owner confirmed the GitHub Environment DATABASE_URL now has the required `?sslmode=verify-full` suffix and explicitly requested revalidation. Execute only a read-only encrypted cloud backup; no migration, authentication change, or restore to production.

2026-10-19 — Backup URI format is now verified. Previous protected job stopped on byte-exact pinned CA SHA, before any PostgreSQL connection. This retry permits only CRLF/trailing-newline normalization against the identical hard-coded certificate SHA-256, otherwise fails closed with a nonsecret certificate-status code. No relaxed TLS validation or remote writes.

## Successful protected logical export (2026-10-19)

- Workflow run: https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39321170714 — completed SUCCESS.
- TLS target (DEV project, session-pooler identity, host, port, server PostgreSQL 17.11): PASS under verify-full, using pinned original CA after lossless LF final-newline normalization.
- Export: roles.sql, schema.sql, data.sql and SHA256SUMS generated by Supabase CLI 2.120.0 with no remote mutations.
- Encryption and upload: GPG AES256 PASS; only encrypted `dialektik-dev-backup.tar.gpg` uploaded.
- GitHub artifact: `dialektik-dev-encrypted-logical-backup`, ID `12218999587`; size 120604 bytes; artifact ZIP SHA256 `886ef3b66cb24b40114569dc60d84e26e1041cc03c569f985dde653f4fa88666` (as reported by upload-artifact).
- Expires: **2026-10-26 20:41:38 UTC** (7-day retention). OWNER MUST DOWNLOAD AND STORE encrypted ZIP separately; retain passphrase privately.
- **RESTORE NOT VERIFIED.** Content completeness for Supabase-managed auth/storage schemas, auth data, storage objects, migrations and ancillary platform configuration remains unproven. An isolated restoration rehearsal and data inventory are mandatory before enabling deployment gates.
- Remote 043/044: NOT APPLIED. Render Core: NOT CHANGED. DEV database contents: NOT MODIFIED.

## Isolated archive replay findings (2026-10-19)

- The real encrypted artifact from run 39321170714 decrypted successfully and all original dump-file SHA256 checks passed; temporary restore containers and plaintext were destroyed.
- Isolated replay workflow: .github/workflows/dev-restore-rehearsal.yml; no connection or changes to remote DEV.
- Original Supabase CLI logical archive does NOT include auth.users schema/data or supabase_migrations ledger, and cannot be treated as a full Supabase account/managed-platform backup.
- Vanilla PostgreSQL 17.11 replay encountered missing Supabase-managed roles and supabase_vault extension, which were not shipped in the vanilla container.
- Official supabase/postgres:17.6.1.173 replay progressed beyond the extension bootstrap but managed role grants and role settings are not portable to this isolated target without appropriate setup. Latest run 39327424915 failed closed on 'permission denied for parameter log_min_messages' during role restoration.
- Source archived SQL and checksums were not altered. An isolated test suppressed a specific documented cli_login_postgres grant ONLY in an ephemeral copy, but that statement was absent from the dump and did not solve the restore error.
- RESTORE_GATE=FAIL; auth and migration recovery unavailable. No remote migrations 043/044; no first real Article in Dialektik yet.
- Fast user-visible option is an explicitly labeled DEV-only read-only GOV.UK official content preview: does not authorize or substitute for durable metadata ingest, backup, migration or full restore.
- Required for full readiness: Supabase-managed-compatible isolated restore target, platform-role reconciliation retaining product ACL/RLS, protected additional coverage of Auth and migration ledger, credential transition and separately scoped one-shot import authorization.
