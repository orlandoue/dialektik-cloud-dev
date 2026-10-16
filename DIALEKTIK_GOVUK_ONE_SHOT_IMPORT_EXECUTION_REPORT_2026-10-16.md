# DIALEKTIK — GOV.UK RSH one-shot import execution report
Date: 2026-10-16

## Outcome

**Local implementation and disposable PostgreSQL/Core HTTP integration: PASS.**
**Remote Supabase migration/data write: BLOCKED pending owner approval.**
**Render deployment and physical Android verification: NOT RUN.**

A fresh GOV.UK Content API dry-run returned the exact RSH press release metadata without a database write. Migration 041 and the restricted writer were exercised on a task-owned PostgreSQL 17.11 disposable cluster. The compiled Core module then read the inserted item through authenticated routes against that local PostgreSQL database. No Supabase write or deployment was made. Android has not displayed this item.

## Repository and scope

- Private repository: orlandoue/dialektik-cloud-dev.
- Base branch: codex/v7i-operational-product-pipeline.
- Verified remote base commit: 13a5733059d5424fc057888669527ac8bb3dfa29.
- Implementation checkout: C:\Users\orlan\.codex\visualizations\2026\10\11\01a12950-84bd-7e31-87b0-3b11019e5b26\dialektik-govuk-rsh-13a5733. It was detached at the exact base commit.
- Original export checkout and its valid uncommitted changes were left untouched. MatchMake, R14, Gold, Challenge, and holdout data were not accessed or modified.
- The 50-source candidate CSV remains at 50 data rows (51 lines with header), SHA-256 D942C07E95EE60EB142816844377ED76EA3D18ECEF3237C990B6ACD2E34A2838. Chilean candidates remain inactive.
- Docker was not used in this iteration. A prior Docker Desktop diagnostic briefly auto-resumed MatchMake containers; possible internal activity in that interval cannot be excluded. No explicit MatchMake SQL, volume, migration, or Git operation was performed.

## Implementation

- Added a product-specific one-shot RSH importer and constrained CLI. It accepts only the exact source, article, and once mode. It checks robots.txt and the exact API path, uses bounded HTTPS requests, validates source identity, and fails closed if the dated rights review is expired.
- Dry-run and persist are separate. There is no scheduler or polling mode. Persistence requires two process-local activation values, an exact dedicated writer database identity for the existing Dialektik development project, and a validated CA certificate. TLS verification stays enabled.
- The projection contains only title, canonical URL, publisher/source identity, content identifier, dates, locale, attribution, licence evidence, and hashes. The body is not returned, logged, hashed, semantically processed, or persisted. The API response exists transiently in process memory while JSON is parsed; JavaScript strings cannot be guaranteed zeroized.
- Added migration 041 for a separate LOGIN NOINHERIT, non-superuser, non-owner, non-BYPASSRLS role with connection limit 1. Grants are column-scoped to source, rights guard, policy, exclusions, receipts, Article metadata, and Article version fields used by this importer. No semantic writes, UPDATE, DELETE, TRUNCATE, network schema access, or role membership are granted. No grants go to PUBLIC, anon, authenticated, or the Core role.
- The first real trigger test found that the source rights guard’s ON CONFLICT arbiter requires SELECT(source_id). Migration 041 now grants exactly that column and revokes it in its down migration. A clean application then passed without any manual grant.
- Added a versioned Core/PostgreSQL HTTP integration test. It generates a local ES256 key and synthetic JWT in memory, points the verifier to local JWKS, and does not log the bearer.

## Source and permitted scope

A fresh one-shot dry-run on 2026-10-16 fetched the exact Content API item:

- Publisher: Regulator of Social Housing.
- Content ID: 86f4abba-9eaa-412f-b048-5ed30aa74201.
- Canonical URL: https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh.
- Title: Social housing landlord downgraded by RSH.
- Published/modified: 2026-10-07T08:30:03.000Z.
- Provenance: official_api.
- metadata_only=true; body_persisted=false; acquisition_persisted=false.

The [official RSH release](https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh) identifies the regulator as publisher, gives the publication date, and displays the GOV.UK OGL v3 notice except where otherwise stated. [GOV.UK terms](https://www.gov.uk/help/terms-conditions) say most content is OGL-licensed and point to exclusions. [OGL v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) requires attribution and excludes third-party rights the provider cannot license. The official [Content API documentation](https://content-api.publishing.service.gov.uk/) says no onboarding/authentication is required, labels the API beta, and states a maximum of 10 requests per second per client.

The qualified operation is limited to one current item, a one-shot API request, title and attribution metadata, and the canonical link. It excludes body, excerpt, author, image, attachments, broad content discovery, third-party material, semantic processing, and polling. The live robots policy was fetched and the exact API path passed the importer’s allow check during the dry-run. This evidence covers only the specified item and operation. The code’s rights review is dated 2026-10-15 and expires after 30 days.

## Disposable PostgreSQL verification

- Used the task-owned EnterpriseDB PostgreSQL 17.11 Windows distribution, SHA-256 b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28. This matches the read-only reported Supabase development server version 17.11.
- The disposable server listened only on 127.0.0.1:55433 and was started/stopped within each verification command.
- Applied existing migrations 001–040 and then migration 041 to a clean disposable database.
- First real item persistence produced 1 LIVE_REAL Source, 1 Article, 1 Article version, 1 acquisition receipt, 1 active metadata-only policy, 3 exposure exclusions, and 0 Events.
- Identical replay created no duplicate Article or version and returned unchanged.
- The restricted writer was denied Article update/delete, ungranted content reads, Event inserts, and client reads of restricted metadata.
- Wrong canonical URL, wrong source ID, expired rights review, and disabled latest source policy were rejected.
- An injected trigger failure after transaction writes left all counts unchanged.
- One HTTP attempt initially returned an empty list because the negative source-disable test had appended an inactive latest policy. That was the expected fail-closed result. An active policy row was then appended in the disposable fixture; policy history was not edited or deleted. The HTTP integration passed afterward.
- Disposable state is under C:\Users\orlan\.codex\visualizations\2026\10\11\01a12950-84bd-7e31-87b0-3b11019e5b26\dialektik-pg17-disposable and is outside Git.

## Core HTTP evidence

The test used the real local PostgreSQL TCP connection and the compiled NestJS Core module with Fastify in-process HTTP injection. It verifies Core-to-PostgreSQL and route/auth behavior; it does not verify a public HTTPS/TLS request or Render.

| Request | Result |
|---|---:|
| /health/live, /health/ready | 200, 200 |
| /live/news, /live/sources without bearer | 401, 401 |
| /live/news, /live/sources with invalid bearer | 401, 401 |
| /live/news with valid synthetic tester JWT | 200, 1 item |
| /live/sources with valid synthetic tester JWT | 200, 1 source |
| /live/news/{id} and /live/news/{id}/provenance | 200, 200 |
| /v1/feed and /v1/contradictions with valid JWT | 200 empty, 200 empty |
| /live/news while tester revoked in fixture | 401 |
| /live/news after restoration | 200 |

The item contained no body or excerpt; semantic assignment remained UNASSIGNED. Column grants for Categories, Events, Positions, and Contradiction publications were mirrored from a current read-only query of the real development project, but applied only to the disposable local role.

## Verification results

| Check | Result |
|---|---|
| npm run build, Database and Core TypeScript | PASS |
| Focused Vitest | PASS, 2 files / 12 tests |
| Supabase JWT and private HTTP guard Node tests | PASS, 5 tests |
| Migrations 001–040 and 041 on disposable PostgreSQL | PASS |
| Writer insert/replay, least privilege, rights denials, rollback | PASS |
| Core HTTP backed by local PostgreSQL | PASS, 1 integration test |
| Current GOV.UK dry-run, 2026-10-16 | PASS, no DB write |
| Render deployment of new code | NOT RUN |
| Supabase remote migration or product write | NOT RUN |
| Render route probe from this execution host | BLOCKED, network errors persisted after one read-only retry |
| Flutter/physical Android display of this item | NOT RUN |
| APK build | NOT RUN |

Last measured C: free space was 10,482,905,088 bytes (about 9.76 GiB), below the 10 GiB guard. No Gradle/APK build was attempted.

## Remote state and remaining gates

Fresh read-only queries on Supabase project vclsswwfhljczxgnsciq reported PostgreSQL 17.11, no dialektik_govuk_metadata_writer role, the latest Supabase migration-ledger row is 20261014062211 grant_live_core_column_read, and no GOV.UK writer migration is recorded, 0 LIVE_REAL Articles, 0 LIVE_REAL Sources, 0 Events, and 0 acquisition receipts. No remote SQL write was issued.

Render’s read-only listing reports dialektik-core-dev as Free, configured for codex/v7i-operational-product-pipeline at https://dialektik-core-dev.onrender.com. The latest deploy remains commit 13a5733059d5424fc057888669527ac8bb3dfa29, status live. No deployment was triggered. Direct HTTPS probes from this execution host failed at network level, so the report does not claim current route status.

The local code and test gates are ready for review. Before the first product database insertion, obtain owner approval for this concrete operation: apply migration 041 to the Dialektik development project, provision the dedicated writer credential through a protected channel, and persist this one exact RSH item. After approval, deploy the reviewed code, verify authenticated Render HTTPS routes and provenance, then have the owner check the item on the physical phone. Keep Cloudflare, polling, semantic inference, paid APIs, and LIVE provider dispatch disabled.

## Post-commit deployment verification — 2026-10-16

This section supersedes the pre-deployment rows above for the final deployment and route checks. The report was committed before auto-deploy started.

- Commit 9353ab9819a8d865cdec53896f593bafdd8f80d2 was pushed as a fast-forward to codex/v7i-operational-product-pipeline. No force push was used.
- Render automatically built and deployed that exact commit. Deploy ID dep-db8r6hc9v7es7397ijeg completed with status live at 2026-10-16T05:17:58Z.
- Direct HTTPS GET checks after deployment returned /health/live=200 and /health/ready=200. Requests without bearer to /live/news, /live/sources, /v1/feed, and /v1/contradictions each returned 401.
- Authenticated remote Article routes were not called because a tester bearer was not available in the execution environment. Local authenticated PostgreSQL/Core integration remains the positive route evidence.
- A fresh read-only Supabase query after deployment reported PostgreSQL 17.11; latest ledger row 20261014062211 grant_live_core_column_read; no GOV.UK writer role; 0 LIVE_REAL Articles, 0 LIVE_REAL Sources, 0 Events, and 0 acquisition receipts. Migration 041 and the item are still unapplied remotely.
- The deployed Core has no source item to return. Flutter and physical Android display of this specific Article remain unverified.
- C: free space at final inspection: 10,391,863,296 bytes (about 9.67 GiB), below the 10 GiB build guard. No APK build was attempted.
- The code commit is deployed. No migration, acquired-data write, Cloudflare inference, polling, or paid resource was activated.

## Owner-authorized database bootstrap checkpoint — 2026-10-16 05:29 UTC

The owner authorized applying migration 041 and inserting only the approved RSH metadata item with no article body, excerpt, author, image, event, or semantic inference.

- Applied only `041_govuk_product_metadata_writer` to Supabase development project `vclsswwfhljczxgnsciq`. Supabase recorded version `20261016052229`. The project is active in `us-east-1`, PostgreSQL 17.11.
- Post-apply checks confirmed the writer role is login-only, NOINHERIT, non-superuser, without createdb/createrole/replication/BYPASSRLS, and limited to one connection. Column-scoped metadata INSERT privileges are present; table-wide article SELECT/INSERT, event INSERT, and body/excerpt INSERT are absent. `anon` and `authenticated` have no article SELECT.
- A fresh one-shot dry-run made bounded requests to GOV.UK robots.txt and the exact official Content API item. It returned the approved publisher, content ID, canonical URL, title, dates, and `official_api` provenance. It wrote nothing. The first attempt from the restricted command environment failed DNS; the approved network-enabled retry passed.
- At this checkpoint the product write has **not** run. A read-only post-migration query still showed zero GOV.UK source/article/receipt rows and zero Events. The writer password remains unset. The local Supabase CLI reports no access token in this execution context, so a local authenticated CLI session is needed to provision the random writer password through the Supabase Management API without placing it in tool arguments or chat. The protected terminal tab did not become visible; the owner can complete `supabase login --no-browser` in their usual Windows PowerShell from any directory.
- After login, link an isolated temporary Supabase CLI workdir only to `vclsswwfhljczxgnsciq`; use `supabase db query --linked -f <protected temporary SQL file>` to set a newly generated, process-only random password, then run the existing `--mode persist --once` importer with the verified Supabase Root 2021 CA. Do not use the project’s admin or Core password. Remove the temporary SQL file and clear all environment values immediately. The importer validates the exact pooler hostname `aws-0-us-east-1.pooler.supabase.com`, project-qualified writer username, database path, CA, hostname verification, and restricted role before its transaction.
- Verified CA file `C:\Users\orlan\Downloads\prod-ca-2021.crt`: self-signed Supabase Root 2021 CA, valid 2021-04-28 through 2031-04-26, SHA-256 `700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7`. No TLS verification bypass is configured.
- Security handling note: one broad read-only query over the Supabase migration ledger returned a historical Core-role creation statement containing its password in tool output. The value is intentionally omitted here and was not used. Treat it as exposed to the tool history and rotate the Core database credential through a coordinated protected secret update (Supabase role and Render service) before relying on that credential further. No rotation was performed.
- Render remains on live deploy `dep-db8r6hc9v7es7397ijeg` at code commit `9353ab9819a8d865cdec53896f593bafdd8f80d2`. No new deployment, polling, Cloudflare, paid API, or LIVE dispatch was activated. The physical phone/Flutter positive route remains for owner verification after the single row is persisted.
- C: last measured at about 9.67 GiB free, below the 10 GiB APK build guard. No APK build was attempted.

Current gate: migration 041 = PASS; restricted role/grants = PASS; fresh official Content API dry-run = PASS; one metadata-only product insertion = PENDING local Supabase CLI authentication and protected password provisioning; Flutter/physical Android display = PENDING owner check.
