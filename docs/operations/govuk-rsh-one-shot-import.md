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

Owner approval for this specific one-item write was received on 2026-10-16. Migration 041 has since been applied once to the development project. Do not apply it again.

1. Authenticate the local Supabase CLI in the owner's visible PowerShell (`supabase login --no-browser`) and link only a disposable CLI workdir to project vclsswwfhljczxgnsciq. Do not run `db push`.
2. Generate a random dedicated writer password locally and set it using `supabase db query --linked -f <protected temporary SQL file>`. Do not place the password in code, shell history, chat, CI, logs, or an APK.
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

## Status before owner authorization — 2026-10-16

Local code, migration, disposable writer, and Core HTTP gates passed. Remote migration 041 and the product Article are absent. Render still reports commit 13a5733059d5424fc057888669527ac8bb3dfa29 as live. New code is not deployed. HTTPS probes from this execution host failed at network level. Flutter and physical Android display of this item have not been verified.

This status was superseded by the authorized bootstrap checkpoint below.

## Latest deployment verification — 2026-10-16

Render deploy dep-db8r6hc9v7es7397ijeg is live at commit 9353ab9819a8d865cdec53896f593bafdd8f80d2. Public health routes returned 200; /live/news, /live/sources, /v1/feed, and /v1/contradictions returned 401 without a bearer. No authenticated remote route call was made in this check.

At that time, a fresh read-only Supabase query showed the writer role and migration 041 absent, with zero LIVE_REAL Articles/Sources, Events, and receipts. Therefore the authenticated remote Article and Android gates remained pending the owner-approved one-item write. C: had about 9.67 GiB free, below the APK build guard.

## Current authorized bootstrap checkpoint — 2026-10-16 05:29 UTC

- Migration `041_govuk_product_metadata_writer` applied to `vclsswwfhljczxgnsciq`, Supabase ledger version `20261016052229`.
- Role flags and column-scoped rights were verified. It can insert approved metadata fields, cannot perform table-wide article reads/writes, cannot insert Events or excerpts, and has no administrative attributes. `anon` and `authenticated` have no article SELECT.
- Fresh official API/robots dry-run passed for the exact approved RSH item and wrote nothing. The restricted sandbox attempt first failed DNS; the network-enabled read-only retry passed.
- The single product record has not yet been persisted. The writer password remains unset because the current execution context lacks a Supabase CLI access token and its integrated terminal could not be opened. Complete `supabase login --no-browser` from the owner's visible PowerShell; do not send its code in chat. Then provision the random writer password via the protected CLI workflow above and run the importer exactly once.
- The provided `prod-ca-2021.crt` was validated as Supabase Root 2021 CA, valid 2021-04-28 through 2031-04-26, SHA-256 `700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7`. Hostname/TLS verification remains required.
- A broad read-only migration-history query returned a historical Core role creation statement containing its password in tool output. Its value is not recorded here or reused. Treat it as exposed to tool history; rotate through coordinated protected Supabase/Render secret updates. No rotation was performed.
- Render deploy `dep-db8r6hc9v7es7397ijeg` remains live at `9353ab9819a8d865cdec53896f593bafdd8f80d2`. No new deploy, polling, Cloudflare, paid service, or semantic inference ran. The owner still must verify Flutter on the physical phone after persistence.
- C: last measured ~9.67 GiB free, below the APK build guard; no Android build was run.
