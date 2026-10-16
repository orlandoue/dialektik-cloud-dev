# GOV.UK RSH one-shot metadata import — controlled runbook

This is a one-item metadata-only product operation for the exact RSH press release qualified in the Dialektik source record. It is not a scheduler, poller, general GOV.UK connector, or scientific evaluation path.

## Preconditions

1. Review the code based on remote Dialektik commit 13a5733059d5424fc057888669527ac8bb3dfa29.
2. Review migration 041 and DIALEKTIK_GOVUK_ONE_SHOT_IMPORT_EXECUTION_REPORT_2026-10-16.md. The local PostgreSQL and Core HTTP checks passed on 2026-10-16.
3. Actual Dialektik Supabase development project: vclsswwfhljczxgnsciq. A fresh read-only query found migration 041 absent, no writer role, and zero LIVE_REAL Articles, Sources, Events, and receipts.
4. Never use production or scientific databases for migration testing. The disposable run used local PostgreSQL 17.11 at 127.0.0.1:55433.
5. Reconfirm the exact article, OGL page, third-party exclusions, robots policy, and attribution immediately before persistence. Rights review is dated 2026-10-15 and expires in 30 days.
6. Keep polling, Cloudflare, semantic processing, paid APIs, and LIVE provider dispatch disabled.

## Local verification completed

- npm run build: PASS.
- npm exec -- vitest run --config services/core-api/vitest.config.mts: PASS, 2 files and 12 tests.
- node --test services/core-api/test/private-beta-auth.test.mjs services/core-api/test/private-beta-http-guard.test.mjs: PASS, 5 tests.
- node --test services/core-api/test/govuk-product-postgres-http.integration.mjs: PASS against local real PostgreSQL. Compiled NestJS Core returned the metadata-only item and source with a synthetic JWT; no/invalid JWT were 401; tester revocation returned 401 and restoration returned 200.
- PostgreSQL applied migrations 001–040 and corrected 041 on the disposable database. Writer privilege, first insert, replay, denials, disabled source, and transaction rollback tests passed.

Disposable PG17 drivers are under C:\Users\orlan\.codex\visualizations\2026\10\11\01a12950-84bd-7e31-87b0-3b11019e5b26\dialektik-pg17-disposable, outside the repo. They only target its databases postgres and dialektik_govuk_final on port 55433. Never point them at Supabase or another database. The versioned HTTP test also requires DIALEKTIK_GOVUK_DISPOSABLE_CORE_DATABASE_URL to point at the local Core reader on 127.0.0.1:55433.

## Current GOV.UK dry-run

The one-shot dry-run passed on 2026-10-16. It fetched robots.txt and the exact Content API item, returning publisher, content identifier, canonical URL, title and dates with official_api provenance. It wrote nothing to PostgreSQL.

Command:
npm run acquire:govuk-rsh --workspace @dialektik/core-api -- --source govuk-rsh --mode dry-run --once

Repeat directly before any persistent operation because source data, terms, and robots rules can change.

## Migration and writer setup after owner approval

Do not run these steps until the owner approves the specific one-item write to the development database.

1. Apply reviewed migration 041 to project vclsswwfhljczxgnsciq through the approved migration workflow. Do not repair failures with ad-hoc grants.
2. Provision the dedicated role password through a protected local secret channel. Do not place it in code, shell history, chat, CI, logs, or an APK.
3. Supply the exact project-qualified writer URL and verified CA certificate via protected process environment. The CLI checks the Supabase host/pooler identity, database path, port, CA validity, and TLS hostname. Do not disable TLS checks.
4. Verify the writer identity and expected/forbidden privileges before insertion.

Persist mode requires both process-local values:
- DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED=true
- DIALEKTIK_GOVUK_RSH_PERSIST_CONFIRMATION=IMPORT_ONE_AUTHORIZED_GOVUK_RSH_ARTICLE

Command:
npm run acquire:govuk-rsh --workspace @dialektik/core-api -- --source govuk-rsh --mode persist --once

Clear both values immediately afterward. CLI accepts only the registered source and item; it has no polling mode.

## After persistence

1. Verify one Source, Article, Article version, receipt, and active metadata-only policy; three exclusions; zero Events. Confirm official_api provenance, publisher, canonical URL, dates, attribution, and metadata-only status.
2. Confirm no body, excerpt, author, image, attachment, event assignment, or semantic record was inserted.
3. Verify authenticated HTTPS for /live/news, /live/sources, /live/news/{id}, and /live/news/{id}/provenance. Confirm missing/invalid bearer requests return 401. Never request or record a bearer in chat.
4. Check Flutter rendering and the canonical publisher link. Core HTTP does not prove Android E2E; the owner must verify on the physical phone.
5. Do not build an APK while C: has less than 10 GiB free. Last measurement: about 9.76 GiB.

## Status at 2026-10-16

Local code, migration, disposable writer, and Core HTTP gates passed. Remote migration 041 and the product Article are absent. Render still reports commit 13a5733059d5424fc057888669527ac8bb3dfa29 as live. New code is not deployed. HTTPS probes from this execution host failed at network level. Flutter and physical Android display of this item have not been verified.

Next gate: owner approval for migration 041 and persistence of this exact one-item metadata record in the development database. Then deploy the reviewed code and complete HTTPS and physical Android verification.
