# DIALEKTIK — First real protected Supabase restore attempt, 2026-10-20

## Observed result

**RESTORE-GATE #4 remains NO_GO.** Owner manually authorized precisely commit `353cecf415f1946f7d190aee5d379862d3d92fa0`, message `APPROVE_REAL_SUPABASE_OFFLINE_RESTORE_20261020`, modifying exactly one comment line of the protected workflow.

[GitHub Actions run 39508817203](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39508817203), conclusion **FAIL** at `RESTORE_APPLICATION_ROLES`.

Evidence from the redacted console (no source Auth data printed):

| Control | Result |
|---|---|
| Disposable full local Supabase / empty ledger init | PASS |
| Stop other local containers; disconnect DB from all Docker networks | PASS |
| Fetch exact GitHub encrypted backup run 39488529000 | PASS |
| GPG decrypt in protected ephemeral runner | PASS |
| SHA-256 integrity for roles/schema/data/Auth/ledger | PASS |
| 27 Auth table names from source archive present in isolated target catalog | PASS |
| Restore application roles | **FAIL_REDACTED** |
| Restore application schema | NOT EXECUTED |
| Restore 27 Auth table records | NOT EXECUTED |
| Restore 50 migration ledger entries | NOT EXECUTED |
| Restore application data | NOT EXECUTED |
| Cleanup ephemeral real plaintext and networkless DB container | PASS |
| SQL changes in live DEV | ZERO |

Crucially, even though decryption, hash validation and table-name checks passed, this is **NOT** a successful restore and proves neither column-level type compatibility, real Auth row restoration, idempotence, RLS/ACL nor Core login compatibility.

**Root cause is not yet determined**: the protected workflow suppressed raw `psql` errors deliberately. A duplicate managed PostgreSQL role, insufficient privilege, SQL dialect issue or another role DDL conflict could explain it, but no individual cause is verified. Do not mark role conflicts as resolved, remove statements, broaden privileges, or disable checks.

## Safe next diagnostic

On the research branch, a **fixed taxonomy** classifier has been added to the protected role phase: it only prints one of `EXISTING_ROLE_COLLISION`, `MISSING_DEPENDENT_ROLE`, `PARAMETER_PERMISSION`, `INSUFFICIENT_PRIVILEGE`, `DUPLICATE_OBJECT`, `MISSING_DEPENDENCY`, `INVALID_CONFIGURATION`, `SYNTAX_ERROR`, `CLIENT_CONNECTION`, `UNKNOWN_SQL_FAILURE`, `UNKNOWN_NON_SQL_FAILURE`, `NO_REDACTED_LOG_CAPTURED`, or `MULTIPLE_INCOMPATIBLE_CATEGORIES`. It does not print role names, SQL, lines, source contents, user IDs or secrets. [18 synthetic unit tests and static checks passed, CI 39509544100](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39509544100).

Another real-data replay **requires new explicit owner authorization**, using the protected workflow's exact commit-message gate. No automatic rerun was initiated. Evaluate the resulting error classification before designing any privilege-preserving role reconciliation. Keep the original snapshot ciphertext untouched.

## Data preservation

GitHub encrypted artifact `12295491516` expires 2026-10-27T20:20:08Z. Owner should ensure a secure separate copy of ciphertext and protect the passphrase; do NOT export Auth plaintext to chat, GitHub PR, logging or unencrypted artifacts.

No remote migration 043/044, no writer LOGIN enablement, no changing the existing APK or deployed Core. Continuous new-source ingestion and autonomous event/contradiction publication remain blocked.
