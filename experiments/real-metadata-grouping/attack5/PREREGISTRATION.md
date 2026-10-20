# ATTACK 5 — frozen candidate and new-source experiment protocol (2026-10-20)

## Candidate freeze BEFORE writing new testing corpus

- Frozen candidate implementation commit: `e7a5e258068fd878222e98e76c5609d0c23877e2`.
- `attack5.py` final **blob**: `930865a4ee073c7e3e10163a037e5bb1271de84e`.
- Geography snapshot blob: `b77512235fea9559fca1a5c9ef9ca6514a4b5b04`.
- Candidate unit tests commit `a2f8d5d11872f0b05763a43ed9f2231647967262`; 24/24 PASS [GitHub Actions 39451622979](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39451622979).
- Prior 16, 20, 48 and 30-source corpora have been seen during development; exact URLs from each are excluded from new sample. Reuse for diagnostic only, never independent science.
- The researcher has already viewed some public titles about the June 18, 2024 Penco/Arauco wind events during exploratory source search. That makes sampling partly informed, even though the candidate implementation was frozen before selecting the test corpus; **DO NOT claim a fully pre-search, random or blinded sampling protocol**.

## Candidate scope

- Offline, third-party-snapshot-based 346-commune Chile gazetteer, 16 regions, with explicit commune vs region entity paths.
- Mentions of PERSON and ORGANIZATION are orthographic **unverified** candidates and official positions are role tags; none is a verified person/company ID.
- `FACILITY_MENTION_UNVERIFIED` is a headline string, not a registry entry or uniquely geocoded venue.
- Pairwise retrieval is recall-oriented, followed by conservative typed physical-vs-communicative action verifier.
- `SAME_OCCURRENCE` is a hypothesis only for specific rare-dimension cues (same named commune and near-time tornado; same commune and earthquake magnitude). Can still be wrong. Does NOT denote production-authoritative equivalence.
- Explicit unknowns and complete-link group policy; no source body or event-time inference; no News Article/Event/Claim writes and no contradictions.

## New public-metadata sample plan

- Select 20–36 previously unseen canonical HTTPS publisher URLs, ideally 5+ independent outlets, with competing contemporaneous accounts and hard negative pairs:
  same-day separate tornadoes in different communes, tornado vs institutional confirmation, eyewitness report vs same physical phenomenon, fire vs tornado, region-only headlines, multiple-location coverage and retrospective consequences.
- Original publisher visible headline + publication calendar date + site URL only. Keep verification/access level separate from candidate JSON. No copyrighted article bodies. Do not infer source ingestion permission from public visibility.
- Preserve exact candidate-only input schema: `schema=public-real-metadata-only-v1`, `source_text_acquired=false`, every article has `id,headline,canonical_url,published_on,publisher` only.
- No prescreen with model predictions. Report if sampling criteria are not met rather than filling with fabricated or duplicated articles.

## Execution and assessment

1. Seal model and geography SHA; seal new corpus before code run.
2. Sparse GitHub checkout of `attack5.py`, geo file, new corpus only; authenticate both blobs and assert Gold/evaluator absent. Run order-invariance check and preserve predictions with SHA and full reasons.
3. Publish only unlabeled retrieval and decision coverage, cross-type abstention, group sizes and source-key counts. These are engineering diagnostics, not precision, recall or F1.
4. Obtain two genuinely independent editorial reference annotations, adjudicate conflicts with original article evidence and describe ambiguity, multiple incidents, event time vs publication time.
5. Only after prediction artifact is frozen, run a **separate** scorer; no post-label tuning or report of independent score without two reviewers.
6. Gate: **NO_GO** if non-UNKNOWN coverage is zero, source identity leakage, impure positive clusters or any unapproved persistence. A provisional research candidate needs zero independently adjudicated false occurrence merges and >=80% same-occurrence recall at >=50% selective coverage, but small convenience corpus prevents generalization claims. Strict production safety requires more than these thresholds.

## Product and science barriers preserved

Issue #4 managed Supabase recovery remains open. No migrations 043/044, Article/Events writes, live ingestion, Flutter or Render changes. No use of R14 holdout or formal V10.11 candidate; full licensed original texts required for formal route. Data comes from public publisher metadata and Chile-Hub normalized third-party geography; retain upstream CC BY attribution and don't claim administrative authority.
