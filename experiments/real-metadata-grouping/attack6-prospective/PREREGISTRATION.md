# DIALEKTIK — ATTACK 6 prospective real-metadata evaluation: preregistration

**Registered before collection and before any ATTACK-6 prediction on this corpus: 2026-10-20 (Chile).**
**Frozen source code** (never edit for this experiment):
- `experiments/real-metadata-grouping/attack6.py`: Git blob `7d0cccd8a1abdb33256eae05fab93817747e3855`.
- `experiments/real-metadata-grouping/attack6_roles.py`: Git blob `dd9b207e72d3fe4cc69de0d4020c3e5ef2363df4`.
- Frozen geography predecessor `attack5.py`: blob `930865a4ee073c7e3e10163a037e5bb1271de84e`.
- Chile geography `attack5/chile_geography.json`: blob `b77512235fea9559fca1a5c9ef9ca6514a4b5b04`.
- Source branch ancestor `b4be25c88762ebc0c62f78baa2913e64a4115900`. Tests 17/17 PASS in Actions 39454830231.
- Historical developer examples Penco/Arauco, and corpora with sizes 16+20+48+30, **are contaminated for new-corpus claims** and excluded by URL after selection.

## Sampling procedure fixed before collecting headlines

Select **24–36** accessible original publisher metadata records (headline, publication date, original HTTPS URL, publisher), from **at least 6** outlets if possible, among three *predetermined broad domains*, no other newly selected topic substitution without recorded amendment:

1. February 2024 Valparaíso / Viña del Mar / Quilpué major wildfires (multi-location fires, evacuations, reports, counts, official statements; distinguish separate bounded incidents vs common evolving crisis).
2. Early August 2025 El Teniente mining accident and rescue/investigation (different event kind currently outside v5 disaster lexicon; expects abstentions).
3. August 2023 south-central Chile flood event and aftermath (separate communes and temporal episodes, distinct updates).

Target >=7 article records in each broad category and >=2 negative/multi-event hard cases. Sample by *topic and source diversity*, NOT model predictions. **Convenience sample**, not random, representative, or sufficiently powered for production qualification. Include selection shortfalls and link-verification status, reject unverifiable dates, syndicated mirrors and repeated canonical URLs. Do not select based on ATTACK-6 output. Exact titles, dates, URLs must be supported by public source evidence, not invented. Source visibility != full-text acquisition or crawler license.

Only give the predictor the following keys for each record: `id`, `headline`, `canonical_url`, `published_on`, `publisher`. Corpus envelope `schema: public-real-metadata-only-v1`, `source_text_acquired: false`. Keep curation/source-verification log OUTSIDE predictor checkout.

## Evaluation protocol

1. Commit immutable model hashes and this pre-registration, THEN select and commit new corpus. Record candidate corpus digest, chronological log, exclusion checks.
2. Prediction job reads **only** candidate+gazetteer+metadata. Assert immutable Git blobs, no access to either independent annotation or scoring script, and permutation-invariance; save 4-class outputs with their exact SHA-256 to a retained artifact. No production writes.
3. Report raw counts for `SAME_OCCURRENCE`, `SAME_THREAD_DIFFERENT_OCCURRENCE`, `UNRELATED`, `UNKNOWN`; retrieved pairs, geographic coverage, abstention/cluster sizes and failure reasons. **No accuracy metrics without editorial Gold.**
4. Provide two *blank* reviewer packages with article URLs and all possible pair IDs, no predictions or prior labels. Each human reviewer separately records source evidence, primary action vs contextual mentions, event time (where supported), related thread, and 4-way label. Reconcile genuine disagreements; retain drafts and rationale. Do not pretend two blank packets or two model personas = independent human annotators.
5. A strict, *separate* scorer verifies corpus hash + completeness + reviewer provenance before computing confusion, pair P/R/F1, false merges/fragmentation, group purity, selective coverage/risk and stratified failures. Do not tune ATTACK-6 after label reveal; changed rules create ATTACK-7 with new corpus.
6. Critical safety gates: NO_GO if any unsupported automatic Event/Claim/contradiction assertion, zero useful coverage, impure proposed clusters, provenance failure, unauthorized source access or unresolved review identity. Exploratory necessary thresholds (not sufficient for production): zero independently adjudicated false occurrence merges, >=0.80 occurrence recall on scorable positives, >=0.50 selective coverage. Domain/mix may make such metrics uninformative; disclose uncertainty.

## Boundary

The model's primary-action tagging (e.g., an eyewitness describing a tornado) is a **documentary interpretation heuristic**, not a world-fact determination. A headline-level `SAME_THREAD_DIFFERENT_OCCURRENCE` is never authoritative without editorial evidence. Source temporal statements do not automatically determine event time. No web scraping/ingestion pipeline, Supabase #4 restore-gate bypass, migrations 043/044, Core write, Flutter/Render, R14 or formal V10.11/holdout. Deployment remains NO_GO.
