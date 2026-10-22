# DIALEKTIK — Metadata candidate staging for multi-source news

**Engineering increment: pre-write planning only (2026-10-20).**

## Product problem solved

Dialektik's existing Android private beta shows a real GOV.UK metadata preview and a real Chilean event **curated by people**. It does not yet autonomously store new Articles, generate Events, or identify verified contradictions. The user wants an expanding Chile-relevant feed.

The next pipeline must separate **(a) permission to acquire**, **(b) identity of original publisher item**, **(c) version/change of that item**, and **(d) subsequent semantic decisions**. Collapsing (b) and (d) would falsely group unrelated news or infer contradictions simply because two titles share words.

## New production-type function, explicitly OFFLINE

`services/core-api/src/live/rights-gated-metadata-stage.ts`: `planRightsGatedMetadata(policies, candidates, previous, at)`.

The function does not fetch, touch PostgreSQL, authenticate users or write any output beyond its returned deterministic plan. It accepts policy assertions **from an operator-controlled registry**, not from publishers' self-reported payloads. Do not treat `acquisitionApproved:true` as a substitute for legal review. Actual robots/rights must be independently verified and versioned.

Each candidate may contain ONLY:
- Publisher/source IDs and original item ID
- Exact HTTPS canonical URL on the approved source origin
- Source-authored headline, publication timestamp and optional later modification timestamp

For each approved source it enforces:
- Explicit, still-current source rights and metadata retention approval
- Exact bounded HTTPS source origin, external hostname and separate rights-evidence URL
- Explicit robots permission for planned route with timestamp within 30 days
- Limit on items per batch; total 60 across eight policies maximum
- No query strings, fragments, redirect resolution, credentials or cross-origin canonical substitutions
- Canonical date, headline control-character and length checks
- Unique source-item identity and URL (fail closed, no silent mutation)
- SHA-256 stable identity key and a different SHA-256 metadata-version hash
- `NEW` / `UPDATED` / `UNCHANGED` status against supplied prior-state tuples (no DB updates performed)

**Even with two differently named publishers covering identically worded titles, no occurrence relationship is inferred.** All outputs explicitly set `realWorldOccurrenceInferred:false`, `eventsGenerated:false`, `contradictionsGenerated:false`, `writesAuthorized:false`, `publicReleaseAuthority:false`.

**The two publisher policies in the test are entirely synthetic reserved `.example` sources. They are NOT approved media or actual connectors.** This is an engineering precondition for connecting genuinely approved publishers later, not a source discovery or licensing milestone.

## Wiring plan after prerequisites

1. Verify at least two rights-cleared independent Chile-relevant sources with access/licensing evidence, provenance and rate limits; register policy out-of-band. GOV.UK RSH currently has only a fixed seven-URL allowlist; SENAPRED is an unapproved candidate.
2. Implement adapters with real HTTP/robots/rights checks and bounded discovery for newly published items, returning this minimal candidate shape. Acquisition receipts should record source policy version, HTTP/robots decision, timestamp and source ETag if available. No body copying without explicit rights.
3. Once **RESTORE-GATE #4** proves real Auth/app/migration recovery and owner approves scoped migration 043/044, persist receipts and Articles through dedicated least-privilege writer; run DB-level unique constraints/idempotence/concurrent upsert and rollback tests. This pure planner is NOT that writer.
4. Expose new, stored Articles on the existing Core/Flutter path with explicit `acquired_at`, original link and publisher attribution, then confirm app/feed SQL matches.
5. Keep semantic linking as separately adjudicated candidate relationship (`SAME_OCCURRENCE` vs `SAME_THREAD_DIFFERENT_OCCURRENCE` vs `UNRELATED` vs `UNKNOWN`). Human-reviewed Gold must show a low false-merge rate on new unseen Chilean news. Do NOT emit an Event, much less a contradiction, from title similarity.
6. Only with later evidence and product controls may the UI change from editorial preview to live autonomous grouped Events; preserve an audit trail and correction process.

## Validation and release contract

GitHub workflow `.github/workflows/rights-gated-metadata-stage-ci.yml` compiles the actual Core and runs standalone Vitest tests plus preexisting GOV.UK/Chile preview tests, without credentials or DB connectivity. Negative tests cover stale rights, permission denial, unapproved source, fake canonical domains, query tracking, duplicate identity, modified URL, date errors, publisher corrections, unchanged replay and false occurrence inference.

**No remote schema/roles/RLS edits, no app deploy, no direct authorisation to market as autonomous news clustering or fact checking.**

## Cross-links

- [RESTORE-GATE #4](https://github.com/orlandoue/dialektik-cloud-dev/issues/4)
- [Autonomous multisource integration #6](https://github.com/orlandoue/dialektik-cloud-dev/issues/6)
- [PR #10 Recovery](https://github.com/orlandoue/dialektik-cloud-dev/pull/10)
- [PR #11 Beta release gates](https://github.com/orlandoue/dialektik-cloud-dev/pull/11)
- [PR #13 Flutter editorial evidence UX](https://github.com/orlandoue/dialektik-cloud-dev/pull/13)

## Definition of done for this PR

`npm run build` PASS, all rights staging Vitest tests PASS, existing GOV.UK/Chile preview tests PASS, no network requests and no DB writers in module; PR remains draft until owner reviews integration route.
