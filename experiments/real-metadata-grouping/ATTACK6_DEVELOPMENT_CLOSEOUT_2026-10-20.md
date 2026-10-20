# DIALEKTIK — ATTACK 6 development closeout and external review handoff

**Date:** 2026-10-20
**Branch:** `codex/attack6-evidence-actions-20261020`
**Status:** `ENGINEERING_PASS / SCIENCE_UNSCORED / DEPLOY_NO_GO`.

## Frozen inputs and preserved evaluation boundaries

The historical 26-publication ATTACK-5 sample and associated candidate hypotheses were **seen before ATTACK 6 development**, and the known false-merge mechanisms z04/z09 directly guided ATTACK 6. It is NOT a new holdout. Do not claim independently improved precision, lower false-merge rate, recall or overall F1. Future ATTACK-6 performance assessment requires a genuinely unseen sample acquired *after* locking these source blobs:

- `attack6.py` git blob `7d0cccd8a1abdb33256eae05fab93817747e3855`
- `attack6_roles.py` git blob `dd9b207e72d3fe4cc69de0d4020c3e5ef2363df4`
- Frozen ATTACK-5 candidate `attack5.py` git blob `930865a4ee073c7e3e10163a037e5bb1271de84e`
- Chile geography `attack5/chile_geography.json` git blob `b77512235fea9559fca1a5c9ef9ca6514a4b5b04`
- Historical corpus SHA256 `9eb2526292359291a95395186bdc57af4add3699eb25187c021ef0bd050fe0a7`

Development Actions:

- [Synthetic isolated gates: 17 PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39454830231).
- [Retrospective known-data diagnostic and blank reviewer packet generator: PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39455125959).

## What the code actually does

For each article **headline only**, extracts typed primary-action candidates:

`PHYSICAL_EVENT_REPORT`, `CORRECTION`, `CONFIRMATION`, `RETRACTION_OR_DENIAL`, `EXPLANATION`, `TESTIMONY`, `RETROSPECTIVE_DOCUMENTATION`, `ALERT_ISSUED`, `ALERT_CANCELLED`, `ATTRIBUTED_STATEMENT`, `UNKNOWN`.

Each matched span carries `article_id`, exact title character offsets, verbatim text, field `headline`, and evidence ID. Separate non-assertive `MENTIONS_PHYSICAL_TYPE` spans and date-expression spans preserve context. A temporal expression is NOT automatically `event_time`; it stays null. No license to infer complete publisher body. No claim extraction or comparison; no contradiction inference.

ATTACK-6 uses ATTACK-5 typed geography retrieval and only classifies event identity as an **unverified candidate**. A communicative/retrospective act mentioning a physical incident does not become the original physical act. Multi-event cases abstain; multi-occurrence reference edges are placeholders, not a solved article-to-multiple-event ontology or persistent relationship. This is an explicit limitation.

## Retrospective developer diagnostic (26 previously seen public metadata records)

| Outcome | Attack-5 baseline | Attack-6 on SAME previously seen corpus |
|---|---:|---:|
| Records | 26 | 26 |
| All article pairs | 325 | 325 |
| SAME_OCCURRENCE hypotheses | 37 | 7 |
| SAME_THREAD_DIFFERENT_OCCURRENCE hypotheses | 20 | 28 |
| UNKNOWN | 268 | 290 |
| Candidate groups | 2 | 2 |
| Penco cluster size | 9 | 4 |
| Arauco cluster size | 2 | 2 |

ATTACK 6's Penco unverified cluster: `[z01,z11,z12,z14]`. Arauco unverified cluster: `[z02,z07]`.

Critically `z04` (Government **rectifies/confirms** tornado classification) has `primary_action=CORRECTION`, and `z09` (meteorological tornado/waterspout explanation) has `primary_action=EXPLANATION`. **Neither belongs to any ATTACK-6 same-occurrence cluster**. This is a deterministic regression improvement on the specifically targeted known examples, not an accuracy measure.

The model may **over-separate** retrospective accounts and eyewitness testimony from the actual physical occurrence. Whether a news article *mentions* a physical episode and whether its *primary described occurrence* is a new communicative act require external editorial adjudication. Pairwise `SAME_THREAD_DIFFERENT_OCCURRENCE` can still be wrong. No claim that seven proposed links are seven true links.

Frozen developer-run diagnostic:
- `input_sha256=9eb2526292359291a95395186bdc57af4add3699eb25187c021ef0bd050fe0a7`
- `prediction_sha256=153b7a93f6c4107ce978148241c03d2f12d1658e9fbba7133069220d4434326e`
- `database_writes=0`; `production_permission=false`.

## Two REAL independent human reviewers: workflow prepared, reviews **NOT EXECUTED**

The workflow creates TWO blank, isolated, independently fillable review packets **without access to candidate code or predictions**, each containing 26 publication metadata cards and 325 pairwise classification records. Artifacts expire according to Actions retention policy; store appropriately under approved process.

- [Blank reviewer packets A and B](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39455125959/artifacts/12280321130).

For two human reviewers:
1. Supply separate actual identities/times and independently inspect original source pages where access rights permit; never give either reviewer the candidate predictions or the other one's labels.
2. Classify each article's primary act, event mentions, temporal evidence and 325 pairs (`SAME_OCCURRENCE`, `SAME_THREAD_DIFFERENT_OCCURRENCE`, `UNRELATED`, `UNKNOWN`), with source evidence or explicit abstention. Resolve contradictory annotations and retain the original two signed drafts plus conflict ledger.
3. Independent review is genuine ONLY if these real people actually perform the annotations. A blank second packet or two runs of the same assistant is NOT two independent human adjudicators.
4. After adjudication, in a separate evaluator environment use frozen ATTACK-5 (and/or ATTACK-6, explicitly marked development-exposed) predictions and gold to compute confusion, pair-level, clustering and selective coverage with provenance hashes.
5. Keep the already-seen ATTACK-5 corpus out of any *future ATTACK-6 prospective test*. Candidate code and this error analysis have now been exposed to it.

**NOT performed:** reviewer participation, conflict adjudication, full corpus Gold scoring, proof of legal acquisition, autonomous ingestion, model-driven contradiction extraction, Supabase migration/Events, Flutter work, R14/V10.11, holdout access.

## Next scientifically meaningful move

Retain the candidate modules above as immutable **ATTACK-6 candidate v1**. Record an independent sample selection method before reading any new headline, with a different event domain distribution; use 2 real reviewers and maintain a prediction-free gold creation environment. Freeze and score without model tuning after labels are revealed.

Scientific/production authorization **NO_GO** until these gates are met. Supabase RESTORE-GATE issue #4 and official source rights continue to block operational autonomy.
