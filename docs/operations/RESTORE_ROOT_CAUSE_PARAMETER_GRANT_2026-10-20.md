# Dialektik — root cause of protected role-replay failure (2026-10-20)

## Verified, minimally disclosed evidence

- Real encrypted DEV snapshot from [GitHub Actions 39488529000](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488529000) was valid, authenticated and verifiably intact.
- [First protected restore 39508817203](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39508817203), [second 39513726092](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39513726092), [third 39520980961](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39520980961) and [logging-only sandbox trial 39521852417](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39521852417) all STOPPED at `RESTORE_APPLICATION_ROLES`, before any real Auth row/ledger import. All runs completed isolated-network and plaintext-cleanup checks.
- Restricted logs identified `PARAMETER_PERMISSION`, specifically `LOG_MIN_MESSAGES`.
- Exact ciphertext-only **non-identifying** diagnostics:
  - [39522485422](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39522485422): ONE `log_min_messages` mention in the original roles dump, not a plain role/session/database SET.
  - [39522731762](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39522731762): parameter quoted as a SQL identifier, line contains `SET`, no `ALTER ROLE` and not a standalone session `SET`.
  - [39522913239](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39522913239): not an `ALTER DATABASE` or `ALTER SYSTEM`.
  - [39523095416](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39523095416): **EXACT security-relevant grammar `GRANT SET ON PARAMETER "log_min_messages"`**. Grantee identity and original source SQL remain PRIVATE.
- The logging SET sanitizer correctly matched ZERO source statements and did NOT strip the GRANT; do NOT alter it to skip or downgrade parameter permissions.
- Supabase source has 27 Auth tables verified by inventory (not yet restored); 50 migration ledger rows expected based on source read-only observation; app schema remains pending target replay.

## Correct remedy class

PostgreSQL `GRANT SET ON PARAMETER` is a **privilege assignment**, not a client logging preference; it cannot be silently removed without diverging from the source security contract. Reconcile roles via the target's authorized administrative role **in disposable Supabase only**, then compare role memberships, login/superuser flags, parameter privileges and RLS/ACL against source evidence. This is not permission to grant elevated privileges in live DEV or to bypass safety checks.

Currently evaluating disposable `supabase_admin` vs `postgres` authority for a synthetic `NOLOGIN` grantee with the same `GRANT SET ON PARAMETER` grammar. Zero source Auth data or credentials are used in that test.

## Hold and authorization

`RESTORE-GATE #4=OPEN`: no valid authentic data restore has occurred. Keep writer NOLOGIN, migrations 043/044 disabled and Auth/semantic ingestion untouched. No Render/Flutter change; app's existing preview continues operating.

Artifact `12295491516` from the genuine encrypted backup expires **2026-10-27T20:20:08Z**. Preserve ciphertext offsite with separate private key/passphrase custody before expiration.

A role-grant compatibility test in disposable local Supabase must PASS before authorizing another protected authentic replay. A successful database restore would still need Auth/Core login and broader ACL/RLS acceptance; never claim RESTORE-GATE success merely because `pg_restore` exits 0.
