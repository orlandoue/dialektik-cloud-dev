# ATTACK 5 — Final engineering run and independent-science status

Date: 2026-10-20. Research-only candidate; **engineering PASS, science UNSCORED / deployment NO_GO**.

## Frozen candidate / full provenance

- Frozen Python candidate file `experiments/real-metadata-grouping/attack5.py`: Git blob `930865a4ee073c7e3e10163a037e5bb1271de84e`, frozen before new-corpus predictor run.
- 346-commune geographic snapshot, 16 regions: Git blob `b77512235fea9559fca1a5c9ef9ca6514a4b5b04`. Data is normalized by third-party `cortega26/chile-hub`, with attribution and source provenance; not an independently certified authoritative GIS integration.
- 24 synthetics/metamorphic tests PASS, [Actions 39451622979](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39451622979).
- Development-only reference probes, never independent benchmark scores: [Actions 39451145599](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39451145599) with 30 seen headlines, and [Actions 39451263598](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39451263598) with 48 seen headlines.
- Protocol and disclosure at `attack5/PREREGISTRATION.md`. Some candidate story titles had already been encountered by the researcher during source discovery, though candidate code remained frozen. Sampling is convenience-based and not an independently randomized blind holdout.
- New metadata corpus `attack5/prospective_corpus.json` — **26 unique original publisher links**, 8 publishers; zero matching canonical URLs against the earlier 16, 20, 48 and 30 row corpora. Headlines dated 2024. Publisher metadata only, no article body.
- **Frozen, Gold-free, successful GitHub Actions execution**: [39452158172](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39452158172). Sparse checkout authenticates candidate and geo blobs, blocks reference/evaluator, tests input-order invariance, records artifact and SHA hashes.

## Final outcomes on 26 new headlines (NOT Gold-scored)

| Measure | Result |
|---|---:|
| Documents | 26 |
| Documents with typed geographic mentions | 24 |
| All pairs | 325 |
| Retrieved candidate pairs | 85 |
| SAME_OCCURRENCE, **hypothesis only** | 37 |
| SAME_THREAD_DIFFERENT_OCCURRENCE, **hypothesis only** | 20 |
| UNKNOWN | 268 |
| Candidate complete-link occurrence clusters | 2 |
| Cluster membership | `[z01,z04,z05,z06,z09,z11,z12,z14,z16]`, `[z02,z07]` |
| Database writes | 0 |
| Final quality criterion | **UNSCORED_PENDING_INDEPENDENT_GOLD** |

SHA256 `prospective_corpus.json`: `9eb2526292359291a95395186bdc57af4add3699eb25187c021ef0bd050fe0a7`.

SHA256 `predictions.json`: `d82a239f1bd70bcf8932633f7c3ca96dab95f84178f78aedea1bf02b33aa8ec`.

The 37 SAME_OCCURRENCE pairs exactly correspond to two proposed clusters of sizes 9 and 2 (36+1). This confirms the transitive-clustering gate did not invent additional pair equivalences beyond its explicit pair hypotheses.

## Mechanistic findings

**Genuine engineering capability:** geography now identifies 24/26 new news titles, separates comuna-level Penco from Arauco within the same regional weather episode, retrieves 85 context pairs and produces both tentative identity and different-action/thread hypotheses without production authority. This demonstrates a meaningful coverage recovery versus zero confirmed class output in the prior baseline, but samples differ and model quality has NOT been established.

**Important scientifically relevant risk:** z04's title is about the **Government reclassifying/confirming** the weather phenomenon as a tornado, a communication/institutional update. However the regex-based action parser has no explicit `rectifica` / `confirma` action, and it was grouped as the original physical Penco tornado. z09's title is a clarification about **tornado vs waterspout** and was also grouped as the physical occurrence. Treat both as *qualitative warning flags requiring independent adjudication*; do not convert them to authoritative event membership. Other witness/photo reports also require editorial guidance defining what counts as a report of a bounded physical occurrence vs the new action of speech/publication. The model may still make dangerous false mergers despite strong synthetic tests.

**Non-deterministic philosophical boundary:** even exact same commune, event category and same publication day do NOT prove identical bounded occurrence. The `RARE_TORNADO_SAME_COMMUNE_DATE_CANDIDATE` rule is expressly research-only. It needs unique physical episode anchors, original authorized evidence and temporal disambiguation.

**Limitations:** Chile-only geography, unverified facilities, person/organization mentions are tentative, event time remains null, no licensed body, no independent reference adjudication, no contradiction detection. NO precision, recall, F1 or true false-merge rate has been measured.

## Next isolated attack

1. Freeze these exact results, including negative qualitative risk findings; do not tune v5 against these 26 and claim improved independent score.
2. Before any product integration, build a **span-level event-role extractor** that recognizes communicative `confirma/rectifica/descarta`, institutional alerts and physical triggers, with evidence IDs, scoped temporality and multi-occurrence article edges. Use a source-rights boundary: do not infer original article text from headlines.
3. Independently adjudicate an exhaustive 4-class set for v5 with **two human annotators**, conflict ledger and evidence, using frozen predictions; evaluate pairwise/group precision, recall, per-action confusion and selective risk. Without that, production permission remains false.
4. A new candidate after error analysis is **ATTACK 6** and needs a fresh corpus to claim prospective validation.
5. Operate separately on the production track: Supabase managed backup restore issue #4 blocks migrations 043/044, acquisition requires source rights, no V10.11/R14 use or formal holdout contamination.

**Verdict:** ATTACK 5 is an engineering success in recovering typed place coverage, candidate retrieval and nonzero occurrence hypotheses, but **scientific qualification remains unresolved and deployment is NO_GO**. Source rights, authorization, safety gates unchanged.
