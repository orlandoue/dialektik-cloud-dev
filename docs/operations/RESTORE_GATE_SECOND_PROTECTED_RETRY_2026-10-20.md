# DIALEKTIK — Protected retry 2: redacted parameter-permission finding

**2026-10-20. Decision: RESTORE-GATE #4 remains NO_GO.**

The owner authorized commit `50c53490aa448a14e17bfe0272e87469328202b3` with exact message
`APPROVE_REAL_SUPABASE_OFFLINE_RESTORE_20261020`, touching only one YAML comment.
The [protected GitHub run 39513726092](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39513726092) completed **FAIL**, but safely.

| Stage | Verified result |
|---|---|
| Disposable local Supabase + empty migration ledger | PASS |
| Stop non-DB services; disconnect database from networks | PASS |
| Download exact ciphertext original | PASS |
| Protected GPG decrypt | PASS |
| SHA-256 for all source backup components | PASS |
| Match 27 Auth archived table names against target names | PASS |
| Execute `roles.safe.sql` in disposable PostgreSQL | **FAIL** |
| Sanitized failure taxonomy | **PARAMETER_PERMISSION** |
| Restore user Auth records / 50 original migrations | NOT RUN |
| Disposable plaintext/container cleanup | PASS |
| Live Supabase DEV writes | **0** |

**What this does and does not prove:** The failure is a denied PostgreSQL configuration-parameter operation in the roles replay. It does **not** yet identify the exact parameter nor whether the denial comes from top-level `SET`, `ALTER ROLE SET`, or another approved script statement. Prior separate replay had observed a denial involving `log_min_messages`, but that is NOT independently confirmed for this specific run. Do not grant superuser, remove role definitions or circumvent privileges.

A third run must not be assumed authorized by the prior commit. New owner approval is required to decrypt original bytes again. The corrected protected diagnostic additionally reports only a **fixed allowlisted GUC identifier** (for example `LOG_MIN_MESSAGES` or `NON_ALLOWLISTED_PARAMETER`), never raw error, SQL, role names or parameter values. New unit tests and shell contract [GitHub Actions 39514346531](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39514346531) **PASS**: 10 inventory tests, 2 ciphertext archive tests, 10 redaction/parameter tests; no real auth bytes consumed by tests.

**Next conditional step**: after owner authorization, use the third result to identify the exact parameter category; inspect only a small, authorized **derived copy** of role restore statements inside protected runner. Do not blindly strip security-relevant grants/ROLE attributes. Original encrypted archive must remain unchanged. A reconciliation plan may allow harmless session-level settings to be excluded only after narrowly grounded evidence and tests; recreate missing app-specific roles and verified ACL/RLS separately if necessary.

**Backup preservation**: ciphertext artifact `12295491516` expires 2026-10-27T20:20:08Z. The owner must keep a secure encrypted copy beyond GitHub retention; never expose Auth plaintext or passphrase in issues.

Still NO GO for migrations 043/044, dedicated writer LOGIN, autonomous Article/Event writes, contradiction publication, and formal R14/V10.11 evaluations. Current APK/Core/GOV.UK curated previews stay unaffected.
