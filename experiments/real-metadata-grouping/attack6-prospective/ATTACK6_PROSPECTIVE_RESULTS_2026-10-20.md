# DIALEKTIK — ATTACK 6 prospective real-metadata evaluation: final execution report

**Date:** 2026-10-20. **Scientific and deployment gate: NO_GO_ZERO_COVERAGE.**
**Engineering workflow PASS, pairwise scientific metrics NOT MEASURED.**

## Freeze and sequence

1. Exact **pre-registration before article selection**: commit `1f624eaaf1d3c35158c12b780b580ab7873ebbed` in this branch.
2. Immutable frozen candidate blobs:
   - `attack6.py` `7d0cccd8a1abdb33256eae05fab93817747e3855`
   - `attack6_roles.py` `dd9b207e72d3fe4cc69de0d4020c3e5ef2363df4`
   - predecessor `attack5.py` `930865a4ee073c7e3e10163a037e5bb1271de84e`
   - geography `attack5/chile_geography.json` `b77512235fea9559fca1a5c9ef9ca6514a4b5b04`.
3. **31 newly selected indexed original-publication metadata titles**, source list in `corpus.json`; explicit provenance/status in `collection_evidence.json`. Six distinct publishers, across three *preselected* domains: 11 February-2024 Valparaíso fires, 10 August-2025 El Teniente reports, 10 August-2023 floods.
4. Unique normalized URLs checked against all five preceding corpus packages (sizes 16, 20, 48, 30, 26): **zero duplicates**. No live acquisition permission inferred. Corpus is a convenience sample, not representative or blindly editorially labeled.
5. Gold-free sparse checkout authenticated frozen blobs; generated and sealed predictions in [GitHub Actions 39465297394](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39465297394), **SUCCESS**. It did NOT have labels or scoring code; input-order invariance checked.
6. Separate Gold-free diagnosis on exact frozen digest, [GitHub Actions 39465582634](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39465582634), **SUCCESS**. Neither tool nor model was modified after sample inspection.

## Authenticated metrics (metadata-only; no editorial Gold)

| Measure | Value |
|---|---:|
| Input publications | 31 |
| Publisher count | 6 |
| Candidate article pairs | 465 |
| Retrieved pairs | 20 |
| Articles with typed geography | 20 |
| SAME_OCCURRENCE predictions | **0** |
| SAME_THREAD_DIFFERENT_OCCURRENCE predictions | **0** |
| UNRELATED predictions | **0** |
| UNKNOWN predictions | **465** |
| Positive candidate groups | **0** |
| Independent human annotations | **0** |
| Database/Events/Claims writes | **0** |

Corpus SHA-256: `a999efe12709fdf38354bb3e17a8350bbfe8996dd3789f2458c89a3451006105`

Frozen prediction SHA-256: `b2912cfe7882102a45fd380df444136ca6aa609bf21abcaabd328d5af95bfe57`

### Blind, post-prediction root-cause by predefined source stratum

| Domain (articles) | Geo mentions found | Articles primary role UNKNOWN | Pair retrievals within domain |
|---|---:|---:|---:|
| February 2024 wildfire aftermath (11) | 11 | 9 | 19/55 |
| August 2025 El Teniente (10) | 0 | 9 | 0/45 |
| August 2023 floods (10) | 9 | 9 | 1/45 |

Other pairs: 320 inter-domain, 0 retrieved. Across all articles, **27/31 primary roles UNKNOWN**; role coverage only **4/31**. A source title's plural `incendios`, flood `desborde`/`sistema frontal`, and mine `derrumbe`/`rescate` vocabulary are inconsistently modeled by the frozen `attack6_roles.py` patterns and the earlier physical-hazard ontology. The model also lacks a typed location for a facility such as `El Teniente`, while `El Teniente` itself is not a Chilean comuna. The gazetteer should not pretend it is.

This is an **expressivity and entity-typing failure**, not evidence that any pair is actually unrelated. The algorithm abstained from all pair relationships; a zero false-positive count cannot be asserted without independently verified Gold. Headline-level `CORRECTION` or `CONFIRMATION` may occur without text directly declaring the original physical event as the article's primary action. Reported change of casualty estimate by update time must not be mistaken for contradiction: the corpus includes government/SML reports published at different dates and hours.

## Human independent evaluation package

A separate sparse GitHub job, without the predictor, generated two **BLANK** reviewer packets, each containing 31 public source metadata records, 465 all-pairs entries and explicit fields for primary action, context mentions, event-time evidence, four-way label, source evidence and UNKNOWN rationale.

- [Download genuinely blank reviewer A/B JSON workbooks](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39465297394/artifacts/12284397187)
- [Download frozen predicted results/manifest](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39465297394/artifacts/12284427150)

Both workflow artifacts expire under the 30-day retention set by GitHub Actions, approximately 2026-11-19. **No human reviewers have been recruited or impersonated; Gold and scorer execution remain absent.** The reviewer packets must be filled by separate, genuine reviewers with source rights and conflict reconciliation. Human assessments of this now-exposed test corpus may diagnose v6 but must not be reused for a new prospective v7 after tuning.

## Disposition

**Engineering CI PASS** for reproducibility, frozen candidate authentication, Gold isolation and packet preparation.

**Scientific NO_GO_ZERO_COVERAGE** on this convenience sample before any independent pair labels. No precision/recall/F1 or contradiction quality can be measured. New generic role capabilities on the same set would constitute *development* and require a sixth fully untouched source sample for prospective science.

**Product DEPLOY_NO_GO.** No Supabase migrations 043/044, no #4 restore gate bypass, no Article/Event/Claim persistence, no Render/Flutter changes, no formal V10.11 source-text inference and no R14 final holdout access.

## Next candidate — ATTACK 7, not executed by this report

Stop adding small isolated keyword patches. Build a **typed occurrence-role evidence graph** with:

- lexical + entity-resolution stages that recognize verified physical places, **named facilities** such as mines, and administrative jurisdictions without conflating them;
- compositional ACTION/ROLE classification for physical incidents, institutional announcements, aftereffects, casualty balances, rescues and investigations;
- separate metadata `published_on`, **observation/as-of time** for each updated numeric claim, and source-supported bounded event time;
- article-to-multiple-occurrence `MENTIONS` graph with primary vs contextual evidence; claims retain attributed source, speaker, time and uncertainty;
- semantic candidate retrieval followed by conservative verifiers, including hard negatives on same place/date with different causes, different casualty-report timestamps, historical accidents referred to retrospectively, and multi-location disasters;
- no automated contradiction claim unless same proposition, entity, temporal scope, incompatible polarity/value and reliable evidence across independently attributable sources can be demonstrated. Even then shadow/manual review first;
- rights-first full-source text only when licensed/authorized, otherwise metadata-only and abstain;
- before freezing v7, design a *new* source sample excluding all past six test sets, plus two genuinely independent humans for editorial Gold.

This engineering report closes ATTACK-6 prospective at a safe NO_GO and does not authorize automated ingestion.
