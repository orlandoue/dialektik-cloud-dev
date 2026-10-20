# DIALEKTIK — Operational completion ledger (2026-10-20)

## Actual product baseline: NOT a greenfield pilot

- Cloud Core source: `orlandoue/dialektik-cloud-dev`, deployment branch `codex/v7i-operational-product-pipeline` (base `6d4cbebadfcf8bc5136d1f3b274ee9ecdc6a0a9d`).
- Existing Android Flutter DEV app, authenticated private-beta and APK compiled through GitHub Actions. Verified [Flutter Cloud Pilot run 39347447334](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39347447334) (successful APK artifact).
- `GET /live/preview/govuk`: up to seven real, original, official GOV.UK RSH items; Content API/robots/rights verification, metadata only, live upon request, no SQL. This is one publisher, not an autonomous 2-source ingest.
- `GET /live/preview/events/chile-tornado`: October 13, 2026 Estación Central example with five publications (four independent newsrooms, one primary government statement), selected and linked editorially; `persisted=false`, `semantic_engine_executed=false`.
- Public `/live/news` and source endpoints exist in Core. The curated previews are NOT acquired Article records and are not autonomous persisted Event records.
- Research ATTACKs 1–7 were developed in separate experimental branches, not silently deployed. ATTACK-7 is a metadata-only, unvalidated graph of article-local evidence, not a full event-identity resolver.

## This branch: tangible additive integration (no production authority)

- New private beta endpoint **`GET /live/preview/events/chile-tornado/evidence-shadow`**, guarded by existing beta auth, with two feature toggles `DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED=true` and `DIALEKTIK_EVIDENCE_SHADOW_ENABLED=true` PLUS `DIALEKTIK_EVIDENCE_SHADOW_DEPLOYMENT=dev` and an explicitly configured `SUPABASE_AUTH_ISSUER=https://vclsswwfhljczxgnsciq.supabase.co/auth/v1`. The DEV Render process legitimately uses `NODE_ENV=production`, which must not be used as the DEV/production-deployment distinguisher.
- Same five original vetted editorial publications; exact headline-bound citation offsets for confirmation/rescue/damage-assessment/physical phenomenon cues.
- Explicitly labels editorial provenance separate from machine-extracted lexical cues; supplies article, documentary cue nodes and edges, but **no new occurrence assignment**, world-action verification, event timestamp, claim, contradiction, source body, Article/Events migration or DB write.
- No Flutter code change or runtime deployment implied. Preserve original API responses and operational flags; beta Android should continue to show existing content unchanged.
- Core build/test CI checks both the new endpoint and the existing Chile/GOV.UK previews.
- Do NOT label this bridge as a full ATTACK-7 inference integration: it is a deliberately constrained **Core projection contract**, suitable as an API stepping stone.

## Outstanding go/no-go gates — ordered by dependencies

| Gate | Status on 2026-10-20 | Exact proof required before marking PASS |
|---|---|---|
| Existing Android APK / beta auth / Core preview | Previously demonstrated | Regression CI and one Android installation/smoke replay after deploy |
| Chile evidence shadow bridge | This branch, CI pending at authoring | Core TS build and protected-route tests PASS, owner-reviewed gated rollout |
| Restore Gate [#4](https://github.com/orlandoue/dialektik-cloud-dev/issues/4) | OPEN/BLOCKING persistence | Encrypted comprehensive backup incl. managed Auth/migration ledger; successful disposable Supabase PG17 restore with ACL/RLS; tested credential-role rotation; owner approval |
| Source permission ledger | ONE specific GOV.UK official RSH read-only acquisition approved for existing preview; curated Chile links are not acquisition permissions | Second legally/technically approved independent publisher/source, exact rights + robots, permitted metadata and frequency |
| Automated DEV acquisition | NOT independently proven E2E | Bounded scheduled receipts for 2 distinct sources; idempotent retries, dedup, stop switch, audit, freshness/latency; no body-by-default |
| Article persistence | BLOCKED by #4 | Scoped migrations 043/044 independently owner-approved after recovery, dedicated least privilege writer and rollback verified |
| Event grouping | Editorial preview exists, scientific candidate unqualified | Real independent Gold/negative controls and source-backed merging in shadow; no forced UNKNOWN resolution; safe bounded Event materialization only after sign-off |
| Claims/contradictions | NOT OPERATIVE | Attribution (actor, proposition, unit, entity, temporal scope), evidence links, adverse source independence checks, genuine contradiction vs updates; allow EMPTY cards |
| Flutter end-to-end autonomous | Curated app screens and APK exists | Same APK flow displays persisted metadata and audited generated vs reviewed distinctions; capture reproducible real Android video/screenshots |
| Scalability | Not yet validated | Measured throughput, lag, API p95, DB load, failure/retry/dead-letter, false-merge review, cost/unit, gradual load, rollback |

## Decision

Do **not** rebuild the pilot; extend the existing Core and Flutter surfaces.

Next work unit after this branch CI:
1. Finish backup restoration issue #4 without touching live remote ledger 001–042.
2. Finish source-rights registry for **exactly two** independent sources; GOV.UK RSH is one authorized preview source, not permission for indefinite multi-source crawling.
3. Implement daily/on-demand bounded **nonpersistent** acquisition receipts in DEV, inspect provenance, then enable scoped Article persistence only after owner-authorized restore/migrations.
4. Integrate typed evidence shadow with the actual Articles feed, but avoid making an automatic occurrence identity/contradiction assertion before independent quality gates.
5. Change Flutter presentation on its **existing** cloud pilot branch to show provenance and `REVIEW_REQUIRED` vs `HUMAN_REVIEWED` only after the API response and signed test contracts stabilize.

## Safety isolation

No new remote Supabase migration or SQL, no unapproved source collector, no R14 holdout or formal V10.11 inference, no Android release upload, no irreversible deployment. The goal is steady verifiable product integration without retroactively rewriting research outcomes.
