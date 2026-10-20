# DIALEKTIK — RESTORE-GATE Auth + migration-ledger recovery audit, 20 October 2026

## Verdict

**SYNTHETIC_OFFLINE_DATA_RESTORE_PASS; REAL_MANAGED_BACKUP_CAPTURE_BLOCKED_BEFORE_RUNNER; FULL_RESTORE_NO_GO.**

This is an incremental hardening package, **not** a signed production recovery gate.

## Previously established facts

- Running Supabase DEV `vclsswwfhljczxgnsciq`, PostgreSQL 17.11.0.003, state ACTIVE_HEALTHY. Live auth.users=1; migration ledger=50 records; Article/Event/Source/receipts/version records remain empty; ledger ends at 042.
- The previous encrypted snapshot [39321170714](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39321170714) had roles, normal app schema and data, but omitted managed Auth and `supabase_migrations` history, so it **could not** independently recover all state.
- The previous isolated replay [39327424915](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39327424915) failed on `permission denied for parameter log_min_messages`. Do **not** remedy by granting superuser rights or modifying live roles.
- Official Supabase docs require explicit migration history export and distinguish Supabase-managed Auth schema customizations from its platform-owned internals. See `https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore` and `https://supabase.com/docs/guides/platform/backups`.

## Improvements actually completed

1. Added `scripts/operations/managed_backup_inventory.py`, which parses **native `pg_restore --list`** output and refuses success unless it finds Auth users, identities, sessions, refresh tokens, and separately `supabase_migrations.schema_migrations` as **TABLE DATA** entries. It rejects wrong schemas and mixed archives, records SHA-256s, and never prints sensitive rows.
2. Added narrowly scoped isolated-restoration SQL sanitation: only literal standalone `SET log_min_messages = warning|notice|error;` is eligible for dropping **in a derived restore copy**, preserving original source bytes and all privilege/DDL statements. This does **not yet prove** that the previous encrypted archive is replayable.
3. Built synthetic Postgres 17.11 native custom-dump and actual isolated restore of FIVE fake managed tables, including a basic RLS preservation check. [10/10 unit tests and synthetic restore PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488058126). No real account or production database accessed by this test.
4. Added `.github/workflows/dev-managed-backup-capture.yml`, explicitly triggered only by owner-intended exact commit message, using existing protected `dialektik-dev-backup` GitHub environment, SSL `verify-full` and pinned CA SHA-256, exact DEV project user, pinned CLI v2.120.0, Postgres 17.11 pg_dump. It creates standard app roles/schema/data PLUS separate Auth and migration-ledger **custom-format data archives**, verifies critical table inventories, and uploads ONLY a GPG AES256 encrypted bundle for short retention. All plaintext is confined to ephemeral runner and erased after.
5. **Attempted the guarded real backup:** [Actions 39488529000](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488529000) resulted in FAILURE **before any runner started** (job has no steps and no runner ID; job logs unavailable). No exported Auth archive was produced. Whether GitHub environment deployment branch restrictions or some other repository policy caused the pre-run failure needs an owner settings check; **do not assert cause without evidence**.
6. Replicated the protected capture workflow and its independent inventory script to the already used `codex/dev-backup-restore-20261019` branch, preserving its previous execution commit hashes. The exact-message commit `c56348c6a5422ee2c10e1bc979a2f3b2ae851662` was created, but no new workflow run has been observed for it. We cannot count it as a backup.

## Security-sensitive outstanding steps

**Gate 1 — GitHub protected execution:** Owner checks repository *Settings → Environments → dialektik-dev-backup*, branch deployment policies, required approvals and runtime availability. Re-run ONLY on an explicitly allowed branch; do not disable environment protection and do not paste the database URL, root certificate or passphrase into a chat. If the job still fails before runner, inspect GitHub Actions workflow history/restriction messages and do not claim capture.

**Gate 2 — complete real snapshot coverage:** Protected job must PASS, supply encrypted app + Auth + ledger archive and a manifest. Validate the tables listed above and tally against read-only source metadata. Strong consistency across multiple independent dump commands (live concurrent writes) is NOT established; for production recovery require an approved consistent snapshot/backup method or a maintenance window; a collection of separate `pg_dump` exports by itself is not guaranteed to be transactionally atomic.

**Gate 3 — real artifact isolated restore:** Replay real ciphertext in an offline disposable **Supabase-compatible PostgreSQL 17.11.0.003 environment**, ideally actual Supabase restore-to-another-project mechanism when owner accepts separate costs. Reconcile managed roles, extensions and Auth schema in the TARGET only. Test recovered Auth record counts/identities, complete 50-version ledger, product table data, RLS/ACL, restricted writer, and Core authentication compatibility. Do not bring recovered Auth users to an internet-exposed throwaway database or publish plaintext artifacts.

**Gate 4 — credentials rotation:** Rehearse dedicated Core role cutover with no outage; writer `dialektik_govuk_metadata_writer` currently NOLOGIN by design and must not be enabled before Gate 1–3 and owner authorization.

**Gate 5 — separate deployment consent:** Only after gates above PASS, owner authorizes precisely scoped migrations 043/044 and the first metadata-only writer. Never replay/alter historical 001–042.

## Summary

GitHub engineering/recovery checks have materially advanced, but the **real encrypted complete backup and real isolated restore are not yet verified**. `RESTORE-GATE #4` stays OPEN. No remote SQL modifications, migrations, role grants, authenticated user exports or Art/Event writes were performed in this work. The existing Android/Core private-beta remains unaffected.
