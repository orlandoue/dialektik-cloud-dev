# Dialektik DEV — read-only restore and acquisition preflight, 2026-10-20

**Scope:** project `dialektik-dev`, Supabase project ref `vclsswwfhljczxgnsciq`, PostgreSQL 17.11. Audited with the **connected Supabase tool using SELECT-only SQL and migration/table metadata**. No database/roles/migrations/backups modified. No Auth PII exported.

## Current actual remote state (NOT a restore test)

| Item | Observed |
|---|---|
| Supabase project status | ACTIVE_HEALTHY |
| DB major version | 17.11 |
| `auth.users` exists / rows | yes / 1 |
| `supabase_migrations.schema_migrations` exists / rows | yes / 50 |
| Latest migration name | `042_govuk_product_writer_row_scope` |
| Migration 043 or 044 | **absent** |
| `public.articles` | 0 |
| `public.events` | 0 |
| `public.sources` | 0 |
| `public.live_acquisition_receipts` | 0 |
| `public.live_article_versions` | 0 |

### Restrictive writer-role readiness — read-only PG role observation

| Role | Can login | INHERIT | BYPASSRLS | SUPERUSER |
|---|---|---|---|---|
| `dialektik_core_app` | YES | NO | NO | NO |
| `dialektik_core_app_rot_20261016` | **NO** | NO | NO | NO |
| `dialektik_govuk_metadata_writer` | **NO** | NO | NO | NO |

`NOLOGIN` on the dedicated metadata writer is an intentional current fail-closed barrier. **Do not unlock it merely because Core/APK previews work.** Dedicated role rotation/hot swap has not been verified by this audit.

## Known disaster-recovery deficit (open issue #4)

Existing encrypted archive from [backup run 39321170714](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39321170714) passed encryption/TLS checks, but its Supabase CLI export omitted managed Auth users and `supabase_migrations` ledger. [Isolated rehearsal 39327424915](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39327424915) encountered permission error on platform parameter `log_min_messages`. Therefore **the presence of these objects LIVE does not prove that the backup can recover them.**

Before writing first remote source/article:
1. Owner obtains and retains a **tested, appropriately encrypted, access-controlled backup** that includes the necessary managed Auth tables/identities and migration ledger **and application data**. Use Supabase-supported recovery mechanism with explicit coverage tests; do not store cleartext or credentials in GitHub artifacts.
2. Run destructive restoration ONLY in isolated disposable infrastructure built to match the current Supabase Postgres/extension/role environment; reconcile managed roles and platform parameter settings *without altering immutable source backup bytes*. Verify restored Auth row count, ledger count+versions, schema inventory, application data, RLS/ACL, restricted writer role and app authentication.
3. Owner records restoration proof and offsite backup retention. Rehearse Core role rotation **without downtime** separately; never elevate the existing Core service.
4. Only after all are PASS and owner explicitly approves, apply authorized scoped 043/044 exactly once with migration integrity protection. Never replay/patch 001–042 on live.
5. Enable metadata-only GOV.UK writer using a dedicated role with SQL capabilities individually reaudited, signed acquisition receipts, idempotency, and independently verified rollback. Initial source count remains ONE until a second source's rights are documented.

## Safe increment implemented on parallel code branch

`codex/govuk-bounded-metadata-watch-20261020` includes a **read-only allowlist recheck** of up to 7 approved original GOV.UK RSH Content API items, with live robots/rights/identity checks, stable SHA256 metadata digest and expiring encrypted-by-GitHub transport artifact. No DB access/secrets. Engineering run [39484501019](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39484501019) **PASS**, 7 items, Core compile + 3 Node contract and 11 Vitest tests. This is **not** new-URL discovery, autonomous Event creation or PostgreSQL persistence.

Scheduled polling is **NOT ACTIVE** from the feature branch: GitHub only runs `schedule` on the repository default branch. It also requires owner-set `DIALEKTIK_GOVUK_READONLY_WATCH_ENABLED=true` after review. Prevent hidden perpetual network access or uncontrolled source crawling.

## Owner decision boundary

- Continuing the existing Android/Core beta previews: **ALLOWED / already shown**.
- Rechecking seven approved GOV.UK titles without DB write in Actions: **ENGINEERING PASS; operator must explicitly activate schedule**.
- Remote migration 043/044, enabling NOLOGIN writer, autonomous persistent acquisition, production event generation: **NO_GO** until RESTORE-GATE and per-source license/security prerequisites.
- ATTACK-7 evidence graphs/contradictions have no verified scientific Gold, and cannot confer production semantic authority.

No Supabase data mutation, no Render action, no Flutter build/deployment in this preflight.
